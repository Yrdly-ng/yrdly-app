import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DeliveryOption, PaymentMethod, EscrowStatus } from "@/types/escrow";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { getPostHogClient } from "@/lib/posthog-server";

/**
 * POST /api/marketplace/claim
 *
 * Claims a free marketplace item directly, bypassing payment gateways.
 * Marks the item as sold and creates an escrow transaction in PAID status.
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

    const body = await request.json();
    const {
      itemId,
      buyerId,
      sellerId,
    } = body as {
      itemId: string;
      buyerId: string;
      sellerId: string;
    };

    // ── Validate ──────────────────────────────────────────
    if (!itemId || !buyerId || !sellerId) {
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
        { error: "You cannot claim your own item" },
        { status: 400 }
      );
    }

    // ── Check availability and price ──────────────────────
    const { data: itemData, error: itemError } = await supabaseAdmin
      .from("posts")
      .select("id, is_sold, title, price, user_id")
      .eq("id", itemId)
      .single();

    if (itemError) {
      console.error("[ClaimInit] Database error or item not found:", itemError);
      return NextResponse.json(
        { error: "Item not found or database error. Please try again." },
        { status: 404 }
      );
    }

    if (itemData.is_sold) {
      return NextResponse.json(
        { error: "Item has already been claimed or is no longer available." },
        { status: 409 }
      );
    }

    if (itemData.price !== 0 && itemData.price !== null) {
      return NextResponse.json(
        { error: "Item is not free. Please use the Buy flow." },
        { status: 400 }
      );
    }

    if (itemData.user_id !== sellerId) {
      return NextResponse.json(
        { error: "Seller ID mismatch." },
        { status: 400 }
      );
    }

    // ── Create Transaction & Mark as Sold ────────────────

    // 1. Create the escrow transaction directly in PAID status
    // since it's free, it skips PENDING
    const { data: txData, error: txError } = await supabaseAdmin
      .from("escrow_transactions")
      .insert({
        item_id: itemId,
        buyer_id: buyerId,
        seller_id: sellerId,
        amount: 0,
        commission: 0,
        total_amount: 0,
        seller_amount: 0,
        status: EscrowStatus.PAID,
        payment_method: PaymentMethod.CARD, // Dummy value
        delivery_details: { option: DeliveryOption.FACE_TO_FACE },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        paid_at: new Date().toISOString(), // Mark as paid instantly
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

    // 2. Mark item as sold with all necessary fields
    const { error: updateError } = await supabaseAdmin
      .from("posts")
      .update({ 
        is_sold: true,
        sold_to_user_id: buyerId,
        sold_at: new Date().toISOString(),
        transaction_id: txData.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", itemId);

    if (updateError) {
      console.error("[ClaimInit] Failed to mark item as sold:", updateError);
      return NextResponse.json(
        { error: "Failed to update item status." },
        { status: 500 }
      );
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'free_item_claimed',
      properties: {
        item_id: itemId,
        transaction_id: txData.id,
        seller_id: sellerId,
      },
    });

    return NextResponse.json({
      success: true,
      transactionId: txData.id,
    });
  } catch (error) {
    console.error("Claim initialization error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
