const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('booking and quote actions are accepted without weakening the existing notification allowlist',async()=>{
 const db=new PGlite();try{
  await db.exec("CREATE TABLE notifications(id serial PRIMARY KEY,type text NOT NULL CONSTRAINT notifications_type_check CHECK(type IN ('message','ticket_purchase','event_team_invite')))");
  await assert.rejects(db.query("INSERT INTO notifications(type) VALUES ('booking_requested')"),/notifications_type_check/);
  await db.exec(fs.readFileSync('supabase/migrations/20261029164500_allow_booking_quote_notifications.sql','utf8'));
  for(const type of ['booking_requested','booking_confirmed','booking_cancelled','booking_no_show','quote_estimated','quote_converted','appeal_decided','message','ticket_purchase','event_team_invite']) await db.query('INSERT INTO notifications(type) VALUES ($1)',[type]);
  await assert.rejects(db.query("INSERT INTO notifications(type) VALUES ('arbitrary_claim')"),/notifications_type_check/);
 }finally{await db.close();}
});
