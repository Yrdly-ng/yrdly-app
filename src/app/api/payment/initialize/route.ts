import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DeliveryOption, PaymentMethod, EscrowStatus } from "@/types/escrow";
import { MARKETPLACE_CONSTANTS } from "@/lib/constants";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { getPostHogClient } from "@/lib/posthog-server";
import { PaylukService } from "@/lib/payluk-service";
import { getPaylukCustomerId } from "@/lib/payluk-onboarding";

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
    // ── Authenticate the caller ───────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (!user || authError) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // ── Rate Limiting (keyed by user_id, not IP) ──────────────────────────────
    // IP-based limiting breaks on shared carrier NAT (common with Nigerian mobile networks)
    const endpoint = "/api/payment/initialize";
    const now = new Date();

    const { data: rlData } = await supabaseAdmin
      .from('rate_limits')
      .select('*')
      .eq('user_id', user.id)
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
          .eq('user_id', user.id)
          .eq('endpoint', endpoint);
      } else {
        await supabaseAdmin
          .from('rate_limits')
          .update({ request_count: 1, window_start: now.toISOString() })
          .eq('user_id', user.id)
          .eq('endpoint', endpoint);
      }
    } else {
      await supabaseAdmin
        .from('rate_limits')
        .insert({
          user_id: user.id,
          endpoint: endpoint,
          request_count: 1,
          window_start: now.toISOString()
        });
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

    const effectiveBuyerEmail = buyerEmail || user.email || `${buyerId}@placeholder.yrdly.com`;

    // ── Validate ──────────────────────────────────────────
    const missing = [];
    if (!itemId) missing.push('itemId');
    if (!buyerId) missing.push('buyerId');
    if (!sellerId) missing.push('sellerId');
    if (price === undefined || price === null) missing.push('price');
    if (!effectiveBuyerEmail) missing.push('buyerEmail');

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
      .from("escrow_transactions")
      .select("id, buyer_id, status, payluk_tx_ref, payluk_escrow_id, total_amount, created_at")
      .eq("item_id", itemId)
      .in("status", [EscrowStatus.PENDING, EscrowStatus.PAID, EscrowStatus.SHIPPED, EscrowStatus.DELIVERED, EscrowStatus.COMPLETED, EscrowStatus.DISPUTED, 'creating_escrow', 'reconciling'])
      .order("created_at", { ascending: false });

    let existingTxToResume: any = null;

    if (activeTx && activeTx.length > 0) {
      const existingTx = activeTx[0];

      // ── Handle in-flight 'creating_escrow' or 'reconciling' from a previous attempt ──
      if (existingTx.buyer_id === buyerId && existingTx.status === 'creating_escrow') {
        const lockTimestamp = existingTx.created_at;
        const lockAgeMs = Date.now() - new Date(lockTimestamp).getTime();
        const LOCK_TIMEOUT_MS = 60 * 1000;

        if (lockAgeMs < LOCK_TIMEOUT_MS) {
          return NextResponse.json(
            { error: "ESCROW_CREATION_IN_PROGRESS", message: "Your payment is being set up. Please wait a moment and try again." },
            { status: 409 }
          );
        }

        // Stale creating_escrow — cancel it so a fresh attempt can proceed
        console.warn(`[PaymentInit] Stale creating_escrow tx ${existingTx.id} (age: ${Math.round(lockAgeMs / 1000)}s). Cancelling...`);
        await supabaseAdmin
          .from("escrow_transactions")
          .update({ status: EscrowStatus.CANCELLED, updated_at: new Date().toISOString() })
          .eq("id", existingTx.id)
          .eq("status", "creating_escrow");
        // Fall through to create a fresh reservation
      } else if (existingTx.buyer_id === buyerId && existingTx.status === 'reconciling') {
        return NextResponse.json(
          { error: "RECONCILIATION_IN_PROGRESS", message: "A previous checkout attempt is being cleaned up. Please try again in a moment." },
          { status: 409 }
        );
      } else if (existingTx.buyer_id === buyerId && existingTx.status === EscrowStatus.PENDING) {
        // Same buyer retrying an unpaid pending checkout.
        // Payluk payment tokens and references are single-use. Re-using an abandoned token returns
        // "Reference already exists" (400) from Payluk's checkout session API.
        // Cancel the abandoned transaction so a fresh reservation + Payluk escrow token is generated below.
        console.log(`[PaymentInit] Auto-cancelling abandoned unpaid pending tx ${existingTx.id} for buyer ${buyerId} to generate fresh escrow...`);
        await supabaseAdmin
          .from("escrow_transactions")
          .update({ status: EscrowStatus.CANCELLED, updated_at: new Date().toISOString() })
          .eq("id", existingTx.id)
          .eq("status", EscrowStatus.PENDING);
        // Fall through — existingTxToResume remains null, fresh reservation + Payluk escrow token generated below
      } else if (existingTx.status === EscrowStatus.PENDING || existingTx.status === 'creating_escrow' || existingTx.status === 'reconciling') {
        // Different buyer — check if the PENDING reservation is stale (abandoned checkout).
        // If older than PENDING_EXPIRY_MS and still unpaid, auto-cancel it so the item is freed.
        const PENDING_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours
        const pendingAgeMs = Date.now() - new Date(existingTx.created_at).getTime();

        if (pendingAgeMs >= PENDING_EXPIRY_MS) {
          // Atomic CAS: only cancel if it's still in a pre-paid state
          const { data: cancelledTx } = await supabaseAdmin
            .from("escrow_transactions")
            .update({ status: EscrowStatus.CANCELLED, updated_at: new Date().toISOString() })
            .eq("id", existingTx.id)
            .in("status", [EscrowStatus.PENDING, 'creating_escrow'])
            .select("id")
            .single();

          if (!cancelledTx) {
            // Another request won the cancellation race — tell buyer to retry
            return NextResponse.json(
              { error: "Another neighbor is currently completing payment for this item. Please try again shortly." },
              { status: 409 }
            );
          }

          console.log(`[PaymentInit] Auto-cancelled stale tx ${existingTx.id} (status: ${existingTx.status}, age: ${Math.round(pendingAgeMs / 60000)}m). Item ${itemId} freed for new buyer.`);
          // Fall through — existingTxToResume stays null, a fresh reservation will be created below
        } else {
          return NextResponse.json(
            { error: "Another neighbor is currently completing payment for this item. Please try again shortly." },
            { status: 409 }
          );
        }
      } else {
        // Non-PENDING active status (PAID, SHIPPED, etc.) — item is legitimately locked
        return NextResponse.json(
          { error: "Another neighbor is currently completing payment for this item. Please try again shortly." },
          { status: 409 }
        );
      }
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

    // ── STEP 1: DB Reservation FIRST (Before external Payluk call) ──
    // Inserting into escrow_transactions first enforces single-buyer reservation at the DB layer
    // via unique partial index idx_escrow_transactions_single_active_post.
    // Zero external Payluk calls occur for losing concurrent requests!
    let transactionId: string;

    if (existingTxToResume) {
      transactionId = existingTxToResume.id;
    } else {
      const txPayload: any = {
        item_id: itemId,
        buyer_id: buyerId,
        seller_id: sellerId,
        amount: authorizedPrice,
        commission,
        total_amount: totalAmount,
        seller_amount: authorizedPrice - commission,
        status: EscrowStatus.PENDING,
        payment_method: PaymentMethod.CARD,
        delivery_details: { option: DeliveryOption.FACE_TO_FACE },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        item_type: itemType,
      };

      const { data: txData, error: txError } = await supabaseAdmin
        .from("escrow_transactions")
        .insert(txPayload)
        .select("id")
        .single();

      if (txError) {
        console.error("[PaymentInit] Escrow reservation insert error:", txError);
        
        // 23505 = PostgreSQL Unique Violation (idx_escrow_transactions_single_active_post)
        if (txError.code === '23505' || txError.message?.includes('idx_escrow_transactions_single_active_post')) {
          return NextResponse.json(
            { error: "Another neighbor is currently completing payment for this item. Please try again shortly." },
            { status: 409 }
          );
        }

        return NextResponse.json(
          { error: "Failed to create transaction reservation" },
          { status: 500 }
        );
      }

      transactionId = txData.id;
    }

    // ── STEP 2: Atomic CAS Claim for Escrow Creation (Strict PENDING -> CREATING_ESCROW) ──
    // Only ONE request atomically transitions PENDING -> creating_escrow.
    // Parallel requests fail the claim (0 rows updated) and DO NOT call Payluk!
    let paylukPaymentToken: string | undefined = undefined;
    let paylukEscrowId: string | undefined = undefined;
    let sellerPaylukId: string | undefined = undefined;
    let buyerPaylukId: string | undefined = undefined;

    if (totalAmount > 0) {
      const { data: claimedTx, error: claimErr } = await supabaseAdmin
        .from("escrow_transactions")
        .update({
          status: 'creating_escrow',
          creating_escrow_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", transactionId)
        .eq("status", EscrowStatus.PENDING)
        .is("payluk_escrow_id", null)
        .select("id")
        .single();

      if (claimErr || !claimedTx) {
        console.log(`[PaymentInit] Escrow creation claim failed for tx ${transactionId}. Inspecting current state...`);
        const { data: currentTx } = await supabaseAdmin
          .from("escrow_transactions")
          .select("id, status, payluk_tx_ref, payluk_escrow_id, total_amount, creating_escrow_started_at, updated_at")
          .eq("id", transactionId)
          .single();

        if (currentTx?.payluk_escrow_id && currentTx?.payluk_tx_ref) {
          const existingBuyerPaylukId = await getPaylukCustomerId(buyerId);
          return NextResponse.json({
            success: true,
            transactionId: currentTx.id,
            totalAmount: currentTx.total_amount,
            paylukPaymentToken: currentTx.payluk_tx_ref,
            paylukEscrowId: currentTx.payluk_escrow_id,
            buyerPaylukId: existingBuyerPaylukId,
          });
        }

        if (currentTx?.status === 'creating_escrow') {
          const lockTimestamp = currentTx.creating_escrow_started_at || currentTx.updated_at;
          const lockAgeMs = Date.now() - new Date(lockTimestamp).getTime();
          const LOCK_TIMEOUT_MS = 60 * 1000; // 60 seconds

          if (lockAgeMs < LOCK_TIMEOUT_MS) {
            return NextResponse.json(
              { error: "ESCROW_CREATION_IN_PROGRESS", message: "Escrow creation is currently in progress. Please try again shortly." },
              { status: 409 }
            );
          }

          // ── STALE ESCROW CREATION LOCK DETECTED (Age >= 60 seconds) ──
          // Perform ATOMIC STALE-LOCK CLAIM: creating_escrow -> reconciling
          // Only ONE request wins the reconciling claim!
          console.warn(`[PaymentInit] Stale escrow creation lock detected (age: ${Math.round(lockAgeMs / 1000)}s). Claiming atomic reconciliation lock...`);

          const { data: reconcilingTx, error: reconcileClaimErr } = await supabaseAdmin
            .from("escrow_transactions")
            .update({
              status: 'reconciling',
              updated_at: new Date().toISOString(),
            })
            .eq("id", transactionId)
            .eq("status", "creating_escrow")
            .is("payluk_escrow_id", null)
            .select("id")
            .single();

          if (reconcileClaimErr || !reconcilingTx) {
            return NextResponse.json(
              { error: "RECONCILIATION_IN_PROGRESS", message: "Another request is reconciling this stale escrow creation lock." },
              { status: 409 }
            );
          }

          // Winner of atomic reconciling claim cancels the stale unfulfilled transaction row
          console.warn(`[PaymentInit] Cancelling stale unfulfilled escrow creation reservation tx ${transactionId}...`);
          await supabaseAdmin
            .from("escrow_transactions")
            .update({
              status: EscrowStatus.CANCELLED,
              updated_at: new Date().toISOString(),
            })
            .eq("id", transactionId);

          return NextResponse.json(
            { error: "STALE_ESCROW_CANCELLED", message: "Stale escrow creation timed out and was cancelled. Please try initializing checkout again." },
            { status: 409 }
          );
        }

        // A stale creating_escrow lock was previously promoted to 'reconciling' by another
        // request. That reconciling request should have cancelled the tx and freed the item.
        // Tell the buyer to retry — the next attempt will create a fresh reservation.
        if (currentTx?.status === 'reconciling') {
          return NextResponse.json(
            { error: "RECONCILIATION_IN_PROGRESS", message: "A previous checkout attempt is being cleaned up. Please try again in a moment." },
            { status: 409 }
          );
        }

        if (currentTx?.status === EscrowStatus.PENDING && !currentTx?.payluk_escrow_id) {
          // Race recovered: another request released the lock but didn't create escrow.
          // Re-attempt the CAS claim before proceeding.
          console.log(`[PaymentInit] Transaction ${transactionId} is PENDING without Payluk escrow. Re-attempting CAS claim...`);
          const { data: reClaimedTx, error: reClaimErr } = await supabaseAdmin
            .from("escrow_transactions")
            .update({
              status: 'creating_escrow',
              creating_escrow_started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", transactionId)
            .eq("status", EscrowStatus.PENDING)
            .is("payluk_escrow_id", null)
            .select("id")
            .single();

          if (reClaimErr || !reClaimedTx) {
            console.error(`[PaymentInit] Re-claim failed for tx ${transactionId}. Another request may have won.`);
            return NextResponse.json(
              { error: "ESCROW_CREATION_IN_PROGRESS", message: "Payment setup is in progress. Please wait a moment." },
              { status: 409 }
            );
          }
          // Re-claim succeeded, fall through to Payluk escrow creation
        } else {
          // Terminal or unknown state — log for ops visibility.
          console.error(`[PaymentInit] Unexpected tx state for escrow creation: ${currentTx?.status} (tx: ${transactionId})`);
          return NextResponse.json(
            { error: "Failed to initialize payment. Please try again.", detail: "Transaction is not in a valid state for escrow creation", status: currentTx?.status || 'unknown' },
            { status: 400 }
          );
        }
      }

      // Winner of the atomic claim proceeds to call PaylukService.createEscrow()
      try {
        buyerPaylukId = await getPaylukCustomerId(buyerId);
        sellerPaylukId = await getPaylukCustomerId(sellerId);
        
        const paylukEscrow = await PaylukService.createEscrow(sellerPaylukId, {
          amount: totalAmount,
          purpose: itemData.title,
          whoPays: 'seller',
          maxDelivery: 7,
          deliveryTimeline: 'days',
        });
        
        paylukPaymentToken = paylukEscrow.paymentToken;
        paylukEscrowId = paylukEscrow.id;
      } catch (paylukError: any) {
        console.error("[PaymentInit] Payluk createEscrow error:", paylukError);
        
        // Cancel the reserved local transaction so the item is freed
        await supabaseAdmin
          .from("escrow_transactions")
          .update({
            status: EscrowStatus.CANCELLED,
            updated_at: new Date().toISOString()
          })
          .eq("id", transactionId);

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

    // ── STEP 3: Update local reservation with Payluk details & reset status to PENDING ──
    if (totalAmount > 0 && paylukPaymentToken && paylukEscrowId) {
      const { error: updateErr } = await supabaseAdmin
        .from("escrow_transactions")
        .update({
          status: EscrowStatus.PENDING,
          payment_provider: 'payluk',
          payluk_tx_ref: paylukPaymentToken,
          payluk_escrow_id: paylukEscrowId,
          updated_at: new Date().toISOString()
        })
        .eq("id", transactionId);

      if (updateErr) {
        console.error("[PaymentInit] Error updating tx with Payluk details:", updateErr);
      }
    }

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

    // Return initialized escrow transaction details
    return NextResponse.json({
      success: true,
      transactionId,
      totalAmount,
      paylukPaymentToken,
      paylukEscrowId,
      buyerPaylukId,
    });
  } catch (error) {
    console.error("Payment initialization error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
