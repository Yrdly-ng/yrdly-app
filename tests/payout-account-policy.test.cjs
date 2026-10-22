const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const seller = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-000000000002';
const stranger = '00000000-0000-4000-8000-000000000003';
const migration = fs.readFileSync('supabase/migrations/20261022010913_remove_payout_account_cooldown.sql', 'utf8');

test('payout account policy removes waiting without bypassing reservation/retry safeguards', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.seller_accounts (id uuid PRIMARY KEY, user_id uuid, is_active boolean, verification_status text, account_updated_at timestamptz);
      CREATE TABLE public.escrow_transactions (seller_id uuid, seller_amount numeric, status text, item_type text, payment_provider text);
      CREATE TABLE public.payout_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, account_id uuid, amount numeric, status text, transaction_id uuid, payment_provider text, transaction_reference text, failure_reason text);
      INSERT INTO public.seller_accounts VALUES ('${account}', '${seller}', true, 'verified', now());
      INSERT INTO public.escrow_transactions VALUES ('${seller}', 10000, 'completed', 'post', 'payluk');
    `);
    await db.exec(migration);
    const reserve = (owner = seller, amount = 100) => db.query('SELECT public.reserve_seller_payout($1,$2,$3,10000,NULL) AS id', [owner, account, amount]);
    let payout;
    const requeue = (reference = 'attempt-one', status = 'failed', owner = seller) => db.query('SELECT public.requeue_seller_payout($1,$2,10000,$3,$4) AS accepted', [payout, owner, reference, status]);
    await t.test('a newly updated verified account reserves funds immediately', async () => {
      payout = (await reserve()).rows[0].id;
      assert.ok(payout);
      await db.query("UPDATE public.payout_requests SET status='failed', transaction_reference='attempt-one' WHERE id=$1", [payout]);
    });
    await t.test('inactive and unverified accounts cannot reserve or retry', async () => {
      for (const update of ["is_active=false", "verification_status='pending'"]) {
        await db.exec(`UPDATE public.seller_accounts SET ${update}`);
        await assert.rejects(reserve(), /Verified payout account required/);
        assert.equal((await requeue()).rows[0].accepted, false);
        await db.exec("UPDATE public.seller_accounts SET is_active=true, verification_status='verified'");
      }
    });
    await t.test('account ownership is still required', async () => {
      await assert.rejects(reserve(stranger), /Verified payout account required/);
      assert.equal((await requeue('attempt-one', 'failed', stranger)).rows[0].accepted, false);
    });
    await t.test('stale references and stale statuses cannot retry', async () => {
      assert.equal((await requeue('old-attempt')).rows[0].accepted, false);
      assert.equal((await requeue('attempt-one', 'processing')).rows[0].accepted, false);
    });
    await t.test('a newly updated verified account retries exactly once', async () => {
      assert.equal((await requeue()).rows[0].accepted, true);
      assert.equal((await requeue()).rows[0].accepted, false);
    });
    await t.test('reserved balances remain protected', async () => {
      await assert.rejects(reserve(seller, 10000), /Insufficient unreserved balance/);
    });
    await t.test('only the service role can call payout functions', async () => {
      for (const signature of ['reserve_seller_payout(uuid,uuid,numeric,numeric,uuid)', 'requeue_seller_payout(uuid,uuid,numeric,text,text)']) {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          const result = await db.query('SELECT has_function_privilege($1, $2, $3) AS allowed', [role, `public.${signature}`, 'EXECUTE']);
          assert.equal(result.rows[0].allowed, role === 'service_role');
        }
      }
    });
  } finally { await db.close(); }
});
