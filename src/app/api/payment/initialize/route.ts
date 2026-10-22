import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/supabase-admin";
import { DeliveryOption, PaymentMethod, EscrowStatus } from "@/types/escrow";
import { isPaidPrice } from '@/lib/marketplace/price-policy';
import { MARKETPLACE_CONSTANTS } from "@/lib/shared/constants";
import { getAuthenticatedUser } from "@/lib/supabase/supabase-server";
import { PaylukService } from "@/lib/payments/payluk-service";
import { flagPayment } from '@/lib/payments/payment-reconciliation';
import { applyEscrowPayment } from '@/lib/payments/escrow-payment';
import { getPaylukCustomerId } from "@/lib/payments/payluk-onboarding";

import { expireCheckoutReservation, expireItemCheckoutReservations, reservationHasExpired, RESERVATION_SELECT } from '@/lib/payments/checkout-reservation-expiry';

export const maxDuration = 60;

// Rate limiting constants
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

function phoneVerificationResponse(error: unknown, buyerId?: string) {
  if (!buyerId || !error || typeof error !== 'object' ||
      !('code' in error) || error.code !== 'PAYMENT_PHONE_VERIFICATION_REQUIRED' ||
      !('userId' in error) || typeof error.userId !== 'string') return null;

  const isBuyer = error.userId === buyerId;
  return NextResponse.json({
    error: isBuyer ? 'PHONE_VERIFICATION_REQUIRED' : 'SELLER_PHONE_UNVERIFIED',
    message: isBuyer
      ? 'Please verify your phone number to continue with payment.'
      : 'The seller needs to verify their phone number before this item can be purchased. Please contact the seller.',
  }, { status: 409 });
}

function paymentIdentityResponse(error: unknown, buyerId?: string) {
  if (!buyerId || !error || typeof error !== 'object' ||
      !('code' in error) || error.code !== 'PAYMENT_IDENTITY_MISMATCH' ||
      !('userId' in error) || typeof error.userId !== 'string') return null;

  const isBuyer = error.userId === buyerId;
  return NextResponse.json({
    error: isBuyer ? 'BUYER_PAYMENT_IDENTITY_MISMATCH' : 'SELLER_PAYMENT_IDENTITY_MISMATCH',
    message: isBuyer
      ? 'Your Yrdly phone and linked Payluk account do not match. Contact Yrdly Support to safely reconcile your payment account before trying again.'
      : 'The seller’s linked payment account needs to be reconciled before this item can be purchased. Please try another listing or contact the seller.',
  }, { status: 409 });
}


/**
 * POST /api/payment/initialize
 *
 * Creates a reserved escrow transaction in Supabase and a Payluk
 * checkout payment link, then returns the link to the client.
 *
 * This is the server-side entry-point so that the Payluk secret key is
 * never exposed to the browser.
 */
