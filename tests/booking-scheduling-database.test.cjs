const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),customer=id(2),stranger=id(3),business=id(10),staff=id(11),otherStaff=id(12),service=id(20),booking=id(30);
async function fixture(){
 const db=new PGlite({extensions:{btree_gist}});
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
 CREATE TABLE users(id uuid PRIMARY KEY);
 CREATE TABLE businesses(id uuid PRIMARY KEY,owner_id uuid,is_active boolean DEFAULT true,moderation_status text DEFAULT 'approved',mode text DEFAULT 'service');
 CREATE TABLE business_staff(id uuid PRIMARY KEY,business_id uuid,is_active boolean DEFAULT true);
 CREATE TABLE service_offerings(id uuid PRIMARY KEY,business_id uuid,duration_minutes integer DEFAULT 60,is_active boolean DEFAULT true,price numeric DEFAULT 3000,price_is_from boolean DEFAULT false,deposit_required boolean DEFAULT false,requires_full_payment boolean DEFAULT true,escrow_enabled boolean DEFAULT false);
 CREATE TABLE service_staff_assignments(service_id uuid,staff_id uuid);
 CREATE TABLE provider_availability(id uuid DEFAULT gen_random_uuid(),business_id uuid,staff_id uuid,day_of_week integer,start_time time DEFAULT '09:00',end_time time DEFAULT '17:00',is_available boolean DEFAULT true);
 CREATE TABLE availability_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,staff_id uuid,date date,is_blackout boolean,custom_start_time time,custom_end_time time,reason text);
 CREATE UNIQUE INDEX exception_default ON availability_exceptions(business_id,date) WHERE staff_id IS NULL;
 CREATE UNIQUE INDEX exception_staff ON availability_exceptions(business_id,staff_id,date) WHERE staff_id IS NOT NULL;
 CREATE TABLE bookings(id uuid PRIMARY KEY,customer_id uuid,business_id uuid,staff_id uuid,service_id uuid,quote_id uuid,status text DEFAULT 'requested',appointment_time timestamptz,end_time timestamptz,payment_status text DEFAULT 'unpaid',reminder_24h_sent boolean DEFAULT false,reminder_2h_sent boolean DEFAULT false,updated_at timestamptz);
 CREATE TABLE booking_payments(id uuid DEFAULT gen_random_uuid(),booking_id uuid,status text,escrow_transaction_id uuid);
 CREATE TABLE escrow_transactions(id uuid PRIMARY KEY,status text);
 CREATE TABLE business_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,user_id uuid,booking_id uuid,rating integer);
 CREATE TABLE quote_requests(id uuid PRIMARY KEY,customer_id uuid,business_id uuid,status text,converted_booking_id uuid,estimated_price numeric,expires_at timestamptz);
 ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_bookings ON bookings FOR ALL TO authenticated USING(customer_id=auth.uid() OR EXISTS(SELECT 1 FROM businesses WHERE id=business_id AND owner_id=auth.uid())) WITH CHECK(customer_id=auth.uid() OR EXISTS(SELECT 1 FROM businesses WHERE id=business_id AND owner_id=auth.uid()));
 GRANT SELECT,UPDATE ON bookings TO authenticated; GRANT SELECT ON businesses TO authenticated;
 INSERT INTO users VALUES('${owner}'),('${customer}'),('${stranger}');
 INSERT INTO businesses(id,owner_id) VALUES('${business}','${owner}');
 INSERT INTO business_staff(id,business_id) VALUES('${staff}','${business}'),('${otherStaff}','${business}');
 INSERT INTO service_offerings(id,business_id) VALUES('${service}','${business}');
 INSERT INTO provider_availability(business_id,staff_id,day_of_week) SELECT '${business}',s,d FROM unnest(ARRAY[NULL::uuid,'${staff}'::uuid,'${otherStaff}'::uuid]) s CROSS JOIN generate_series(0,6) d;
 `);
 for(const file of ['20261024154057_enforce_business_booking_schedule.sql','20261011082302_protect_booking_checkout_schedule.sql','20261028163323_booking_availability_and_reschedule_consent.sql','20261028170610_booking_provider_acceptance_price.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
 await db.exec('CREATE TRIGGER guard_booking_pending_checkout BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION public.guard_booking_pending_checkout()');
 const day=(await db.query("SELECT ((now() AT TIME ZONE 'Africa/Lagos')::date+10)::text AS day")).rows[0].day;
 const time=h=>`${day}T${h}:00:00+01:00`;
 await db.query('INSERT INTO bookings(id,customer_id,business_id,service_id,staff_id,appointment_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7)',[booking,customer,business,service,staff,time('09'),time('10')]);
 async function actor(user){await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('SET ROLE authenticated');}
 return {db,day,time,actor};
}
test('busy RPC crosses booking RLS without exposing identity; staff/default exceptions stay separate',async()=>{
 const {db,day,actor}=await fixture();try{
 await actor(stranger);assert.equal((await db.query('SELECT * FROM bookings')).rows.length,0);
 const busy=await db.query('SELECT * FROM booking_busy_intervals($1,$2,$3)',[business,day,staff]);
 assert.equal(busy.rows.length,1);assert.deepEqual(Object.keys(busy.rows[0]),['appointment_time','end_time']);
 assert.equal((await db.query('SELECT * FROM booking_busy_intervals($1,$2,$3)',[business,day,otherStaff])).rows.length,0);
 assert.equal((await db.query('SELECT * FROM booking_busy_intervals($1,$2)',[business,day])).rows.length,1);
 await assert.rejects(db.query('SELECT * FROM booking_busy_intervals($1,$2,$3,$4)',[business,day,staff,booking]),/Booking not found/);
 await assert.rejects(db.query('SELECT set_booking_availability_exception($1,$2,true)',[business,day]),/Only the business owner/);
 await actor(owner);
 await db.query('SELECT set_booking_availability_exception($1,$2,true)',[business,day]);
 await db.query("SELECT set_booking_availability_exception($1,$2,false,$3,'10:00','14:00')",[business,day,staff]);
 await db.query("SELECT set_booking_availability_exception($1,$2,false,NULL,'11:00','15:00')",[business,day]);
 await db.exec('RESET ROLE');const rows=(await db.query('SELECT staff_id,is_blackout,custom_start_time FROM availability_exceptions ORDER BY staff_id NULLS FIRST')).rows;
 assert.equal(rows.length,2);assert.equal(rows[0].custom_start_time,'11:00:00');assert.equal(rows[1].custom_start_time,'10:00:00');
 await db.exec('SET ROLE anon');await assert.rejects(db.query('SELECT * FROM booking_busy_intervals($1,$2)',[business,day]),/permission denied/);
 }finally{await db.close();}
});
test('reschedule requires counterparty, rechecks schedule and overlap, preserves booking and financial records',async()=>{
 const {db,time,actor}=await fixture();try{
 await actor(customer);
 await assert.rejects(db.query('UPDATE bookings SET appointment_time=$1,end_time=$2 WHERE id=$3',[time('11'),time('12'),booking]),/Request a time change/);
 const request=(await db.query('SELECT * FROM request_booking_reschedule($1,$2)',[booking,time('11')])).rows[0];
 await assert.rejects(db.query("SELECT respond_booking_reschedule($1,'accept')",[request.id]),/other party/);
 await actor(stranger);await assert.rejects(db.query("SELECT respond_booking_reschedule($1,'accept')",[request.id]),/Booking not found/);
 await actor(owner);await db.query("SELECT respond_booking_reschedule($1,'accept')",[request.id]);
 assert.equal(new Date((await db.query('SELECT appointment_time FROM bookings')).rows[0].appointment_time).toISOString(),new Date(time('11')).toISOString());
 await assert.rejects(db.query("SELECT respond_booking_reschedule($1,'accept')",[request.id]),/already been handled/);
 await actor(customer);const outside=(await db.query('SELECT * FROM request_booking_reschedule($1,$2)',[booking,time('18')])).rows[0];
 await actor(owner);await assert.rejects(db.query("SELECT respond_booking_reschedule($1,'accept')",[outside.id]),/booking_outside_hours/);
 await db.query("SELECT respond_booking_reschedule($1,'reject')",[outside.id]);
 await db.exec('RESET ROLE');await db.query('INSERT INTO bookings(id,customer_id,business_id,service_id,staff_id,appointment_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(31),stranger,business,service,staff,time('13'),time('14')]);
 await actor(customer);const conflict=(await db.query('SELECT * FROM request_booking_reschedule($1,$2)',[booking,time('13')])).rows[0];
 await actor(owner);await assert.rejects(db.query("SELECT respond_booking_reschedule($1,'accept')",[conflict.id]),e=>e.code==='23P01');
 await db.query("SELECT respond_booking_reschedule($1,'reject')",[conflict.id]);
 await assert.rejects(db.query("UPDATE bookings SET status='completed' WHERE id=$1",[booking]),/appointment has ended/);
 await db.exec('RESET ROLE');assert.equal((await db.query('SELECT * FROM private.booking_reschedule_permissions')).rows.length,0);
 await db.query("INSERT INTO booking_payments(booking_id,status) VALUES($1,'deposit_pending')",[booking]);
 await actor(customer);await assert.rejects(db.query('SELECT request_booking_reschedule($1,$2)',[booking,time('15')]),/Contact support/);
 }finally{await db.close();}
});
test('provider acceptance freezes final price, gates from-price and retains legacy financial bookings',async()=>{
 const {db,actor}=await fixture();try{
 await actor(customer);await assert.rejects(db.query('SELECT accept_service_booking($1)',[booking]),/Only the business owner/);
 await actor(owner);let result=(await db.query('SELECT * FROM accept_service_booking($1)',[booking])).rows[0];
 assert.equal(result.status,'confirmed');assert.equal(result.agreed_price,'3000');assert.equal(result.payment_flow,'staged_50_50');
 await assert.rejects(db.query('UPDATE bookings SET agreed_price=9000 WHERE id=$1',[booking]),/cannot be changed/);
 await assert.rejects(db.query("UPDATE bookings SET status='requested' WHERE id=$1",[booking]),/cannot return/);
 await db.exec('RESET ROLE');await db.query('UPDATE service_offerings SET price=9000 WHERE id=$1',[service]);
 await actor(owner);result=(await db.query('SELECT * FROM accept_service_booking($1)',[booking])).rows[0];assert.equal(result.agreed_price,'3000');
 }finally{await db.close();}
});

test('acceptance handles quote, free, minimum and preexisting checkout cases',async()=>{
 const {db,actor,time}=await fixture();try{
 await db.query('UPDATE service_offerings SET price_is_from=true WHERE id=$1',[service]);
 await actor(owner);await assert.rejects(db.query('SELECT accept_service_booking($1)',[booking]),/accepted customer quote/);
 await db.exec('RESET ROLE');const quote=id(50);
 await db.query("INSERT INTO quote_requests(id,customer_id,business_id,status,converted_booking_id,estimated_price) VALUES($1,$2,$3,'converted',$4,4200)",[quote,customer,business,booking]);
 await db.query('UPDATE bookings SET quote_id=$1 WHERE id=$2',[quote,booking]);
 await db.query("UPDATE quote_requests SET expires_at=now()-interval '1 hour' WHERE id=$1",[quote]);
 await actor(owner);await assert.rejects(db.query('SELECT accept_service_booking($1)',[booking]),/accepted customer quote/);
 await db.exec('RESET ROLE');await db.query("UPDATE quote_requests SET expires_at=now()+interval '1 day' WHERE id=$1",[quote]);
 await actor(owner);let accepted=(await db.query('SELECT * FROM accept_service_booking($1)',[booking])).rows[0];
 assert.equal(accepted.agreed_price,'4200');
 await db.exec('RESET ROLE');
 await db.query('INSERT INTO bookings(id,customer_id,business_id,service_id,staff_id,appointment_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(32),customer,business,service,staff,time('11'),time('12')]);
 await db.query('UPDATE service_offerings SET price_is_from=false,price=0,requires_full_payment=false WHERE id=$1',[service]);
 await actor(owner);accepted=(await db.query('SELECT * FROM accept_service_booking($1)',[id(32)])).rows[0];assert.equal(accepted.payment_flow,'legacy');assert.equal(accepted.agreed_price,null);
 await db.exec('RESET ROLE');
 await db.query('INSERT INTO bookings(id,customer_id,business_id,service_id,staff_id,appointment_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(33),customer,business,service,staff,time('13'),time('14')]);
 await db.query('UPDATE service_offerings SET price=1000,requires_full_payment=true WHERE id=$1',[service]);
 await actor(owner);await assert.rejects(db.query('SELECT accept_service_booking($1)',[id(33)]),/1,200/);
 await db.exec('RESET ROLE');await db.query("INSERT INTO booking_payments(booking_id,status) VALUES($1,'fully_paid')",[id(33)]);
 await actor(owner);accepted=(await db.query('SELECT * FROM accept_service_booking($1)',[id(33)])).rows[0];assert.equal(accepted.payment_flow,'legacy');assert.equal(accepted.agreed_price,null);
 }finally{await db.close();}
});

test('verified service reviews require the same completed customer booking and immutable attribution',async()=>{
 const {db}=await fixture();try{
 await assert.rejects(db.query('INSERT INTO business_reviews(business_id,user_id,booking_id) VALUES($1,$2,$3)',[business,customer,booking]),/completed booking/);
 // Historical fixture completion bypasses only the future-time guard; linkage guard stays active.
 await db.exec('ALTER TABLE bookings DISABLE TRIGGER guard_booking_time_changes');
 await db.query("UPDATE bookings SET status='completed' WHERE id=$1",[booking]);
 await db.exec('ALTER TABLE bookings ENABLE TRIGGER guard_booking_time_changes');
 await assert.rejects(db.query('INSERT INTO business_reviews(business_id,user_id,booking_id) VALUES($1,$2,$3)',[business,stranger,booking]),/completed booking/);
 const review=(await db.query('INSERT INTO business_reviews(business_id,user_id,booking_id) VALUES($1,$2,$3) RETURNING id',[business,customer,booking])).rows[0];
 await db.query('UPDATE business_reviews SET rating=5 WHERE id=$1',[review.id]);
 await assert.rejects(db.query('UPDATE business_reviews SET booking_id=NULL WHERE id=$1',[review.id]),/cannot be changed/);
 await db.query('INSERT INTO business_reviews(business_id,user_id) VALUES($1,$2)',[business,stranger]);
 }finally{await db.close();}
});
