const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const actor = "11111111-1111-4111-8111-111111111111",
  owner = "22222222-2222-4222-8222-222222222222",
  report = "33333333-3333-4333-8333-333333333333",
  post = "44444444-4444-4444-8444-444444444444",
  comment = "55555555-5555-4555-8555-555555555555";
async function db() {
  const d = new PGlite();
  await d.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
CREATE TABLE users(id uuid primary key,name text,role text,is_admin boolean default false,is_suspended boolean default false,is_banned boolean default false,status text default 'active',suspension_reason text,suspended_at timestamptz);
CREATE TABLE posts(id uuid primary key,user_id uuid,text text,moderation_status text default 'approved');
CREATE TABLE comments(id uuid primary key,user_id uuid,text text);ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE TABLE reports(id uuid primary key,status text,category text,reported_post_id uuid,reported_user_id uuid);
CREATE TABLE post_reports(id uuid primary key,status text,post_id uuid);
CREATE TABLE comment_reports(id uuid primary key,status text,comment_id uuid,post_id uuid);
INSERT INTO users(id,name,role,is_admin) VALUES('${actor}','Admin','admin',true),('${owner}','Owner','user',false);
INSERT INTO posts(id,user_id,text) VALUES('${post}','${owner}','reported text');INSERT INTO comments(id,user_id,text) VALUES('${comment}','${owner}','reported comment');
INSERT INTO reports VALUES('${report}','open','Child safety','${post}',null);INSERT INTO post_reports VALUES('${report}','open','${post}');INSERT INTO comment_reports VALUES('${report}','open','${comment}','${post}');
SELECT set_config('request.jwt.claim.role','service_role',false);`);
  await d.exec(
    fs.readFileSync(
      "supabase/migrations/20261026170833_add_audited_account_moderation_actions.sql",
      "utf8",
    ),
  );
  await d.exec(
    fs.readFileSync(
      "supabase/migrations/20261103154337_audited_report_review.sql",
      "utf8",
    ),
  );
  return d;
}
const act = (
  d,
  kind,
  action,
  status = "open",
  who = actor,
  reason = "Reviewed evidence",
) =>
  d.query("SELECT admin_review_report($1,$2,$3,$4,$5,$6)", [
    who,
    kind,
    report,
    action,
    reason,
    status,
  ]);
test("resolve/dismiss/reopen preserve reports and write actor/reason; stale actions fail", async () => {
  const d = await db();
  try {
    await act(d, "general", "resolve");
    await assert.rejects(act(d, "general", "dismiss"));
    await assert.rejects(act(d, "general", "dismiss", "resolved"));
    await act(d, "general", "reopen", "resolved");
    await act(d, "general", "dismiss");
    const r = await d.query("SELECT status FROM reports");
    assert.equal(r.rows[0].status, "dismissed");
    assert.equal(
      (await d.query("SELECT * FROM report_review_actions")).rows.length,
      3,
    );
  } finally {
    await d.close();
  }
});
test("hide and restore persist content status, account actions retain case audit", async () => {
  const d = await db();
  try {
    await act(d, "post", "hide");
    assert.equal(
      (await d.query("SELECT moderation_status FROM posts")).rows[0]
        .moderation_status,
      "rejected",
    );
    await act(d, "post", "restore");
    await act(d, "comment", "hide");
    assert.equal(
      (await d.query("SELECT moderation_hidden FROM comments")).rows[0]
        .moderation_hidden,
      true,
    );
    await act(d, "comment", "restore");
    await act(d, "general", "ban");
    assert.equal(
      (await d.query("SELECT is_banned FROM users WHERE id=$1", [owner]))
        .rows[0].is_banned,
      true,
    );
    await act(d, "general", "unsuspend");
    assert.equal(
      (await d.query("SELECT is_banned FROM users WHERE id=$1", [owner]))
        .rows[0].is_banned,
      false,
    );
    assert.equal(
      (await d.query("SELECT * FROM report_review_actions")).rows.length,
      6,
    );
  } finally {
    await d.close();
  }
});
test("nonstaff, anonymous/authenticated callers and invalid reasons fail without audit", async () => {
  const d = await db();
  try {
    await assert.rejects(act(d, "general", "resolve", "open", owner));
    await assert.rejects(act(d, "general", "resolve", "open", actor, ""));
    await assert.rejects(act(d, "general", "resolve", null));
    for (const role of ["anon", "authenticated"]) {
      await d.exec(`SET ROLE ${role}`);
      await assert.rejects(act(d, "general", "resolve"));
      await d.exec("RESET ROLE");
    }
    assert.equal(
      (await d.query("SELECT * FROM report_review_actions")).rows.length,
      0,
    );
  } finally {
    await d.close();
  }
});
test("content owner cannot undo staff-hidden comment or insert hidden flags", async () => {
  const d = await db();
  try {
    await act(d, "comment", "hide");
    await d.exec(
      "SELECT set_config('request.jwt.claim.role','authenticated',false)",
    );
    await assert.rejects(d.exec("UPDATE comments SET moderation_hidden=false"));
    await assert.rejects(
      d.exec(
        `INSERT INTO comments(id,moderation_hidden) VALUES('66666666-6666-4666-8666-666666666666',true)`,
      ),
    );
    assert.equal(
      (await d.query("SELECT moderation_hidden FROM comments")).rows[0]
        .moderation_hidden,
      true,
    );
  } finally {
    await d.close();
  }
});
