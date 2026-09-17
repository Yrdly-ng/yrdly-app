-- Add item_type to escrow_transactions
ALTER TABLE public.escrow_transactions 
ADD COLUMN item_type TEXT DEFAULT 'post' NOT NULL;

-- Add transaction_id to catalog_items if needed
ALTER TABLE public.catalog_items 
ADD COLUMN transaction_id UUID REFERENCES public.escrow_transactions(id);
