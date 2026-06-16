-- Migration: Rename Flutterwave-specific columns to provider-agnostic names
-- Run this in the Supabase SQL editor for the Yardly project

-- 1. events table
ALTER TABLE public.events
  RENAME COLUMN flutterwave_subaccount_id TO payment_subaccount_id;

-- 2. tickets table
ALTER TABLE public.tickets
  RENAME COLUMN flutterwave_tx_ref TO payment_tx_ref;

ALTER TABLE public.tickets
  RENAME COLUMN flutterwave_flw_ref TO payment_provider_ref;

-- 3. event_payouts table (if transfer_id column exists)
ALTER TABLE public.event_payouts
  RENAME COLUMN flutterwave_transfer_id TO payment_transfer_id;

-- 4. escrow_transactions table
-- payment_reference column already exists (used to store flw numeric tx id)
-- no rename needed, but drop any flutterwave-specific columns if they exist
-- (check your schema - payment_reference is already generic)
