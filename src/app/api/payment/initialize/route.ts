import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ItemTrackingService } from "@/lib/item-tracking-service";
import { DeliveryOption, PaymentMethod, EscrowStatus } from "@/types/escrow";
import { MARKETPLACE_CONSTANTS } from "@/lib/constants";
import { createClient } from "@/lib/supabase-server";


/**
 * POST /api/payment/initialize
 *
 * Creates an escrow transaction in Supabase + initialises a Flutterwave
 * Standard payment link, then returns the link to the client.
 *
 * This is the server-side entry-point so that the FLW secret key is
 * never exposed to the browser.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Authenticate the caller ────────────────────────
    const supabase = await createClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (!authUser || authError) {
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
    if (authUser.id !== buyerId) {
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
    if (itemData.user_id === authUser.id) {
      return NextResponse.json(
        { error: "You cannot buy your own item." },
        { status: 400 }
      );
    }

    // ── Create escrow transaction (admin client bypasses RLS) ──
    const commission = Math.round(price * MARKETPLACE_CONSTANTS.COMMISSION_RATE);
    const totalAmount = price + commission;

    // ── Look up seller's Flutterwave subaccount ──────────
    const { data: sellerAccount } = await supabaseAdmin
      .from("seller_accounts")
      .select("flutterwave_subaccount_id")
      .eq("user_id", sellerId)
      .eq("is_active", true)
      .single();

    const { data: txData, error: txError } = await supabaseAdmin
      .from("escrow_transactions")
      .insert({
        item_id: itemId,
        buyer_id: buyerId,
        seller_id: sellerId,
        amount: price,
        commission,
        total_amount: totalAmount,
        seller_amount: price - commission,
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

    // ── Build Flutterwave Standard payment payload ────────
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";

    const flwPayload: Record<string, any> = {
      tx_ref: transactionId,
      amount: totalAmount,
      currency: MARKETPLACE_CONSTANTS.CURRENCY,
      redirect_url: `${appUrl}/payment/verify?tx_ref=${transactionId}&itemId=${itemId}`,
      payment_options: "card,banktransfer,ussd",
      customer: {
        email: buyerEmail,
        name: buyerName,
      },
      customizations: {
        title: "Yrdly Marketplace",
        description: `Payment for ${itemTitle} from ${sellerName}`,
        logo: `${appUrl}/yrdly-logo.png`,
      },
      meta: {
        transaction_id: transactionId,
        item_title: itemTitle,
        seller_name: sellerName,
        commission,
        item_price: price,
      },
    };

    // ── Add split payment if seller has a subaccount ──────
    if (sellerAccount?.flutterwave_subaccount_id) {
      flwPayload.subaccounts = [
        {
          id: sellerAccount.flutterwave_subaccount_id,
          transaction_charge_type: "percentage",
          transaction_charge: MARKETPLACE_CONSTANTS.COMMISSION_RATE * 100, // 3
        },
      ];
    }

    // ── Call Flutterwave Standard API ─────────────────────
    const flwRes = await fetch(
      "https://api.flutterwave.com/v3/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(flwPayload),
      }
    );

    const flwData = await flwRes.json();

    if (flwData.status !== "success" || !flwData.data?.link) {
      console.error("Flutterwave error:", flwData);
      return NextResponse.json(
        { error: flwData.message || "Failed to initialize payment" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      paymentLink: flwData.data.link,
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
