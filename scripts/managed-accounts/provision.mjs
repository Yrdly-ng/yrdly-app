import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { personas, validatePersonas } from "./personas.mjs";

export async function provisionAccounts(entries, domain, ports) {
  validatePersonas(entries);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)) {
    throw new Error("Provide an owned email domain for managed identities");
  }
  domain = domain.toLowerCase();
  const existing = new Map(
    (await ports.listUsers()).map((u) => [u.email?.toLowerCase(), u]),
  );
  let created = 0;
  for (const persona of entries) {
    const email = `yrdly-virtual-${String(persona.slot).padStart(2, "0")}@${domain}`;
    let user = existing.get(email);
    if (user && user.app_metadata?.managed_virtual_slot !== persona.slot) {
      throw new Error(
        `Slot ${persona.slot}: existing identity is not a managed account`,
      );
    }
    if (!user) {
      user = await ports.createUser({
        email,
        password: randomBytes(48).toString("base64url"),
        email_confirm: false,
        ban_duration: "876000h",
        app_metadata: {
          managed_virtual_slot: persona.slot,
          account_kind: "managed_virtual",
        },
        user_metadata: {
          name: `${persona.name} · YRDLY virtual`,
          username: persona.username,
        },
      });
      created++;
    }
    // Registration repairs a partial previous run and verifies the Auth marker in SQL.
    await ports.register(persona.slot, user.id, persona);
  }
  return { registered: entries.length, created };
}

async function main() {
  validatePersonas(personas);
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify(
        { mode: "preview", count: personas.length, personas },
        null,
        2,
      ),
    );
    return;
  }
  const url = process.env.MANAGED_SUPABASE_URL;
  const key = process.env.MANAGED_SUPABASE_SERVICE_ROLE_KEY;
  const domain = process.env.MANAGED_ACCOUNT_EMAIL_DOMAIN;
  // Deliberately separate from normal app env: never accidentally target its production URL.
  if (!url || !key || !domain || process.env.MANAGED_CONFIRM_TARGET !== url) {
    throw new Error(
      "Set MANAGED_SUPABASE_URL, MANAGED_SUPABASE_SERVICE_ROLE_KEY, MANAGED_ACCOUNT_EMAIL_DOMAIN and matching MANAGED_CONFIRM_TARGET",
    );
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await provisionAccounts(personas, domain, {
    listUsers: async () => {
      const users = [];
      for (let page = 1; ; page++) {
        const { data, error } = await client.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (error)
          throw new Error("Could not inspect existing managed identities");
        users.push(...data.users);
        if (data.users.length < 1000) return users;
      }
    },
    createUser: async (attributes) => {
      const { data, error } = await client.auth.admin.createUser(attributes);
      if (error || !data.user)
        throw new Error("Identity creation failed; rerun to resume safely");
      return data.user;
    },
    register: async (slot, userId, persona) => {
      const { error } = await client.rpc("managed_virtual_register", {
        p_slot: slot,
        p_user_id: userId,
        p_persona: persona,
      });
      if (error)
        throw new Error(
          `Slot ${slot}: registration failed; rerun to resume safely (${error.code || "unknown"})`,
        );
    },
  });
  console.log(JSON.stringify({ ...result, status: "paused" }));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
