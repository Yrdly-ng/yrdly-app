-- A provider quote and a booked shipment can each belong to only one escrow order.
create unique index if not exists escrow_transactions_shipbubble_quote_id
  on public.escrow_transactions ((delivery_details ->> 'quote_id'))
  where delivery_details ->> 'option' = 'shipbubble' and delivery_details ->> 'quote_id' is not null;

create unique index if not exists escrow_transactions_shipbubble_shipment_id
  on public.escrow_transactions ((delivery_details ->> 'shipment_id'))
  where delivery_details ->> 'option' = 'shipbubble' and delivery_details ->> 'shipment_id' is not null;
