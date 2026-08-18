-- Migration: Add Paystack Subaccount fields to seller_accounts
-- Description: Adds paystack_subaccount_id and paystack_subaccount_status for automated split payouts via Paystack.

ALTER TABLE "public"."seller_accounts"
ADD COLUMN "paystack_subaccount_id" text,
ADD COLUMN "paystack_subaccount_status" text DEFAULT 'pending';
