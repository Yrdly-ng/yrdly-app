#!/usr/bin/env node
/**
 * seed-babcock-community.mjs
 * Creates "Babcock University Connect" community, seeds 30 students,
 * and makes feranmioyelowo@gmail.com the admin / owner.
 *
 * Usage:  node scripts/seed-babcock-community.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ── env ─────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
    ]),
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 30 realistic Babcock student names ──────────────────────────────────────
const STUDENTS = [
  { first: "Adebayo", last: "Ogunleye" },
  { first: "Chidinma", last: "Nwosu" },
  { first: "Oluwaseun", last: "Adekunle" },
  { first: "Ngozi", last: "Okoro" },
  { first: "Emeka", last: "Chukwuma" },
  { first: "Funke", last: "Adeyemi" },
  { first: "Tunde", last: "Bakare" },
  { first: "Blessing", last: "Okafor" },
  { first: "Chinedu", last: "Eze" },
  { first: "Aisha", last: "Ibrahim" },
  { first: "Damilola", last: "Oni" },
  { first: "Kemi", last: "Afolabi" },
  { first: "Obinna", last: "Nwachukwu" },
  { first: "Yetunde", last: "Fashola" },
  { first: "Samuel", last: "Adeniyi" },
  { first: "Fatima", last: "Abdullahi" },
  { first: "Uchenna", last: "Igwe" },
  { first: "Tolulope", last: "Oladipo" },
  { first: "Ifeanyi", last: "Anyanwu" },
  { first: "Bukola", last: "Salami" },
  { first: "Ebuka", last: "Obi" },
  { first: "Zainab", last: "Bello" },
  { first: "Tosin", last: "Akinyemi" },
  { first: "Chiamaka", last: "Onyekachi" },
  { first: "Kayode", last: "Olatunde" },
  { first: "Nkechi", last: "Uche" },
  { first: "Femi", last: "Ojukwu" },
  { first: "Halima", last: "Yusuf" },
  { first: "Ifeoma", last: "Nnamdi" },
  { first: "Dare", last: "Akinwale" },
];

const ADMIN_EMAIL = "feranmioyelowo@gmail.com";

// ── helpers ─────────────────────────────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function findOrCreateAuthUser(email, name) {
  // Check if auth user already exists
  const { data: listData } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const existing = listData?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) return existing.id;

  // Create auth user with a random password
  const password = `BU-${randomUUID().slice(0, 12)}!`;
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw new Error(`Auth createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function ensureProfileRow(userId, name, email) {
  const { data: existing } = await sb
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return;

  const { error } = await sb.from("users").insert({
    id: userId,
    name,
    email,
    home_state: "Ogun",
    home_lga: "Obafemi-Owode",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  // 23505 = unique violation → row already exists
  if (error && error.code !== "23505") throw error;
}

// ── main ────────────────────────────────────────────────────────────────────
async function run() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Seeding: Babcock University Connect community      ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // 1. Resolve admin user
  console.log(`1. Resolving admin user ${ADMIN_EMAIL}…`);
  const adminUserId = await findOrCreateAuthUser(ADMIN_EMAIL, "Feranmi Oyelowo");
  await ensureProfileRow(adminUserId, "Feranmi Oyelowo", ADMIN_EMAIL);
  console.log(`   ✅ Admin user ID: ${adminUserId}\n`);

  // 2. Create or find the community
  const communitySlug = slugify("babcock-university-connect");
  console.log(`2. Creating community "Babcock University Connect"…`);

  let communityId;
  const { data: existingComm } = await sb
    .from("communities")
    .select("id")
    .eq("slug", communitySlug)
    .maybeSingle();

  if (existingComm) {
    communityId = existingComm.id;
    console.log(`   ↳ Community already exists: ${communityId}`);
  } else {
    const { data: newComm, error: commErr } = await sb
      .from("communities")
      .insert({
        name: "Babcock University Connect",
        slug: communitySlug,
        description:
          "The official Babcock University student community on Yrdly. Connect with fellow BU students, share campus updates, find roommates, buy & sell textbooks, and stay plugged into campus life.",
        type: "interest",
        privacy: "open",
        state: "Ogun",
        lga: "Obafemi-Owode",
        is_official: false,
        post_daily_limit: 0,
        approval_status: "approved",
        created_by: adminUserId,
        owner_id: adminUserId,
      })
      .select("id")
      .single();
    if (commErr) throw commErr;
    communityId = newComm.id;
    console.log(`   ✅ Created community: ${communityId}`);
  }

  // 3. Add admin membership
  console.log(`\n3. Adding admin membership for ${ADMIN_EMAIL}…`);
  const { error: adminMemErr } = await sb
    .from("community_memberships")
    .upsert(
      {
        community_id: communityId,
        user_id: adminUserId,
        role: "admin",
        status: "active",
        is_auto_joined: false,
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "community_id,user_id" },
    );
  if (adminMemErr) throw adminMemErr;
  console.log("   ✅ Admin membership set\n");

  // 4. Create 30 student users and add them as members
  console.log("4. Seeding 30 student members…");
  let added = 0;
  for (const student of STUDENTS) {
    const name = `${student.first} ${student.last}`;
    const email = `${student.first.toLowerCase()}.${student.last.toLowerCase()}@babcock-seed.yrdly.ng`;

    try {
      const userId = await findOrCreateAuthUser(email, name);
      await ensureProfileRow(userId, name, email);

      const { error: memErr } = await sb
        .from("community_memberships")
        .upsert(
          {
            community_id: communityId,
            user_id: userId,
            role: "member",
            status: "active",
            is_auto_joined: false,
            joined_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "community_id,user_id" },
        );
      if (memErr) throw memErr;
      added++;
      console.log(`   ✅ [${added}/30] ${name}`);
    } catch (err) {
      console.error(`   ❌ Failed ${name}: ${err.message}`);
    }
  }

  // 5. Sync member_count
  console.log("\n5. Syncing member_count…");
  const { count } = await sb
    .from("community_memberships")
    .select("id", { count: "exact", head: true })
    .eq("community_id", communityId)
    .eq("status", "active");

  await sb
    .from("communities")
    .update({ member_count: count ?? added + 1, updated_at: new Date().toISOString() })
    .eq("id", communityId);
  console.log(`   ✅ member_count = ${count ?? added + 1}\n`);

  console.log("══════════════════════════════════════════════════════");
  console.log("Done! Community ID:", communityId);
  console.log("Admin:", ADMIN_EMAIL, "→", adminUserId);
  console.log(`Members: ${added} students + 1 admin = ${(count ?? added + 1)}`);
  console.log("══════════════════════════════════════════════════════");
}

run().catch((err) => {
  console.error("\n💥 Fatal:", err);
  process.exit(1);
});
