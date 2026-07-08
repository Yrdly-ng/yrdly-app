import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DeliveryOption, PaymentMethod, EscrowStatus } from "@/types/escrow";
import { MARKETPLACE_CONSTANTS } from "@/lib/constants";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { getPostHogClient } from "@/lib/posthog-server";
import { PaystackService } from "@/lib/paystack-service";

// Rate limiting constants
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute


/**
 * POST /api/payment/initialize
 *
 * Creates an escrow transaction in Supabase + initialises a Paystack
 * Standard payment link, then returns the link to the client.
 *
 * This is the server-side entry-point so that the Paystack secret key is
 * never exposed to the browser.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Rate Limiting ────────────────────────────────────────────────────────
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const endpoint = "/api/payment/initialize";
    const now = new Date();

    const { data: rlData } = await supabaseAdmin
      .from('rate_limits')
      .select('*')
      .eq('ip_address', ip)
      .eq('endpoint', endpoint)
      .single();

    if (rlData) {
      const windowStart = new Date(rlData.window_start).getTime();
      if (now.getTime() - windowStart < RATE_LIMIT_WINDOW_MS) {
        if (rlData.request_count >= RATE_LIMIT_MAX) {
          return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }
        await supabaseAdmin
          .from('rate_limits')
          .update({ request_count: rlData.request_count + 1 })
          .eq('ip_address', ip)
          .eq('endpoint', endpoint);
      } else {
        await supabaseAdmin
          .from('rate_limits')
          .update({ request_count: 1, window_start: now.toISOString() })
          .eq('ip_address', ip)
          .eq('endpoint', endpoint);
      }
    } else {
      await supabaseAdmin
        .from('rate_limits')
        .insert({
          ip_address: ip,
          endpoint: endpoint,
          request_count: 1,
          window_start: now.toISOString()
        });
    }

    // ── Authenticate the caller ───────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (!user || authError) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      itemId,
      buyerId,
      sellerId,
      price,
      buyerEmail,
      buyerName,
      itemTitle,
      sellerName,
    } = body as {
      itemId: string;
      buyerId: string;
      sellerId: string;
      price: number;
      buyerEmail: string;
      buyerName: string;
      itemTitle: string;
      sellerName: string;
    };

    // ── Validate ──────────────────────────────────────────
    if (!itemId || !buyerId || !sellerId || !price || !buyerEmail) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Ensure the authenticated user matches the buyerId
    if (user.id !== buyerId) {
      return NextResponse.json(
        { error: "Buyer ID does not match authenticated user" },
        { status: 403 }
      );
    }

    if (buyerId === sellerId) {
      return NextResponse.json(
        { error: "You cannot buy your own item" },
        { status: 400 }
      );
    }

    // ── Check availability ────────────────────────────────
    console.log("[PaymentInit] Checking availability for itemId:", itemId);
    
    const { data: itemData, error: itemError } = await supabaseAdmin
      .from("posts")
      .select("id, is_sold, title, price, user_id")
      .eq("id", itemId)
      .single();

    if (itemError) {
      console.error("[PaymentInit] Database error or item not found:", itemError);
      return NextResponse.json(
        { error: "Item not found or database error. Please try again." },
        { status: 404 }
      );
    }

    console.log("[PaymentInit] itemData:", JSON.stringify(itemData));

    // 2. Check if item is already sold
    if (itemData?.is_sold) {
      return NextResponse.json(
        { error: "Item is no longer available." },
        { status: 409 }
      );
    }

    // 3. Check if user is buying their own item (using selected user_id)
    if (itemData.user_id === user.id) {
      return NextResponse.json(
        { error: "You cannot buy your own item." },
        { status: 400 }
      );
    }

    // ── Create escrow transaction (admin client bypasses RLS) ──
    // Always use the price from the database — never trust the client-supplied value
    const authorizedPrice = itemData.price;
    // Buyer pays item price only; platform takes commission from seller's share at payout
    const commission = Math.round(authorizedPrice * MARKETPLACE_CONSTANTS.COMMISSION_RATE);
    const totalAmount = authorizedPrice;

    // ── Look up seller's payout account ──────────────────
    const { data: sellerAccount } = await supabaseAdmin
      .from("seller_accounts")
      .select("payment_subaccount_id, verification_status, account_updated_at, updated_at")
      .eq("user_id", sellerId)
      .eq("is_active", true)
      .single();

    // ── Task 2: Block payouts to unverified accounts ──────
    if (!sellerAccount || sellerAccount.verification_status !== "verified") {
      return NextResponse.json(
        {
          error:
            "The seller has not yet verified their payout account. Payment cannot proceed until their account is verified.",
          code: "SELLER_UNVERIFIED",
        },
        { status: 402 }
      );
    }

    // ── Task 3: 24-hour cooling-off after account change ──
    // Only apply the 24-hour hold if account_updated_at is explicitly set
    // (i.e., for existing accounts that changed their payout details).
    // New accounts have account_updated_at = null and can sell immediately.
    if (sellerAccount.account_updated_at) {
      const updatedTime = new Date(sellerAccount.account_updated_at).getTime();
      const hoursSinceUpdate = (Date.now() - updatedTime) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 24) {
        const hoursLeft = Math.ceil(24 - hoursSinceUpdate);
        return NextResponse.json(
          {
            error: `The seller recently updated their payout account. For security, payouts are held for 24 hours after an account change. Please try again in ${hoursLeft} hour(s).`,
            code: "COOLING_OFF_PERIOD",
          },
          { status: 402 }
        );
      }
    }

    const { data: txData, error: txError } = await supabaseAdmin
      .from("escrow_transactions")
      .insert({
        item_id: itemId,
        buyer_id: buyerId,
        seller_id: sellerId,
        amount: authorizedPrice,
        commission,
        total_amount: totalAmount,
        seller_amount: authorizedPrice - commission, // seller receives price minus platform fee
        status: EscrowStatus.PENDING,
        payment_method: PaymentMethod.CARD,
        delivery_details: { option: DeliveryOption.FACE_TO_FACE },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (txError) {
      console.error("Escrow transaction error:", txError);
      return NextResponse.json(
        { error: "Failed to create transaction" },
        { status: 500 }
      );
    }

    const transactionId = txData.id;

    // ── Initialise Paystack payment ───────────────────────
    // Full amount collected into platform account and held in escrow.
    // Seller payout triggered after buyer confirms receipt.
    let paymentLink: string;
    try {
      paymentLink = await PaystackService.initializePayment({
        transactionId,
        amount: totalAmount,
        buyerEmail,
        buyerName,
        itemTitle,
        sellerName,
      });
    } catch (paystackError: any) {
      console.error("Paystack error:", paystackError);
      return NextResponse.json(
        { error: paystackError?.message || "Failed to initialize payment" },
        { status: 502 }
      );
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'payment_initialized',
      properties: {
        transaction_id: transactionId,
        item_id: itemId,
        amount: totalAmount,
        currency: MARKETPLACE_CONSTANTS.CURRENCY,
        seller_id: sellerId,
      },
    });

    return NextResponse.json({
      success: true,
      paymentLink,
      transactionId,
    });
  } catch (error) {
    console.error("Payment initialization error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
