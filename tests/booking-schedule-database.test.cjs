const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = fs.readFileSync('supabase/migrations/20261024154057_enforce_business_booking_schedule.sql', 'utf8');

async function fixture() {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    CREATE TABLE businesses(id uuid PRIMARY KEY,owner_id uuid,is_active boolean,moderation_status text,mode text);
    CREATE TABLE service_offerings(id uuid PRIMARY KEY,business_id uuid,duration_minutes int,is_active boolean);
    CREATE TABLE business_staff(id uuid PRIMARY KEY,business_id uuid,is_active boolean);
    CREATE TABLE service_staff_assignments(service_id uuid,staff_id uuid);
    CREATE TABLE provider_availability(business_id uuid,staff_id uuid,day_of_week int,is_available boolean,start_time time,end_time time);
    CREATE TABLE availability_exceptions(business_id uuid,staff_id uuid,date date,is_blackout boolean,custom_start_time time,custom_end_time time);
    CREATE TABLE bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,service_id uuid,customer_id uuid,staff_id uuid,appointment_time timestamptz,end_time timestamptz,status text DEFAULT 'requested');
    INSERT INTO businesses VALUES('${id(1)}','${id(2)}',true,'approved','service');
    INSERT INTO service_offerings VALUES('${id(3)}','${id(1)}',60,true);
    INSERT INTO business_staff VALUES('${id(4)}','${id(1)}',true),('${id(5)}','${id(1)}',true);
    INSERT INTO provider_availability SELECT '${id(1)}',staff,2,true,'09:00'::time,'17:00'::time FROM (VALUES(null::uuid),('${id(4)}'::uuid),('${id(5)}'::uuid)) s(staff);
  `);
  return db;
}

function book(db, {staff = null, time = '2030-01-01T08:00:00Z', end = '2030-01-01T09:00:00Z', customer = id(9)} = {}) {
  return db.query('INSERT INTO bookings(business_id,service_id,customer_id,staff_id,appointment_time,end_time) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [id(1), id(3), customer, staff, time, end]);
}

test('database rejects off-hours, invalid duration, unavailable and unassigned staff before inserting', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await assert.rejects(book(db, {time:'2030-01-01T03:00:00Z',end:'2030-01-01T04:00:00Z'}), /booking_outside_hours/);
    await assert.rejects(book(db, {end:'2030-01-01T08:30:00Z'}), /booking_duration_invalid/);
    await assert.rejects(book(db, {staff:id(50)}), /booking_staff_unavailable/);
    await db.exec(`INSERT INTO service_staff_assignments VALUES('${id(3)}','${id(4)}')`);
    await assert.rejects(book(db, {staff:id(5)}), /booking_staff_unassigned/);
    await assert.rejects(book(db), /booking_staff_required/);
    await book(db, {staff:id(4)});
    assert.equal((await db.query('SELECT count(*)::int AS count FROM bookings')).rows[0].count, 1);
  } finally { await db.close(); }
});

test('competing bookings cannot overlap, default reservations block every staff, cancellation frees capacity', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    const competing = await Promise.allSettled([book(db,{staff:id(4)}),book(db,{staff:id(4)})]);
    assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(competing.find(r=>r.status==='rejected').reason.code,'23P01');
    await book(db,{staff:id(5)});
    await assert.rejects(book(db), error => error.code === '23P01');
    await db.exec("UPDATE bookings SET status='cancelled'");
    const booking = await book(db);
    await assert.rejects(book(db,{staff:id(4)}), error => error.code === '23P01');
    await book(db,{staff:id(4),time:'2030-01-01T09:00:00Z',end:'2030-01-01T10:00:00Z'});
    await assert.rejects(db.query("UPDATE bookings SET staff_id=$1,appointment_time='2030-01-01T09:30:00Z',end_time='2030-01-01T10:30:00Z' WHERE id=$2",[id(4),booking.rows[0].id]), error=>error.code==='23P01');
  } finally { await db.close(); }
});

test('blackouts, closed days, stale services and self-bookings cannot create requests', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await assert.rejects(book(db,{customer:id(2)}),/booking_self_not_allowed/);
    await assert.rejects(book(db,{time:'2030-01-02T08:00:00Z',end:'2030-01-02T09:00:00Z'}),/booking_outside_hours/);
    await db.exec(`INSERT INTO availability_exceptions VALUES('${id(1)}',null,'2030-01-01',true,null,null)`);
    await assert.rejects(book(db),/booking_outside_hours/);
    await db.exec('DELETE FROM availability_exceptions; UPDATE service_offerings SET is_active=false');
    await assert.rejects(book(db),/booking_service_unavailable/);
  } finally { await db.close(); }
});

test('migration refuses historical overlaps without silently changing bookings', async () => {
  const db = await fixture();
  try {
    await book(db); await book(db,{staff:id(4)});
    await assert.rejects(db.exec(migration), /booking_schedule_existing_conflicts/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM bookings')).rows[0].count,2);
  } finally { await db.close(); }
});
