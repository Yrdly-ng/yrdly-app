const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner=id(1), buyer=id(2), event=id(3), tx=id(4), ticket=id(5);
async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.users(id uuid PRIMARY KEY);
    CREATE TABLE public.events(id uuid PRIMARY KEY,organizer_id uuid,status text,end_time timestamptz);
    CREATE TABLE public.escrow_transactions(id uuid PRIMARY KEY,item_type text,payment_provider text,status text,seller_id uuid,amount numeric,commission numeric,metadata jsonb);
    CREATE TABLE public.tickets(id uuid PRIMARY KEY,event_id uuid,buyer_id uuid,payment_provider text,status text,payment_tx_ref text,amount_paid numeric,refund_status text,updated_at timestamptz);
    CREATE TABLE public.paystack_ticket_orders(transaction_id uuid PRIMARY KEY,domain text,state text,provider_fee_kobo bigint,paid_at timestamptz);
    INSERT INTO public.users VALUES ('${owner}'),('${buyer}');
    INSERT INTO public.events VALUES ('${event}','${owner}','PUBLISHED',now()-interval '2 days');
    INSERT INTO public.escrow_transactions VALUES ('${tx}','ticket','paystack','pending','${owner}',3000,90,'{"event_id":"${event}"}');
    INSERT INTO public.paystack_ticket_orders VALUES ('${tx}','test','paid',4500,now());
    INSERT INTO public.tickets VALUES ('${ticket}','${event}','${buyer}','paystack','PAID','${tx}',3000,NULL,now());
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261028174051_paystack_event_financial_ledger.sql','utf8'));
  await db.exec(`UPDATE public.escrow_transactions SET status='paid' WHERE id='${tx}'`);
  return db;
}
const value = async (db,sql,args=[]) => (await db.query(sql,args)).rows[0].result;
const withdraw = db => value(db,'SELECT public.reserve_paystack_event_withdrawal($1,$2,$3,$4,$5,$6,$7,$8) AS result',[event,owner,'test',286500,'RCP_test','Sandbox Bank','Test Organiser','1234']);

test('verified paid order records commission/provider fee once and maturity gates withdrawals', async () => {
  const db=await database();
  try {
    const e=(await db.query('SELECT * FROM public.paystack_event_earnings')).rows[0];
    assert.equal(e.gross_kobo,300000); assert.equal(e.commission_kobo,9000); assert.equal(e.provider_fee_kobo,4500); assert.equal(e.proceeds_kobo,286500);
    await db.exec(`UPDATE public.events SET end_time=now()-interval '23 hours'`);
    await assert.rejects(withdraw(db),/event_withdrawal_unavailable/);
    const summary=await value(db,'SELECT public.get_paystack_event_totals($1,$2) AS result',[event,'test']);
    assert.equal(summary.availableKobo,0); assert.equal(summary.heldKobo,286500);
    await db.exec(`UPDATE public.events SET end_time=now()-interval '2 days'`);
    await withdraw(db);
    await assert.rejects(withdraw(db),/event_withdrawal_balance_changed/);
    await assert.rejects(value(db,'SELECT public.reserve_paystack_ticket_refund($1,$2) AS result',[ticket,owner]),/ticket_refund_requires_support/);
  } finally { await db.close(); }
});

test('refund intent blocks withdrawal/admission until confirmed and completion is idempotent', async () => {
  const db=await database();
  try {
    const refund=await value(db,'SELECT public.reserve_paystack_ticket_refund($1,$2) AS result',[ticket,owner]);
    assert.equal((await value(db,'SELECT public.reserve_paystack_ticket_refund($1,$2) AS result',[ticket,owner])).id,refund.id);
    await assert.rejects(withdraw(db),/event_refund_pending/);
    await assert.rejects(db.query('SELECT public.reconcile_paystack_ticket_refund($1,$2,$3,$4)',[refund.id,'123','processed',1]),/refund_verification_mismatch/);
    await db.query('SELECT public.reconcile_paystack_ticket_refund($1,$2,$3,$4)',[refund.id,'123','processed',300000]);
    await db.query('SELECT public.reconcile_paystack_ticket_refund($1,$2,$3,$4)',[refund.id,'123','processed',300000]);
    assert.equal((await db.query('SELECT refunded_kobo FROM public.paystack_event_earnings')).rows[0].refunded_kobo,300000);
    assert.equal((await db.query('SELECT status FROM public.tickets')).rows[0].status,'REFUNDED');
    const summary=await value(db,'SELECT public.get_paystack_event_totals($1,$2) AS result',[event,'test']);
    assert.equal(summary.availableKobo,0);
  } finally { await db.close(); }
});

test('uncertain transfer retains allocation; reversal holds funds for review', async () => {
  const db=await database();
  try {
    const w=await withdraw(db);
    await assert.rejects(db.query('SELECT public.reconcile_paystack_event_withdrawal($1,$2,$3,$4,$5)',[w.reference,'success',1,'RCP_test','TRF_test']),/withdrawal_verification_mismatch/);
    await db.query('SELECT public.reconcile_paystack_event_withdrawal($1,$2,$3,$4,$5)',[w.reference,'success',286500,'RCP_test','TRF_test']);
    await db.query('SELECT public.reconcile_paystack_event_withdrawal($1,$2,$3,$4,$5)',[w.reference,'pending',286500,'RCP_test','TRF_test']);
    assert.equal((await db.query('SELECT status FROM public.paystack_event_withdrawals')).rows[0].status,'success');
    await db.query('SELECT public.reconcile_paystack_event_withdrawal($1,$2,$3,$4,$5)',[w.reference,'reversed',286500,'RCP_test','TRF_test']);
    await assert.rejects(withdraw(db),/event_financial_review_required/);
  } finally { await db.close(); }
});

test('live, wrong owner, financial holds, and client RPC access are rejected', async () => {
  const db=await database();
  try {
    await assert.rejects(value(db,'SELECT public.reserve_paystack_event_withdrawal($1,$2,$3,$4,$5,$6,$7,$8) AS result',[event,owner,'live',286500,'RCP_test','Bank','Owner','1234']),/event_withdrawal_unavailable/);
    await assert.rejects(value(db,'SELECT public.reserve_paystack_ticket_refund($1,$2) AS result',[ticket,buyer]),/event_refund_forbidden/);
    await db.query('SELECT public.hold_paystack_event_order($1,$2)',[tx,'Chargeback']);
    await assert.rejects(withdraw(db),/event_financial_review_required/);
    const permissions=(await db.query("SELECT has_function_privilege('authenticated','public.reserve_paystack_ticket_refund(uuid,uuid)','EXECUTE') AS client,has_table_privilege('anon','public.paystack_event_earnings','SELECT') AS readable")).rows[0];
    assert.deepEqual(permissions,{client:false,readable:false});
  } finally { await db.close(); }
});