export async function POST(request: NextRequest) {
  let authenticatedBuyerId: string | undefined;
  try {
    // ── Authenticate the caller ───────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (!user || authError) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 }
      );
    }
    authenticatedBuyerId = user.id;

    // ── Atomic rate limiting (keyed by user_id, not IP) ──────────────────────
    // IP-based limiting breaks on shared carrier NAT (common on mobile networks).
    const endpoint = "/api/payment/initialize";
    const { data: withinRateLimit, error: rateLimitError } = await supabaseAdmin.rpc('consume_rate_limit', {
      p_user_id: user.id,
      p_endpoint: endpoint,
      p_max_requests: RATE_LIMIT_MAX,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (rateLimitError) {
      console.error('[PaymentInit] Rate limit check failed:', rateLimitError.message);
      return NextResponse.json({ error: 'Unable to authorize payment request' }, { status: 503 });
    }
    if (!withinRateLimit) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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

    if (!['post','catalog_item'].includes(itemType)) return NextResponse.json({ error: 'Invalid item type' }, { status: 400 });
    if (missing.length > 0) {
      console.warn("[PaymentInit] Missing required fields:", missing);
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

    const { isUserSuspendedOrBanned } = await import('@/lib/moderation/user-suspension');
    const { suspended: buyerSuspended } = await isUserSuspendedOrBanned(buyerId);
    if (buyerSuspended) {
      return NextResponse.json(
        { error: "Your account is suspended or banned. You cannot perform transactions." },
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
        .select("id, is_sold, title, price, user_id, category, moderation_status")
        .eq("id", itemId)
        .single();
        
      if (error) {
        console.error("[PaymentInit] Database error or item not found:", error);
        return NextResponse.json(
          { error: "Item not found or database error. Please try again." },
          { status: 404 }
        );
      }
      
      if (!['For Sale','Giveaway'].includes(data.category) || data.moderation_status !== 'approved') {
        return NextResponse.json({ error: 'Item unavailable' }, { status: 400 });
      }
      itemData = {
        ...data,
        item_type: 'post'
      };
    }

    if (itemData.user_id !== sellerId) {
      return NextResponse.json(
        { error: 'Seller does not own this item.' },
        { status: 403 }
      );
    }


    // Restore expired catalog stock even when it was reserved by another buyer.
    if (itemType === 'catalog_item' && await expireItemCheckoutReservations(itemId, itemType)) {
      const { data: stock, error } = await supabaseAdmin.from('catalog_items').select('in_stock').eq('id', itemId).single();
      if (error || !stock) throw error || new Error('Could not refresh stock');
      itemData.is_sold = !stock.in_stock;
    }

    // Resume the buyer's existing reservation before testing fresh stock.
    // Reserving the last catalog unit intentionally makes in_stock false.
    let activeQuery = supabaseAdmin.from('escrow_transactions')
      .select(RESERVATION_SELECT)
      .eq('item_id',itemId).eq('item_type',itemType)
      .in('status',['pending','paid','shipped','delivered','disputed','creating_escrow','reconciling']);
    if (itemType === 'catalog_item') activeQuery = activeQuery.eq('buyer_id',buyerId);
    const { data: activeTx, error: activeError } = await activeQuery.order('created_at',{ ascending:false }).limit(1);
    if (activeError) throw activeError;
    let existingTxToResume: any = null;
    let existing = activeTx?.[0];
    if (existing && await expireCheckoutReservation(existing)) existing = null;
    if (existing) {
      if (existing.buyer_id !== buyerId) return NextResponse.json({ error:'Item reserved by another buyer' },{ status:409 });
      if (['paid','shipped','delivered'].includes(existing.status)) return NextResponse.json({ success:true,alreadyPaid:true,transactionId:existing.id,totalAmount:existing.total_amount });
      if (existing.status === 'pending' && existing.payluk_escrow_id && existing.payluk_tx_ref) {
        const remote = await PaylukService.verifyEscrow(existing.payluk_tx_ref);
        const status = (remote.status || '').toUpperCase();
        if (['ONGOING','COMPLETED','CLAIMED'].includes(status)) {
          await applyEscrowPayment(existing.id,'payluk',existing.payluk_escrow_id);
          return NextResponse.json({ success:true,alreadyPaid:true,transactionId:existing.id,totalAmount:existing.total_amount });
        }
        if (status === 'PENDING' && remote.state === 'AWAITING_PAYMENT' && !reservationHasExpired(existing)) {
          const buyerPaylukId = await getPaylukCustomerId(buyerId);
          return NextResponse.json({ success:true,transactionId:existing.id,totalAmount:existing.total_amount,
            paylukPaymentToken:existing.payluk_tx_ref,paylukEscrowId:existing.payluk_escrow_id,buyerPaylukId });
        }
        await flagPayment('payluk',existing.payluk_escrow_id,existing.id,'retry_requires_review');
        return NextResponse.json({ error:'Previous checkout requires reconciliation. Contact support.' },{ status:409 });
      }
      if (existing.status === 'pending' && !existing.payluk_escrow_id) {
        if (reservationHasExpired(existing)) return NextResponse.json({ error: 'Checkout expiry is being reconciled. Please try again shortly.' }, { status: 409 });
        existingTxToResume = existing;
      }
      else {
        const lockAge = Date.now() - Date.parse(existing.creating_escrow_started_at || existing.updated_at);
        if (existing.status === 'creating_escrow' && lockAge >= 60_000) {
          const { error } = await supabaseAdmin.from('escrow_transactions').update({ status:'reconciling' })
            .eq('id',existing.id).eq('status','creating_escrow');
          if (error) throw error;
          await flagPayment('payluk',existing.payluk_escrow_id || existing.id,existing.id,'stale_creation');
        }
        return NextResponse.json({ error:'Checkout is in progress or awaiting reconciliation. No new charge was started.' },{ status:409 });
      }
    }

    if (itemData?.is_sold && !existingTxToResume) {
      return NextResponse.json(
        { error: "Item is no longer available." },
        { status: 400 }
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
    const authorizedPrice = Number(itemData.price);

    if (!isPaidPrice(authorizedPrice)) {
      return NextResponse.json(
        { error: `Item price must be at least ₦${MARKETPLACE_CONSTANTS.MIN_PRICE.toLocaleString()} for escrow payment processing.` },
        { status: 400 }
      );
    }
    // Yrdly's 3% commission is collected from the buyer as an additional fee.
    // Payluk's own escrow fee is charged to the seller via whoPays: 'seller' below,
    // while the escrow principal remains the seller's item price.
    const commission = Math.round(authorizedPrice * MARKETPLACE_CONSTANTS.COMMISSION_RATE * 100) / 100;
    const totalAmount = Math.round((authorizedPrice + commission) * 100) / 100;

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
        seller_amount: authorizedPrice,
        status: EscrowStatus.PENDING,
        payment_method: PaymentMethod.CARD,
        delivery_details: { option: DeliveryOption.FACE_TO_FACE },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        item_type: itemType,
      };

      const { data: txData, error: txError } = await supabaseAdmin.rpc('create_checkout_reservation', { p_payload: txPayload });

      if (txError) {
        console.error("[PaymentInit] Escrow reservation insert error:", txError);
        
        // 23505 = PostgreSQL Unique Violation (idx_escrow_transactions_single_active_post)
        if (txError.code === '23514' || txError.code === '23505' || txError.message?.includes('idx_escrow_transactions_single_active_post')) {
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

      transactionId = txData;
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
        return NextResponse.json({ error:'Checkout state changed. Please retry.' }, { status:409 });
      }

      // Winner of the atomic claim proceeds to call PaylukService.createEscrow()
      let submittedToProvider = false;
      const setupDeadline = AbortSignal.timeout(20_000);
      try {
        // Either identity lookup may create a customer; Payluk locks concurrent creates.
        buyerPaylukId = await getPaylukCustomerId(buyerId);
        sellerPaylukId = await getPaylukCustomerId(sellerId);

        // Payluk can lock concurrent permission writes under the same merchant.
        await PaylukService.updateCustomerPermissions(buyerPaylukId,{ canBuy:true },setupDeadline);
        await PaylukService.updateCustomerPermissions(sellerPaylukId,{ canSell:true },setupDeadline);
        submittedToProvider = true;
        const paylukEscrow = await PaylukService.createEscrow(sellerPaylukId, {
          amount: authorizedPrice,
          purpose: itemData.title,
          whoPays: 'seller',
          maxDelivery: 7,
          deliveryTimeline: 'days',
        },setupDeadline);

        paylukPaymentToken = paylukEscrow.paymentToken;
        paylukEscrowId = paylukEscrow.id;
        const providerFee = paylukEscrow.fee;
        if (!Number.isFinite(providerFee) || providerFee < 0 || providerFee > authorizedPrice) {
          throw new Error('Invalid Payluk escrow fee. Checkout requires reconciliation.');
        }
        const sellerAmount = Math.round((authorizedPrice - providerFee) * 100) / 100;
        const { data: persisted, error: persistError } = await supabaseAdmin.from('escrow_transactions')
          .update({ payment_provider:'payluk',payluk_tx_ref:paylukPaymentToken,payluk_escrow_id:paylukEscrowId,seller_amount:sellerAmount })
          .eq('id',transactionId).eq('status','creating_escrow').select('id').maybeSingle();
        if (persistError || !persisted) throw new Error('Could not persist payment setup');
        if (commission > 0) await PaylukService.addAdditionalFee(paylukPaymentToken,commission,setupDeadline);
      } catch (paylukError: any) {
        const verificationResponse = phoneVerificationResponse(paylukError, authenticatedBuyerId);
        const identityResponse = paymentIdentityResponse(paylukError, authenticatedBuyerId);
        if (!verificationResponse && !identityResponse) console.error("[PaymentInit] Payluk createEscrow error:", paylukError);
        
        if (!submittedToProvider) {
          const { error } = await supabaseAdmin.rpc('abandon_checkout_reservation',{ p_transaction_id:transactionId });
          if (error) throw error;
        } else {
          const { error } = await supabaseAdmin.from('escrow_transactions').update({ status:'reconciling' })
            .eq('id',transactionId).eq('status','creating_escrow');
          if (error) throw error;
          await flagPayment('payluk',paylukEscrowId || transactionId,transactionId,'creation_uncertain');
        }

        if (verificationResponse) return verificationResponse;
        if (identityResponse) return identityResponse;

        return NextResponse.json(
          { error: paylukError?.message || "Failed to initialize Payluk escrow" },
          { status: 502 }
        );
      }
    }

    // ── STEP 3: Update local reservation with Payluk details & reset status to PENDING ──
    if (totalAmount > 0 && paylukPaymentToken && paylukEscrowId) {
      const { data: finalized, error: updateErr } = await supabaseAdmin
        .from("escrow_transactions")
        .update({
          status: EscrowStatus.PENDING,
          payment_provider: 'payluk',
          payluk_tx_ref: paylukPaymentToken,
          payluk_escrow_id: paylukEscrowId,
          updated_at: new Date().toISOString()
        })
        .eq("id", transactionId).eq("status", "creating_escrow").select("id").maybeSingle();

      if (updateErr || !finalized) {
        await flagPayment('payluk',paylukEscrowId,transactionId,'creation_finalization_failed');
        return NextResponse.json({ error:'Payment setup requires reconciliation' },{ status:503 });
      }
    }

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
    const verificationResponse = phoneVerificationResponse(error, authenticatedBuyerId);
    if (verificationResponse) return verificationResponse;
    const identityResponse = paymentIdentityResponse(error, authenticatedBuyerId);
    if (identityResponse) return identityResponse;
    console.error("Payment initialization error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
