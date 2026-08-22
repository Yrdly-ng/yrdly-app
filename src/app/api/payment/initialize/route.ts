import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DeliveryOption, PaymentMethod, EscrowStatus } from "@/types/escrow";
import { MARKETPLACE_CONSTANTS } from "@/lib/constants";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { getPostHogClient } from "@/lib/posthog-server";
import { PaylukService } from "@/lib/payluk-service";
import { ensurePaylukCustomer } from "@/lib/payluk-onboarding";

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
      itemType = 'post',
    } = body as {
      itemId: string;
      buyerId: string;
      sellerId: string;
      price: number;
      buyerEmail: string;
      itemType?: 'post' | 'catalog_item';
    };

    // ── Validate ──────────────────────────────────────────
    const missing = [];
    if (!itemId) missing.push('itemId');
    if (!buyerId) missing.push('buyerId');
    if (!sellerId) missing.push('sellerId');
    if (price === undefined || price === null) missing.push('price');
    if (!buyerEmail) missing.push('buyerEmail');

    if (missing.length > 0) {
      console.log("[PaymentInit] Missing fields:", missing, "Payload:", body);
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}` },
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
    console.log(`[PaymentInit] Checking availability for itemId: ${itemId}, type: ${itemType}`);
    
    let itemData: any = null;
    
    if (itemType === 'catalog_item') {
      const { data, error } = await supabaseAdmin
        .from("catalog_items")
        .select("id, in_stock, title, price, business_id")
        .eq("id", itemId)
        .single();
        
      if (error) {
        console.error("[PaymentInit] Database error or item not found:", error);
        return NextResponse.json(
          { error: "Item not found or database error. Please try again." },
          { status: 404 }
        );
      }
      
      // We should verify that the sellerId actually owns the business this item belongs to
      const { data: businessData } = await supabaseAdmin
        .from("businesses")
        .select("owner_id")
        .eq("id", data.business_id)
        .single();
        
      if (businessData?.owner_id !== sellerId) {
        return NextResponse.json(
          { error: "Seller ID mismatch." },
          { status: 403 }
        );
      }
      
      itemData = {
        id: data.id,
        is_sold: !data.in_stock,
        title: data.title,
        price: data.price,
        user_id: sellerId,
        item_type: 'catalog_item'
      };
    } else {
      const { data, error } = await supabaseAdmin
        .from("posts")
        .select("id, is_sold, title, price, user_id")
        .eq("id", itemId)
        .single();
        
      if (error) {
        console.error("[PaymentInit] Database error or item not found:", error);
        return NextResponse.json(
          { error: "Item not found or database error. Please try again." },
          { status: 404 }
        );
      }
      
      itemData = {
        ...data,
        item_type: 'post'
      };
    }

    console.log("[PaymentInit] itemData:", JSON.stringify(itemData));

    // 2. Check if item is already sold or currently in an active checkout
    if (itemData?.is_sold) {
      return NextResponse.json(
        { error: "Item is no longer available." },
        { status: 400 }
      );
    }

    const { data: activeTx } = await supabaseAdmin
      .from("transactions")
      .select("id")
      .eq("item_id", itemId)
      .eq("status", "pending_escrow")
      .neq("buyer_id", buyerId)
      .limit(1);

    if (activeTx && activeTx.length > 0) {
      return NextResponse.json(
        { error: "Another neighbor is currently completing payment for this item. Please try again shortly." },
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

    // ── Payluk Pre-Insert (Escrow Creation) ───────────────
    let paylukPaymentToken: string | undefined = undefined;
    let paylukEscrowId: string | undefined = undefined;
    let sellerPaylukId: string | undefined = undefined;

    if (totalAmount > 0) {
      try {
        await ensurePaylukCustomer(buyerId);
        sellerPaylukId = await ensurePaylukCustomer(sellerId);
        
        const paylukEscrow = await PaylukService.createEscrow(sellerPaylukId, {
          amount: totalAmount,
          purpose: itemData.title,
          whoPays: 'seller',
        });
        
        paylukPaymentToken = paylukEscrow.paymentToken;
        paylukEscrowId = paylukEscrow.id;
      } catch (paylukError: any) {
        console.error("Payluk createEscrow error:", paylukError);
        
        const errMsg = paylukError?.message || "";
        if (errMsg.includes('must have a verified phone number')) {
           const isBuyer = errMsg.includes(buyerId);
           return NextResponse.json(
             { error: isBuyer ? 'PHONE_VERIFICATION_REQUIRED' : 'SELLER_PHONE_UNVERIFIED' },
             { status: 409 }
           );
        }

        return NextResponse.json(
          { error: paylukError?.message || "Failed to initialize Payluk escrow" },
          { status: 502 }
        );
      }
    }

    const txPayload: any = {
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
      item_type: itemType, // Keep track of the item type in escrow_transactions
    };

    if (totalAmount > 0) {
      txPayload.payment_provider = 'payluk';
      txPayload.payluk_tx_ref = paylukPaymentToken;     // PY_... token (used by claimFunds, webhook)
      txPayload.payluk_escrow_id = paylukEscrowId;      // raw data.id (used by confirmDelivery)
    }

    const { data: txData, error: txError } = await supabaseAdmin
      .from("escrow_transactions")
      .insert(txPayload)
      .select("id")
      .single();

    if (txError) {
      console.error("Escrow transaction error:", txError);
      
      if (paylukPaymentToken && sellerPaylukId) {
        try {
          await PaylukService.deleteEscrow(sellerPaylukId, paylukPaymentToken);
          console.log(`[PaymentInit] Cleaned up orphaned Payluk escrow: ${paylukPaymentToken}`);
        } catch (cleanupErr: any) {
          console.error(`[PaymentInit] FATAL: Failed to clean up orphaned Payluk escrow ${paylukPaymentToken}:`, cleanupErr?.message);
        }
      }

      return NextResponse.json(
        { error: "Failed to create transaction" },
        { status: 500 }
      );
    }

    const transactionId = txData.id;

    let paymentLink: string | undefined = undefined;
    
    if (totalAmount === 0) {
      // Free item, bypass Paystack and mark as PAID immediately
      await supabaseAdmin
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.PAID,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      if (itemType === 'catalog_item') {
        await supabaseAdmin
          .from('catalog_items')
          .update({ 
            in_stock: false, 
            updated_at: new Date().toISOString(),
          })
          .eq('id', itemId);
      } else {
        await supabaseAdmin
          .from('posts')
          .update({ 
            is_sold: true, 
            sold_to_user_id: buyerId,
            sold_at: new Date().toISOString(),
            transaction_id: transactionId,
          })
          .eq('id', itemId);
      }
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
      totalAmount,
      paylukPaymentToken,
      paylukEscrowId,
    });
  } catch (error) {
    console.error("Payment initialization error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
