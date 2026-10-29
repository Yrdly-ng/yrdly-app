const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),buyer=id(2),other=id(3),event=id(4),tier=id(5);
const migration = fs.readFileSync('supabase/migrations/20261029105549_event_cancellation_notifications.sql','utf8');
async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.users(id uuid PRIMARY KEY,name text,email text);
    CREATE TABLE public.events(id uuid PRIMARY KEY,organizer_id uuid,status text,title text,start_time timestamptz,location_address text,state text,updated_at timestamptz);
    CREATE TABLE public.ticket_tiers(id uuid PRIMARY KEY,event_id uuid,sold integer DEFAULT 0,capacity integer);
    CREATE TABLE public.ticket_checkout_reservations(transaction_id uuid,tier_id uuid,buyer_id uuid,remaining integer);
    CREATE TABLE public.tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,buyer_id uuid,tier_id uuid,status text,amount_paid numeric,attendee_name text,attendee_email text,refund_status text,updated_at timestamptz,payment_tx_ref text);
    CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text CHECK(type='event_cancelled'),title text,message text,sender_id uuid,related_id uuid,related_type text,data jsonb);
    INSERT INTO public.users VALUES ('${owner}','Organiser','owner@example.com'),('${buyer}','Buyer','fallback@example.com'),('${other}','Other buyer','other@example.com');
    INSERT INTO public.events VALUES ('${event}','${owner}','PUBLISHED','Our event',now()+interval '2 days','Lagos venue','Lagos',now());
    INSERT INTO public.ticket_tiers VALUES ('${tier}','${event}',0,100);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  // Run the existing stock/reservation and financial cancellation guards alongside
  // the new migration, so cancellation cannot silently bypass existing safety.
  const sold = fs.readFileSync('supabase/migrations/20261011065344_reserve_paid_ticket_checkout.sql','utf8');
  await db.exec(sold.slice(sold.indexOf('CREATE OR REPLACE FUNCTION public.adjust_ticket_tier_sold()'),sold.indexOf('REVOKE ALL ON FUNCTION public.reserve_ticket_checkout')));
  await db.exec('CREATE TRIGGER tr_adjust_ticket_tier_sold BEFORE INSERT OR UPDATE OR DELETE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.adjust_ticket_tier_sold();');
  const finance = fs.readFileSync('supabase/migrations/20261028174051_paystack_event_financial_ledger.sql','utf8');
  await db.exec(finance.slice(finance.indexOf('CREATE FUNCTION public.guard_paid_event_cancellation()'),finance.indexOf('REVOKE ALL ON FUNCTION public.record_paystack_event_earnings()')));
  if (!process.env.CANCELLATION_TEST_BEFORE_MIGRATION) await db.exec(migration);
  await db.exec('SET ROLE service_role');
  return db;
}
const rows = async(db,sql,args=[]) => (await db.query(sql,args)).rows;
const cancel = async(db,organizer=owner,eventId=event) => (await rows(db,'SELECT public.cancel_event_with_notifications($1,$2) AS result',[eventId,organizer]))[0].result;
const ticket = (db,{status='PAID',amount=0,email='attendee@example.com',name='Attendee',user=buyer,reference=null}={}) => db.query(
  'INSERT INTO public.tickets(event_id,buyer_id,tier_id,status,amount_paid,attendee_email,attendee_name,payment_tx_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[event,user,tier,status,amount,email,name,reference]);

test('free cancellation atomically invalidates tickets, snapshots deduplicated attendees and queues one notice per buyer', async()=>{
  const db=await database();try{
    await ticket(db,{email:' Person@Example.com ',name:'Person'});
    await ticket(db,{email:'person@example.com',user:other,name:'Person 2'});
    await ticket(db,{email:'second@example.com'});
    const result=await cancel(db);
    assert.equal(result.notificationsQueued,2);assert.equal(result.refundsRequested,0);assert.equal(result.alreadyCancelled,false);
    assert.deepEqual(await rows(db,'SELECT status FROM public.events'),[{status:'CANCELLED'}]);
    assert.equal((await rows(db,"SELECT count(*)::int AS count FROM public.tickets WHERE status='REFUNDED' AND refund_status='processed'"))[0].count,3);
    assert.deepEqual(await rows(db,'SELECT sold FROM public.ticket_tiers'),[{sold:0}]);
    const notices=await rows(db,'SELECT user_id,type,data FROM public.notifications ORDER BY user_id');
    assert.equal(notices.length,2);assert.equal(notices[0].data.eventId,event);
    const deliveries=await rows(db,'SELECT channel,recipient_key,event_title,event_location,status FROM public.event_cancellation_deliveries ORDER BY channel,recipient_key');
    assert.equal(deliveries.length,4);assert.deepEqual(deliveries.filter(x=>x.channel==='email').map(x=>x.recipient_key),['person@example.com','second@example.com']);
    assert.ok(deliveries.every(x=>x.event_title==='Our event'&&x.event_location==='Lagos venue'&&x.status==='pending'));
  }finally{await db.close()}
});

test('previously refunded paying attendees receive cancellation notice, account email is fallback only',async()=>{
  const db=await database();try{
    await ticket(db,{status:'REFUNDED',amount:3000,email:null});
    await ticket(db,{status:'REFUNDED',amount:2000,email:'paid@example.com',user:other});
    await cancel(db);
    const emails=await rows(db,"SELECT email FROM public.event_cancellation_deliveries WHERE channel='email' ORDER BY email");
    assert.deepEqual(emails,[{email:'fallback@example.com'},{email:'paid@example.com'}]);
    assert.equal((await rows(db,'SELECT count(*)::int AS count FROM public.notifications'))[0].count,2);
  }finally{await db.close()}
});

test('repeated cancellation preserves completed deliveries and original immutable snapshots',async()=>{
  const db=await database();try{
    await ticket(db);await cancel(db);
    await db.exec("UPDATE public.event_cancellation_deliveries SET status='sent',sent_at=now(); UPDATE public.events SET title='Edited title'; UPDATE public.tickets SET attendee_name='Changed',attendee_email='changed@example.com'");
    const before=await rows(db,'SELECT * FROM public.event_cancellation_deliveries ORDER BY id');
    const result=await cancel(db);assert.equal(result.alreadyCancelled,true);assert.equal(result.notificationsQueued,0);
    assert.deepEqual(await rows(db,'SELECT * FROM public.event_cancellation_deliveries ORDER BY id'),before);
    assert.equal((await rows(db,'SELECT count(*)::int AS count FROM public.notifications'))[0].count,1);
  }finally{await db.close()}
});

test('explicit cancellation retry repairs old cancelled events exactly once',async()=>{
  const db=await database();try{
    await ticket(db,{status:'REFUNDED',amount:0});await db.exec("UPDATE public.events SET status='CANCELLED'");
    assert.equal((await cancel(db)).notificationsQueued,1);assert.equal((await cancel(db)).notificationsQueued,0);
  }finally{await db.close()}
});

for(const [label,options] of [['paid',{amount:3000}],['unknown payment amount',{amount:null}],['checked in',{status:'USED',amount:0}]]){
  test(`${label} ticket blocks cancellation without partially changing free tickets or queuing notices`,async()=>{
    const db=await database();try{
      await ticket(db);await ticket(db,options);
      await assert.rejects(cancel(db),/event_cancellation_(paid|checked_in)_tickets/);
      assert.equal((await rows(db,'SELECT status FROM public.events'))[0].status,'PUBLISHED');
      assert.equal((await rows(db,"SELECT count(*)::int AS count FROM public.tickets WHERE status='REFUNDED'"))[0].count,0);
      assert.equal((await rows(db,'SELECT count(*)::int AS count FROM public.notifications'))[0].count,0);
      await assert.rejects(db.exec("UPDATE public.events SET status='CANCELLED'"),/Refund or reconcile/);
    }finally{await db.close()}
  });
}

test('wrong organiser, null organiser and unknown event are rejected',async()=>{
  const db=await database();try{
    await ticket(db);
    await assert.rejects(cancel(db,buyer),/event_cancellation_forbidden/);
    await assert.rejects(cancel(db,null),/event_cancellation_forbidden/);
    await assert.rejects(cancel(db,owner,id(99)),/event_not_found/);
    assert.equal((await rows(db,'SELECT status FROM public.events'))[0].status,'PUBLISHED');
  }finally{await db.close()}
});

test('notification insertion failure rolls back ticket inventory and event status together',async()=>{
  const db=await database();try{
    await ticket(db);await db.exec('RESET ROLE; ALTER TABLE public.notifications ADD CONSTRAINT reject_notice CHECK(false) NOT VALID; SET ROLE service_role');
    await assert.rejects(cancel(db),/reject_notice/);
    assert.equal((await rows(db,'SELECT status FROM public.events'))[0].status,'PUBLISHED');
    assert.equal((await rows(db,'SELECT status FROM public.tickets'))[0].status,'PAID');
    assert.equal((await rows(db,'SELECT sold FROM public.ticket_tiers'))[0].sold,1);
    assert.equal((await rows(db,'SELECT count(*)::int AS count FROM public.event_cancellation_deliveries'))[0].count,0);
  }finally{await db.close()}
});

test('private recipient snapshots and cancellation RPC are inaccessible to client roles',async()=>{
  const db=await database();try{
    await ticket(db);await cancel(db);await db.exec('RESET ROLE');
    const permissions=await rows(db,"SELECT has_function_privilege('authenticated','public.cancel_event_with_notifications(uuid,uuid)','EXECUTE') AS rpc,has_table_privilege('authenticated','public.event_cancellation_deliveries','SELECT') AS client,has_table_privilege('anon','public.event_cancellation_deliveries','SELECT') AS anon");
    assert.deepEqual(permissions,[{rpc:false,client:false,anon:false}]);
    assert.equal((await rows(db,"SELECT relrowsecurity FROM pg_class WHERE oid='public.event_cancellation_deliveries'::regclass"))[0].relrowsecurity,true);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(cancel(db),/permission denied/);
    await assert.rejects(db.exec('SELECT * FROM public.event_cancellation_deliveries'),/permission denied/);
  }finally{await db.close()}
});

test('late active ticket insert into cancelled event is rejected without consuming stock',async()=>{
  const db=await database();try{
    await cancel(db);await assert.rejects(ticket(db),/ticket_event_unavailable/);
    assert.equal((await rows(db,'SELECT sold FROM public.ticket_tiers'))[0].sold,0);
    assert.equal((await rows(db,'SELECT count(*)::int AS count FROM public.tickets'))[0].count,0);
    await ticket(db,{status:'REFUNDED',amount:3000}); // Historical reconciliation remains possible.
  }finally{await db.close()}
});

test('published free and paid issuance keep existing stock and reservation accounting',async()=>{
  const db=await database();try{
    await ticket(db);
    const tx=id(100);await db.query('INSERT INTO public.ticket_checkout_reservations VALUES($1,$2,$3,1)',[tx,tier,buyer]);
    await ticket(db,{amount:3000,reference:tx});
    assert.equal((await rows(db,'SELECT sold FROM public.ticket_tiers'))[0].sold,2);
    assert.equal((await rows(db,'SELECT remaining FROM public.ticket_checkout_reservations'))[0].remaining,0);
  }finally{await db.close()}
});
