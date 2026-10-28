const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('database prevents new payment before acceptance and preserves unfinished legacy checkout', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TYPE payment_type_enum AS ENUM ('deposit','full','escrow');
      CREATE TABLE businesses(id uuid PRIMARY KEY, owner_id uuid, is_active boolean DEFAULT true);
      CREATE TABLE service_offerings(id uuid PRIMARY KEY,business_id uuid,is_active boolean DEFAULT true,
        escrow_enabled boolean DEFAULT true,requires_full_payment boolean DEFAULT false,deposit_required boolean DEFAULT false,
        price numeric DEFAULT 3000,deposit_amount numeric,deposit_percent numeric);
      CREATE TABLE bookings(id uuid PRIMARY KEY,customer_id uuid,business_id uuid,service_id uuid,
        status text DEFAULT 'requested',appointment_time timestamptz DEFAULT now()+interval '1 day',
        payment_status text DEFAULT 'unpaid',quote_id uuid,payment_flow text DEFAULT 'legacy');
      CREATE TABLE quote_requests(id uuid,customer_id uuid,business_id uuid,status text,converted_booking_id uuid,expires_at timestamptz,estimated_price numeric);
      CREATE TABLE escrow_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id text,item_type text,buyer_id uuid,seller_id uuid,
        amount numeric,commission numeric,total_amount numeric,seller_amount numeric,status text,payment_method text,
        delivery_details jsonb,payment_provider text,payment_reference text,metadata jsonb);
      CREATE TABLE booking_payments(id uuid DEFAULT gen_random_uuid(),booking_id uuid,amount numeric,type payment_type_enum,
        status text,provider text,payluk_reference text,escrow_hold boolean,escrow_transaction_id uuid,commission numeric,total_amount numeric,created_at timestamptz DEFAULT now());
      INSERT INTO businesses(id,owner_id) VALUES('${id(1)}','${id(2)}');
      INSERT INTO service_offerings(id,business_id) VALUES('${id(3)}','${id(1)}');
      INSERT INTO bookings(id,customer_id,business_id,service_id) VALUES('${id(4)}','${id(5)}','${id(1)}','${id(3)}');`);
    await db.exec(readFileSync('supabase/migrations/20261028170816_require_booking_acceptance_for_new_checkout.sql', 'utf8'));
    const reserve = () => db.query('SELECT reserve_booking_checkout($1,$2)', [id(4), id(5)]);
    await assert.rejects(reserve(), /business to accept/);
    assert.equal((await db.query('SELECT * FROM escrow_transactions')).rows.length, 0);
    await db.exec(`UPDATE bookings SET status='confirmed',payment_flow='staged_50_50'`);
    await assert.rejects(reserve(), /Staged service checkout is not available/);
    assert.equal((await db.query('SELECT * FROM escrow_transactions')).rows.length, 0);
    await db.exec(`UPDATE bookings SET payment_flow='legacy'`);
    await db.exec('UPDATE service_offerings SET price=1100');
    await assert.rejects(reserve(), /at least NGN 1200/);
    await db.exec('UPDATE service_offerings SET price=3000');
    const first = (await reserve()).rows[0].reserve_booking_checkout;
    assert.equal(first.newly_created, true);
    assert.equal(Number(first.transaction.commission), 90);
    await db.exec(`UPDATE bookings SET status='requested'`);
    const recovered = (await reserve()).rows[0].reserve_booking_checkout;
    assert.equal(recovered.newly_created, false);
    assert.equal(recovered.transaction.id, first.transaction.id);
    assert.equal((await db.query('SELECT * FROM escrow_transactions')).rows.length, 1);
    await assert.rejects(db.query('SELECT reserve_booking_checkout($1,$2)', [id(4), id(99)]), /booking_not_found/);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(reserve(), /permission denied/);
  } finally { await db.close(); }
});

function routeFor(booking) {
  let charges = 0;
  const rows = { bookings: booking, service_offerings: { price: 3000, escrow_enabled: true }, businesses: { owner_id: id(2), name: 'Studio' } };
  const db = {
    rpc: async () => ({ data: true }),
    from(table) { return { select() { return this; }, eq() { return this; }, single: async () => ({ data: rows[table] }) }; },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/supabase/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: id(5) } } }) },
    '@/lib/supabase/supabase-admin': { supabaseAdmin: db },
    '@/lib/marketplace/price-policy': { isPaidPrice: amount => amount >= 1200, MINIMUM_PRICE_MESSAGE: 'Invalid price' },
    '@/lib/bookings/booking-payments': {
      BookingCheckoutError: class extends Error {}, computeDepositAmount: () => null,
      createCheckoutForBooking: async () => { charges++; return { transactionId: id(8) }; },
    },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync('src/app/api/bookings/checkout/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  Function('require','module','exports',code)(name => mocks[name] || require(name), module, module.exports);
  return { post: () => module.exports.POST({ json: async () => ({ bookingId: booking.id }) }), charges: () => charges };
}
test('checkout API rejects unaccepted and paused staged bookings before creating provider payments', async () => {
  for (const scenario of [
    { status: 'requested', payment_status: 'unpaid', expected: 409 },
    { status: 'requested', payment_status: 'failed', expected: 409 },
    { status: 'confirmed', payment_flow: 'staged_50_50', expected: 503 },
    { status: 'confirmed', payment_flow: 'legacy', expected: 200 },
    { status: 'requested', payment_status: 'deposit_pending', payment_flow: 'legacy', expected: 200 },
  ]) {
    const row = { id: id(4), customer_id: id(5), service_id: id(3), business_id: id(1),
      appointment_time: new Date(Date.now()+86400000).toISOString(), ...scenario };
    const route = routeFor(row);
    assert.equal((await route.post()).status, scenario.expected);
    assert.equal(route.charges(), scenario.expected === 200 ? 1 : 0);
  }
});
