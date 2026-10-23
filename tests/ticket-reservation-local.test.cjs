const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const buyer = id(1), otherBuyer = id(2), owner = id(3), event = id(10), tier = id(20);

async function database(capacity = 5) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.users(id uuid PRIMARY KEY);
    CREATE TABLE public.events(id uuid PRIMARY KEY,organizer_id uuid,status text,end_time timestamptz);
    CREATE TABLE public.ticket_tiers(id uuid PRIMARY KEY,event_id uuid,price numeric,sold integer DEFAULT 0,capacity integer,is_visible boolean DEFAULT true,sale_ends_at timestamptz);
    CREATE TABLE public.escrow_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id text,item_type text,buyer_id uuid,seller_id uuid,amount numeric,commission numeric,total_amount numeric,seller_amount numeric,status text,payment_method text,delivery_details jsonb,payment_provider text,payment_reference text,metadata jsonb,payluk_escrow_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz);
    CREATE TABLE public.tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,tier_id uuid,buyer_id uuid,status text,payment_tx_ref text,purchase_ticket_index integer,refund_status text);
    CREATE UNIQUE INDEX idx_tickets_payment_purchase_ordinal ON public.tickets(payment_tx_ref,purchase_ticket_index) WHERE payment_tx_ref IS NOT NULL AND purchase_ticket_index IS NOT NULL;
    INSERT INTO public.users VALUES ('${buyer}'),('${otherBuyer}'),('${owner}');
    INSERT INTO public.events VALUES ('${event}','${owner}','PUBLISHED',now()+interval '1 day');
    INSERT INTO public.ticket_tiers(id,event_id,price,capacity) VALUES ('${tier}','${event}',2000,${capacity});
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261011065344_reserve_paid_ticket_checkout.sql', 'utf8'));
  const latest = fs.readFileSync('supabase/migrations/20261011173901_enforce_paid_price_minimum.sql', 'utf8');
  const start = latest.indexOf('CREATE OR REPLACE FUNCTION public.reserve_ticket_checkout(');
  const end = latest.indexOf('CREATE OR REPLACE FUNCTION public.create_checkout_reservation(', start);
  assert.ok(start >= 0 && end > start);
  await db.exec(latest.slice(start, end));
  await db.exec('CREATE TRIGGER tr_adjust_ticket_tier_sold BEFORE INSERT OR UPDATE OF status,tier_id OR DELETE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.adjust_ticket_tier_sold()');
  return db;
}

async function reserve(db, quantity, who = buyer, extra = {}) {
  const result = await db.query('SELECT public.reserve_ticket_checkout($1::jsonb) AS result', [JSON.stringify({ buyer_id: who, tier_id: tier, event_id: event, quantity, ...extra })]);
  return result.rows[0].result;
}
async function issue(db, tx, quantity, who = buyer) {
  return db.query(`INSERT INTO public.tickets(event_id,tier_id,buyer_id,status,payment_tx_ref,purchase_ticket_index)
    SELECT $1,$2,$3,'PAID',$4,n FROM generate_series(0,$5::integer-1) AS n RETURNING id`, [event,tier,who,tx.id,quantity]);
}
async function seats(db) {
  const result = await db.query(`SELECT sold,(SELECT coalesce(sum(remaining),0)::integer FROM public.ticket_checkout_reservations) AS reserved,(SELECT count(*)::integer FROM public.tickets) AS tickets FROM public.ticket_tiers WHERE id=$1`, [tier]);
  return result.rows[0];
}

test('real reservation functions preserve quantity, reserve once, and convert five holds to five tickets atomically', async () => {
  const db = await database();
  try {
    const first = await reserve(db, 5);
    const second = await reserve(db, 5);
    assert.equal(first.newly_created, true);
    assert.equal(second.newly_created, false);
    assert.equal(first.transaction.id, second.transaction.id);
    assert.equal(first.transaction.amount, 10000);
    assert.equal(first.transaction.commission, 300);
    assert.deepEqual(await seats(db), { sold: 0, reserved: 5, tickets: 0 });
    await assert.rejects(reserve(db, 1, otherBuyer), /ticket_tier_sold_out/);
    await assert.rejects(reserve(db, 4), /ticket_checkout_quantity_changed/);
    await issue(db, first.transaction, 5);
    assert.deepEqual(await seats(db), { sold: 5, reserved: 0, tickets: 5 });
    // BEFORE INSERT guards execute before duplicate purchase indexes. The
    // service must re-read the winner after this rejection instead of refunding.
    await assert.rejects(issue(db, first.transaction, 5), /ticket_buyer_limit|ticket_tier_sold_out/);
    assert.deepEqual(await seats(db), { sold: 5, reserved: 0, tickets: 5 });
  } finally { await db.close(); }
});

test('batch issuance rolls back all seats when the purchased quantity cannot fit', async () => {
  const db = await database(1);
  try {
    await assert.rejects(issue(db, { id: id(100) }, 2), /ticket_tier_sold_out/);
    assert.deepEqual(await seats(db), { sold: 0, reserved: 0, tickets: 0 });
  } finally { await db.close(); }
});

test('a different buyer cannot consume a reserved seat and unpaid links cannot be freed by time alone', async () => {
  const db = await database(1);
  try {
    const { transaction: tx } = await reserve(db, 1);
    await assert.rejects(issue(db, tx, 1, otherBuyer), /ticket_tier_sold_out/);
    await db.query("UPDATE public.ticket_checkout_reservations SET expires_at=now()-interval '1 hour'");
    await assert.rejects(reserve(db, 1, otherBuyer), /ticket_tier_sold_out/);
    await db.query("UPDATE public.escrow_transactions SET payluk_escrow_id='provider-id' WHERE id=$1", [tx.id]);
    await assert.rejects(db.query('SELECT public.release_ticket_checkout($1)', [tx.id]), /provider_deletion_confirmation_required/);
    assert.deepEqual(await seats(db), { sold: 0, reserved: 1, tickets: 0 });
    await db.query('SELECT public.release_ticket_checkout($1,$2)', [tx.id, 'provider-id']);
    assert.deepEqual(await seats(db), { sold: 0, reserved: 0, tickets: 0 });
    assert.equal((await reserve(db, 1, otherBuyer)).newly_created, true);
  } finally { await db.close(); }
});

test('database refuses wrong event, organiser purchases, invalid quantities, hidden tiers, and low paid prices', async () => {
  const db = await database();
  try {
    await assert.rejects(reserve(db, 1, buyer, { event_id: id(999) }), /ticket_checkout_unavailable/);
    await assert.rejects(reserve(db, 1, owner), /ticket_checkout_unavailable/);
    for (const quantity of [0, 6]) await assert.rejects(reserve(db, quantity), /invalid_ticket_checkout/);
    await db.query('UPDATE public.ticket_tiers SET is_visible=false');
    await assert.rejects(reserve(db, 1), /ticket_checkout_unavailable/);
    await db.query('UPDATE public.ticket_tiers SET is_visible=true,price=1199');
    await assert.rejects(reserve(db, 1), /invalid_ticket_checkout/);
    assert.deepEqual(await seats(db), { sold: 0, reserved: 0, tickets: 0 });
    const permissions = await db.query("SELECT has_function_privilege('authenticated','public.reserve_ticket_checkout(jsonb)','EXECUTE') AS client, has_function_privilege('service_role','public.reserve_ticket_checkout(jsonb)','EXECUTE') AS server");
    assert.deepEqual(permissions.rows[0], { client: false, server: true });
  } finally { await db.close(); }
});
