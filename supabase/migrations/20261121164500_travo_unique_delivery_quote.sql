-- A Travo quote creates one provider order and may belong to only one checkout.
create unique index if not exists escrow_transactions_travo_quote_id
  on public.escrow_transactions ((delivery_details ->> 'quote_id'))
  where delivery_details ->> 'option' = 'travo' and delivery_details ->> 'quote_id' is not null;
