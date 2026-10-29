const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), buyer = id(2), other = id(3), event = id(10), tier = id(20);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE events(id uuid PRIMARY KEY,organizer_id uuid,title text,status text,end_time timestamptz,attendee_count integer DEFAULT 0);
    CREATE TABLE ticket_tiers(id uuid PRIMARY KEY,event_id uuid,name text,price numeric,capacity integer,sold integer DEFAULT 0,is_visible boolean DEFAULT true,sale_ends_at timestamptz);
    CREATE TABLE escrow_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id text,item_type text,buyer_id uuid,seller_id uuid,
      amount numeric,commission numeric,total_amount numeric,seller_amount numeric,status text,payment_method text,delivery_details jsonb,
      payment_provider text,payment_reference text UNIQUE,metadata jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz,
      payluk_escrow_id text,payluk_tx_ref text);
    CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),buyer_id uuid,event_id uuid,tier_id uuid,attendee_name text,attendee_email text,
      attendee_phone text,ticket_code text UNIQUE,qr_data text,status text,payment_tx_ref text,purchase_ticket_index integer,payment_provider text,
      settlement_mode text,payment_provider_ref text,amount_paid numeric,expires_at timestamptz,refund_status text,updated_at timestamptz);
    CREATE UNIQUE INDEX ticket_ordinal ON tickets(payment_tx_ref,purchase_ticket_index);
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,message text,sender_id uuid,related_id uuid,related_type text,data jsonb);
    -- Match the deployed legacy allowlist: a rejected notification must roll
    -- back ticket issuance too, so omitting this constraint hides that failure.
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
      'friend_request','friend_request_accepted','friend_request_declined','message','message_reaction',
      'post_like','post_comment','post_share','event_invite','event_reminder','event_cancelled','event_updated',
      'marketplace_item_sold','marketplace_item_interest','marketplace_message','community_update',
      'system_announcement','welcome','profile_view','mention','payment_successful','item_shipped',
      'delivery_confirmed','funds_released','dispute_opened','dispute_resolved','payout_processed','payout_failed',
      'catalog_item_inquiry','business_review_received','catalog_item_out_of_stock','new_follower','event_team_invite'
    ]));
    CREATE TABLE payment_reconciliation_flags(provider text,reference text,transaction_id uuid,reason text,UNIQUE(provider,reference,reason));
    INSERT INTO users VALUES('${owner}'),('${buyer}'),('${other}');
    INSERT INTO events(id,organizer_id,title,status,end_time) VALUES('${event}','${owner}','Sandbox event','PUBLISHED',now()+interval '2 days');
    INSERT INTO ticket_tiers(id,event_id,name,price,capacity) VALUES('${tier}','${event}','General',3000,5);
  `);
  await db.exec(readFileSync('supabase/migrations/20261011065344_reserve_paid_ticket_checkout.sql', 'utf8'));
  await db.exec('CREATE TRIGGER ticket_sold BEFORE INSERT OR UPDATE OR DELETE ON tickets FOR EACH ROW EXECUTE FUNCTION adjust_ticket_tier_sold()');
  await db.exec(readFileSync('supabase/migrations/20261028174041_paystack_ticket_checkout.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261028174051_paystack_event_financial_ledger.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261029081527_allow_ticket_purchase_notifications.sql', 'utf8'));
  let remoteId = 100;
  const payload = (qty = 2, who = buyer) => ({ event_id: event, tier_id: tier, buyer_id: who, quantity: qty, attendee_name: 'Buyer', attendee_email: 'buyer@example.test', attendee_phone: null });
  const reserve = async (qty = 2, who = buyer) => (await db.query('SELECT reserve_paystack_ticket_checkout($1::jsonb,$2) AS result', [JSON.stringify(payload(qty, who)), 'test'])).rows[0].result.transaction;
  const verified = tx => ({ id: remoteId++, status: 'success', reference: tx.payment_reference, currency: 'NGN', domain: 'test', amount: Number(tx.total_amount) * 100, fees: 9000, paid_at: new Date().toISOString(), metadata: { yrdly_transaction_id: tx.id } });
  const fulfill = async (tx, payment = verified(tx), quantity = tx.metadata.quantity) => (await db.query('SELECT fulfill_paystack_ticket_checkout($1,$2::jsonb,$3::jsonb) AS result', [tx.id, JSON.stringify(payment), JSON.stringify(Array.from({ length: quantity }, (_, index) => ({ index, ticket_code: `${tx.id}-${index}`, qr_data: '{}' })))])).rows[0].result;
  return { db, payload, reserve, verified, fulfill };
}

test('Paystack fulfillment binds payment and issues all tickets, reservation, notice and delivery exactly once', async () => {
  const { db, reserve, verified, fulfill } = await fixture();
  try {
    const tx = await reserve(3);
    assert.equal(tx.total_amount, 9000);
    assert.equal(tx.commission, 270);
    assert.equal((await reserve(3)).id, tx.id);
    const payment = verified(tx);
    for (const mutation of [{ amount: 1 }, { currency: 'USD' }, { domain: 'live' }, { reference: 'wrong' }, { metadata: {} }, { fees: null }]) {
      await assert.rejects(fulfill(tx, { ...payment, ...mutation }), /paystack_verification_mismatch/);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n, 0);
    const first = await fulfill(tx, payment);
    const replay = await fulfill(tx, payment);
    assert.equal(first.newly_issued, true);
    assert.equal(replay.newly_issued, false);
    assert.deepEqual(first.tickets, replay.tickets);
    assert.equal(first.tickets.length, 3);
    assert.equal((await db.query('SELECT sold FROM ticket_tiers')).rows[0].sold, 3);
    assert.equal((await db.query('SELECT remaining FROM ticket_checkout_reservations')).rows[0].remaining, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM paystack_ticket_delivery')).rows[0].n, 1);
    assert.equal(Number((await db.query('SELECT seller_amount FROM escrow_transactions')).rows[0].seller_amount), 8640);
    const earning = (await db.query('SELECT gross_kobo,commission_kobo,provider_fee_kobo,proceeds_kobo FROM paystack_event_earnings')).rows[0];
    assert.deepEqual(earning,{gross_kobo:900000,commission_kobo:27000,provider_fee_kobo:9000,proceeds_kobo:864000});
    assert.equal((await db.query('SELECT count(*)::int AS n FROM paystack_event_earnings')).rows[0].n,1);
    await assert.rejects(db.query("UPDATE events SET status='CANCELLED'"),/Refund or reconcile paid tickets/);
    await assert.rejects(fulfill(tx, { ...payment, id: 999 }), /paystack_transaction_mismatch/);
  } finally { await db.close(); }
});

test('a dispute arriving before fulfillment persists through earnings creation', async () => {
  const { db, reserve, fulfill } = await fixture();
  try {
    const tx = await reserve(1);
    await db.query('SELECT hold_paystack_event_order($1,$2)',[tx.id,'Dispute arrived before charge callback']);
    await fulfill(tx);
    const earning=(await db.query('SELECT financial_hold,hold_reason FROM paystack_event_earnings')).rows[0];
    assert.equal(earning.financial_hold,true);
    assert.match(earning.hold_reason,/before charge/);
    assert.equal((await db.query('SELECT is_test_payment FROM tickets')).rows[0].is_test_payment,true);
  } finally { await db.close(); }
});

test('active reservations prevent overselling and crossing payment providers', async () => {
  const { db, reserve, payload } = await fixture();
  try {
    await reserve(4);
    await assert.rejects(reserve(2, other), /ticket_tier_sold_out/);
    await assert.rejects(db.query('SELECT reserve_ticket_checkout($1::jsonb)', [JSON.stringify(payload(4))]), /finish_existing_provider_checkout/);
    await assert.rejects(reserve(1), /ticket_checkout_quantity_changed/);
    await assert.rejects(db.query("SELECT reserve_paystack_ticket_checkout($1::jsonb,'live')", [JSON.stringify(payload(4))]), /payment_environment_mismatch/);
    const { rows } = await db.query('SELECT transaction_id FROM ticket_checkout_reservations');
    await db.query('SELECT close_paystack_ticket_checkout($1)', [rows[0].transaction_id]);
    const legacy = (await db.query('SELECT reserve_ticket_checkout($1::jsonb) AS result', [JSON.stringify(payload(2))])).rows[0].result.transaction;
    assert.equal(legacy.payment_provider, 'payluk');
    await assert.rejects(reserve(2), /finish_existing_provider_checkout/);
  } finally { await db.close(); }
});

test('expired reservations release seats; later successful payment records refund review without issuing or overselling', async () => {
  const { db, reserve, verified, fulfill } = await fixture();
  try {
    const old = await reserve(5);
    await db.query("UPDATE ticket_checkout_reservations SET expires_at=now()-interval '1 minute' WHERE transaction_id=$1", [old.id]);
    const replacement = await reserve(5, other);
    assert.notEqual(replacement.id, old.id);
    const payment = verified(old);
    assert.equal((await fulfill(old, payment)).refund_required, true);
    assert.equal((await fulfill(old, payment)).refund_required, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_reconciliation_flags')).rows[0].n, 1);
    await fulfill(replacement);
    assert.equal((await db.query('SELECT sold FROM ticket_tiers')).rows[0].sold, 5);
    assert.equal((await db.query('SELECT state FROM paystack_ticket_orders WHERE transaction_id=$1', [old.id])).rows[0].state, 'refund_required');
  } finally { await db.close(); }
});

test('event cancellation, partial ticket payload, and buyer limits fail safely', async () => {
  const { db, reserve, verified, fulfill } = await fixture();
  try {
    const tx = await reserve(2);
    const payment = verified(tx);
    await assert.rejects(fulfill(tx, payment, 1), /invalid_ticket_payload/);
    assert.equal((await db.query('SELECT state FROM paystack_ticket_orders')).rows[0].state, 'reserved');
    await db.query("UPDATE events SET status='CANCELLED' WHERE id=$1", [event]);
    assert.equal((await fulfill(tx, payment)).refund_required, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 0);
    await db.query("UPDATE events SET status='PUBLISHED' WHERE id=$1", [event]);
    await fulfill(await reserve(5));
    await db.query('UPDATE ticket_tiers SET capacity=20 WHERE id=$1', [tier]);
    await assert.rejects(reserve(1), /ticket_buyer_limit/);
  } finally { await db.close(); }
});

test('financial checkout tables and RPCs are unavailable to browser roles', async () => {
  const { db, payload } = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT reserve_paystack_ticket_checkout($1::jsonb,$2)', [JSON.stringify(payload()), 'test']), /permission denied/);
      await assert.rejects(db.query('SELECT * FROM paystack_ticket_orders'), /permission denied/);
      await assert.rejects(db.query('SELECT * FROM paystack_event_webhooks'), /permission denied/);
      await assert.rejects(db.query('SELECT close_paystack_ticket_checkout($1)', [id(500)]), /permission denied/);
      await db.exec('RESET ROLE');
    }
  } finally { await db.close(); }
});

test('ticket notification migration preserves existing types and rejects unknown types', async () => {
  const { db } = await fixture();
  try {
    for (const type of ['event_team_invite', 'message', 'payment_successful', 'ticket_purchase']) {
      await db.query('INSERT INTO notifications(type) VALUES($1)', [type]);
    }
    await assert.rejects(db.query("INSERT INTO notifications(type) VALUES('not_a_notification_type')"), /notifications_type_check/);
    assert.equal((await db.query("SELECT convalidated FROM pg_constraint WHERE conname='notifications_type_check'")).rows[0].convalidated, true);
  } finally { await db.close(); }
});
