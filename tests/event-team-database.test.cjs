const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1),
  manager = id(2),
  staff = id(3),
  stranger = id(4),
  guest = id(5),
  expired = id(6),
  event = id(100),
  other = id(101);

test("event team database enforces account, event, invitation, role and admission boundaries", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated,anon;
      CREATE FUNCTION public.is_current_session_active() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('fixture.session_active',true),'true') <> 'false' $$;
      CREATE TABLE public.users(id uuid PRIMARY KEY,name text,username text,is_suspended boolean default false,is_banned boolean default false,status text default 'active');
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
      CREATE TABLE public.events(id uuid PRIMARY KEY,organizer_id uuid,title text,start_time timestamptz,status text);
      GRANT SELECT ON public.events TO authenticated;
      CREATE TABLE public.ticket_tiers(id uuid PRIMARY KEY,name text);
      CREATE TABLE public.tickets(id uuid PRIMARY KEY,buyer_id uuid,event_id uuid,tier_id uuid,ticket_code text,status text,refund_status text,expires_at timestamptz,attendee_name text,attendee_email text,scanned_at timestamptz,scanned_by uuid,updated_at timestamptz,amount_paid numeric);
      CREATE TABLE public.notifications(user_id uuid,type text,data jsonb,
        CONSTRAINT notifications_type_check CHECK (type IN ('event_invite','message')));
      CREATE VIEW public.notification_fixture AS SELECT * FROM public.notifications;
      CREATE FUNCTION public.create_notification(uuid,text,text,text,uuid,uuid,text,jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.notification_fixture VALUES ($1,$2,$8); RETURN gen_random_uuid(); END $$;
      INSERT INTO public.events VALUES ('${event}','${owner}','Main event',now()+interval '1 day','PUBLISHED'),('${other}','${owner}','Other event',now()+interval '1 day','PUBLISHED');
      INSERT INTO public.ticket_tiers VALUES ('${id(200)}','General');
    `);
    for (const [who, name] of [
      [owner, "Owner"],
      [manager, "Manager"],
      [staff, "Door staff"],
      [stranger, "Stranger"],
      [guest, "Guest"],
      [expired, "Expired invitation"],
    ]) {
      await db.query(
        "INSERT INTO public.users(id,name,username) VALUES($1,$2,$2)",
        [who, name],
      );
      await db.query("INSERT INTO auth.users VALUES($1,$2,now())", [
        who,
        `${name.replaceAll(" ", "").toLowerCase()}@example.test`,
      ]);
    }
    await db.query(
      "INSERT INTO public.tickets(id,event_id,tier_id,ticket_code,status,attendee_name,scanned_at,scanned_by) VALUES($1,$2,$3,$4,$5,$6,now(),$7)",
      [id(299), event, id(200), "LEGACY", "USED", "Legacy guest", owner],
    );
    const baseline = fs.readFileSync(
      "supabase/migrations/20261003030000_launch_security_hardening.sql",
      "utf8",
    );
    const guardStart = baseline.indexOf(
      "CREATE OR REPLACE FUNCTION public.guard_ticket_client_update()",
    );
    const guardEnd = baseline.indexOf(
      "DROP TRIGGER IF EXISTS tr_guard_ticket_client_update",
      guardStart,
    );
    assert.ok(guardStart >= 0 && guardEnd > guardStart);
    await db.exec(baseline.slice(guardStart, guardEnd));
    await db.exec(
      "CREATE TRIGGER tr_guard_ticket_client_update BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_client_update()",
    );
    await db.exec(
      fs.readFileSync(
        "supabase/migrations/20261023180233_event_team_checkin.sql",
        "utf8",
      ),
    );
    async function as(who, sql, args = []) {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
        who || "",
      ]);
      await db.exec("SET ROLE authenticated");
      try {
        return await db.query(sql, args);
      } finally {
        await db.exec("RESET ROLE");
      }
    }
    const mutate = async (
      who,
      action,
      targetRole = null,
      member = null,
      email = null,
      target = null,
    ) =>
      (
        await as(
          who,
          "SELECT public.event_team_mutate($1,$2,$3,$4,$5,$6) AS result",
          [event, action, email, target, targetRole, member],
        )
      ).rows[0].result;
    const scan = async (who, code, ev = event) =>
      (
        await as(who, "SELECT public.event_team_checkin($1,$2) AS result", [
          ev,
          code,
        ])
      ).rows[0].result;
    const snapshot = async (who) =>
      (
        await as(who, "SELECT public.event_team_snapshot($1) AS result", [
          event,
        ])
      ).rows[0].result;
    async function ticket(n, status = "PAID", refund = null, expired = false) {
      await db.query(
        "INSERT INTO public.tickets(id,event_id,tier_id,ticket_code,status,refund_status,expires_at,attendee_name,attendee_email,amount_paid) VALUES($1,$2,$3,$4,$5,$6,now()+$7::interval,$8,$9,5000)",
        [
          id(n),
          event,
          id(200),
          `TICKET-${n}`,
          status,
          refund,
          expired ? "-1 day" : "2 days",
          `Attendee ${n}`,
          "private@example.test",
        ],
      );
      return `TICKET-${n}`;
    }
    await t.test('email invitations fail atomically with the legacy notification constraint', async () => {
      await assert.rejects(
        mutate(owner, 'invite', 'manager', null, 'manager@example.test'),
        error => error.code === '23514' && error.message.includes('notifications_type_check'),
      );
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.event_team_members')).rows[0].n, 0);
    });
    await db.exec(fs.readFileSync('supabase/migrations/20261028101434_allow_event_team_invite_notifications.sql', 'utf8'));
    await t.test('notification extension preserves existing types and still rejects unknown types', async () => {
      await db.query("INSERT INTO public.notifications(type) VALUES ('message')");
      await db.query("DELETE FROM public.notifications WHERE type='message'");
      await assert.rejects(db.query("INSERT INTO public.notifications(type) VALUES ('unknown_type')"), error => error.code === '23514');
    });
    await t.test(
      "legacy admissions retain their scanner and history after the migration",
      async () => {
        const records = (
          await db.query(
            "SELECT ticket_id,scanned_by FROM public.event_checkin_log",
          )
        ).rows;
        assert.deepEqual(records, [{ ticket_id: id(299), scanned_by: owner }]);
      },
    );
    let managerMember, staffMember;
    await t.test(
      "pending invitation is account-bound, idempotent and grants no access",
      async () => {
        managerMember = (
          await mutate(owner, "invite", "manager", null, "manager@example.test")
        ).member_id;
        const again = await mutate(
          owner,
          "invite",
          "manager",
          null,
          "manager@example.test",
        );
        assert.equal(again.member_id, managerMember);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM public.notification_fixture",
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(snapshot(manager), /Forbidden/);
        await assert.rejects(scan(manager, "X"), /Forbidden/);
        await assert.rejects(
          mutate(stranger, "accept", null, managerMember),
          /Invitation not found/,
        );
        assert.equal(
          (await mutate(manager, "accept", null, managerMember)).status,
          "active",
        );
        assert.equal((await snapshot(manager)).role, "manager");
      },
    );
    await t.test(
      "managers can invite staff but cannot create, demote, revoke or impersonate a manager",
      async () => {
        await assert.rejects(
          mutate(manager, "invite", "manager", null, "stranger@example.test"),
          /organiser/,
        );
        await assert.rejects(
          mutate(manager, "update_role", "checkin", managerMember),
          /organiser/,
        );
        await assert.rejects(
          mutate(manager, "revoke", null, managerMember),
          /organiser/,
        );
        staffMember = (
          await mutate(
            manager,
            "invite",
            "checkin",
            null,
            "doorstaff@example.test",
          )
        ).member_id;
        await mutate(staff, "accept", null, staffMember);
        await assert.rejects(
          mutate(staff, "invite", "checkin", null, "stranger@example.test"),
          /Forbidden/,
        );
        await assert.rejects(
          mutate(staff, "update_role", "manager", staffMember),
          /Forbidden/,
        );
        await assert.rejects(
          as(stranger, "SELECT public.event_team_snapshot($1)", [event]),
          /Forbidden/,
        );
      },
    );
    await t.test(
      "one admission updates ticket and records scanner exactly once; a different event cannot use it",
      async () => {
        const code = await ticket(300);
        const valid = await scan(staff, code.toLowerCase());
        assert.equal(valid.valid, true);
        assert.equal(valid.attendee_name, "Attendee 300");
        assert.equal(valid.attendee_email, undefined);
        assert.equal((await scan(manager, code)).error, "ALREADY_SCANNED");
        assert.equal((await scan(owner, code, other)).error, "INVALID_TICKET");
        assert.equal(
          (
            await db.query(
              "SELECT scanned_by FROM public.tickets WHERE id=$1",
              [id(300)],
            )
          ).rows[0].scanned_by,
          staff,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM public.event_checkin_log",
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "expired, refunded, refund-pending and unpaid tickets cannot enter",
      async () => {
        assert.equal(
          (await scan(staff, await ticket(301, "PAID", null, true))).error,
          "TICKET_EXPIRED",
        );
        assert.equal(
          (await scan(staff, await ticket(302, "REFUNDED"))).error,
          "TICKET_INVALID",
        );
        assert.equal(
          (await scan(staff, await ticket(303, "PAID", "pending"))).error,
          "REFUND_IN_PROGRESS",
        );
        assert.equal(
          (await scan(staff, await ticket(304, "PENDING"))).error,
          "TICKET_INVALID",
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM public.event_checkin_log",
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "operational snapshots exclude financial/contact data and staff only see their own history",
      async () => {
        await scan(owner, await ticket(305));
        const view = await snapshot(staff);
        assert.equal(view.members.length, 1);
        assert.equal(view.history.length, 1);
        assert.deepEqual(view.guests, []);
        assert.equal(view.summary.checked_in, 3);
        assert.doesNotMatch(
          JSON.stringify(view),
          /private@example|amount_paid|5000|gross_revenue|attendee_email/,
        );
        assert.equal(view.history[0].attendee_name, undefined);
        const managerView = await snapshot(manager);
        assert.equal(managerView.history.length, 3);
        assert.ok(
          managerView.guests.some((g) => g.attendee_name === "Attendee 300"),
        );
        assert.doesNotMatch(
          JSON.stringify(managerView),
          /private@example|amount_paid|gross_revenue/,
        );
      },
    );
    await t.test(
      "revocation removes admission and snapshot access immediately; re-invitation needs acceptance",
      async () => {
        await mutate(manager, "revoke", null, staffMember);
        await assert.rejects(scan(staff, await ticket(306)), /Forbidden/);
        await assert.rejects(snapshot(staff), /Forbidden/);
        await mutate(
          owner,
          "invite",
          "checkin",
          null,
          "doorstaff@example.test",
        );
        await assert.rejects(scan(staff, "TICKET-306"), /Forbidden/);
        await mutate(staff, "accept", null, staffMember);
        assert.equal((await scan(staff, "TICKET-306")).valid, true);
      },
    );
    await t.test(
      "expired and declined invitations cannot authorize check-in",
      async () => {
        const invitation = (
          await mutate(
            owner,
            "invite",
            "checkin",
            null,
            "expiredinvitation@example.test",
          )
        ).member_id;
        await db.query(
          "UPDATE public.event_team_members SET expires_at=now()-interval '1 second' WHERE id=$1",
          [invitation],
        );
        await assert.rejects(
          mutate(expired, "accept", null, invitation),
          /no longer available/,
        );
        const list = (
          await as(expired, "SELECT public.event_team_assignments() AS result")
        ).rows[0].result;
        assert.equal(list.assignments[0].status, "expired");
        const declined = (
          await mutate(
            owner,
            "invite",
            "checkin",
            null,
            "stranger@example.test",
          )
        ).member_id;
        await mutate(stranger, "decline", null, declined);
        await assert.rejects(
          mutate(stranger, "accept", null, declined),
          /no longer available/,
        );
        await assert.rejects(scan(stranger, "X"), /Forbidden/);
      },
    );
    await t.test(
      "direct client writes, anonymous RPCs, suspended accounts and inactive sessions are denied",
      async () => {
        await assert.rejects(
          as(
            staff,
            "UPDATE public.event_team_members SET role='manager' WHERE user_id=$1",
            [staff],
          ),
          /permission denied/,
        );
        await assert.rejects(
          as(staff, "UPDATE public.tickets SET status='USED'"),
          /permission denied/,
        );
        await db.exec("SET ROLE anon");
        try {
          await assert.rejects(
            db.query("SELECT public.event_team_assignments()"),
            /permission denied/,
          );
        } finally {
          await db.exec("RESET ROLE");
        }
        await db.query(
          "UPDATE public.users SET is_suspended=true WHERE id=$1",
          [staff],
        );
        await assert.rejects(scan(staff, "X"), /Account unavailable/);
        await db.query(
          "UPDATE public.users SET is_suspended=false WHERE id=$1",
          [staff],
        );
        await db.exec(
          "SELECT set_config('fixture.session_active','false',false)",
        );
        await assert.rejects(snapshot(staff), /Invalid session/);
        await db.exec(
          "SELECT set_config('fixture.session_active','true',false)",
        );
      },
    );
    await t.test(
      "compatible admission updates cannot forge payment or scanner and always record history",
      async () => {
        await ticket(308);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
          staff,
        ]);
        await assert.rejects(
          db.query("UPDATE public.tickets SET amount_paid=1 WHERE id=$1", [
            id(308),
          ]),
          /payment and identity/,
        );
        await assert.rejects(
          db.query(
            "UPDATE public.tickets SET status='USED',scanned_at=now(),scanned_by=$2 WHERE id=$1",
            [id(308), stranger],
          ),
          /active ticket/,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM public.event_checkin_log WHERE ticket_id=$1",
              [id(308)],
            )
          ).rows[0].n,
          0,
        );
        await db.query(
          "UPDATE public.tickets SET status='USED',scanned_at=now(),scanned_by=$2 WHERE id=$1",
          [id(308), staff],
        );
        assert.equal(
          (
            await db.query(
              "SELECT scanned_by FROM public.event_checkin_log WHERE ticket_id=$1",
              [id(308)],
            )
          ).rows[0].scanned_by,
          staff,
        );
      },
    );
    await t.test(
      "cancelled and unpublished events cannot admit guests",
      async () => {
        const code = await ticket(307);
        for (const status of ["CANCELLED", "DRAFT", "COMPLETED"]) {
          await db.query("UPDATE public.events SET status=$1 WHERE id=$2", [
            status,
            event,
          ]);
          await assert.rejects(
            scan(staff, code),
            /cancelled|not open|published|admission/i,
          );
        }
        assert.equal(
          (
            await db.query("SELECT status FROM public.tickets WHERE id=$1", [
              id(307),
            ])
          ).rows[0].status,
          "PAID",
        );
      },
    );
  } finally {
    await db.close();
  }
});
