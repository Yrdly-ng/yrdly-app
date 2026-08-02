-- Migration: Add Row Level Security policies for public.disputes

-- 1. Ensure RLS is enabled on public.disputes
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- 2. SELECT Policy: Regular users can read their own disputes (opened by them, or where they are buyer/seller on the transaction)
CREATE POLICY "Users can read own disputes"
  ON public.disputes
  FOR SELECT
  TO authenticated
  USING (
    opened_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.escrow_transactions
      WHERE escrow_transactions.id = disputes.transaction_id
      AND (escrow_transactions.buyer_id = auth.uid() OR escrow_transactions.seller_id = auth.uid())
    )
  );

-- 3. INSERT Policy: Authenticated users can open disputes for their own transactions
CREATE POLICY "Users can insert own disputes"
  ON public.disputes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    opened_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.escrow_transactions
      WHERE escrow_transactions.id = transaction_id
      AND (escrow_transactions.buyer_id = auth.uid() OR escrow_transactions.seller_id = auth.uid())
    )
  );

-- 4. UPDATE Policy: Users can update evidence on disputes they are involved in
CREATE POLICY "Users can update own disputes evidence"
  ON public.disputes
  FOR UPDATE
  TO authenticated
  USING (
    opened_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.escrow_transactions
      WHERE escrow_transactions.id = disputes.transaction_id
      AND (escrow_transactions.buyer_id = auth.uid() OR escrow_transactions.seller_id = auth.uid())
    )
  )
  WITH CHECK (
    opened_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.escrow_transactions
      WHERE escrow_transactions.id = disputes.transaction_id
      AND (escrow_transactions.buyer_id = auth.uid() OR escrow_transactions.seller_id = auth.uid())
    )
  );
