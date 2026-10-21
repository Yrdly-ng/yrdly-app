const { test } = require("node:test");
const assert = require("node:assert/strict");

test("the persona manifest defines exactly 50 distinct disclosed fictional identities", async () => {
  const { personas, validatePersonas } =
    await import("../scripts/managed-accounts/personas.mjs");
  assert.equal(validatePersonas(personas), true);
  assert.equal(personas.length, 50);
  assert.equal(new Set(personas.map((p) => p.name)).size, 50);
  assert.equal(new Set(personas.map((p) => p.username)).size, 50);
  for (const persona of personas) {
    assert.match(persona.bio, /fictional.*YRDLY/i);
    assert.ok(persona.interests.length >= 3);
    assert.ok(persona.writing_style.length > 20);
    assert.ok(persona.posting_preferences.formats.length >= 2);
  }
});

test("provisioning resumes after registration failure without creating a replacement identity", async () => {
  const { provisionAccounts } =
    await import("../scripts/managed-accounts/provision.mjs");
  const { personas } = await import("../scripts/managed-accounts/personas.mjs");
  const identities = [];
  const registered = new Map();
  let fail = true;
  const ports = {
    listUsers: async () => identities,
    createUser: async (attributes) => {
      const user = { id: `user-${identities.length + 1}`, ...attributes };
      identities.push(user);
      return user;
    },
    register: async (slot, id) => {
      if (slot === 2 && fail) throw new Error("Database unavailable");
      registered.set(slot, id);
    },
  };
  await assert.rejects(
    provisionAccounts(personas, "virtual.example.test", ports),
    /Database unavailable/,
  );
  fail = false;
  const result = await provisionAccounts(
    personas,
    "virtual.example.test",
    ports,
  );
  assert.equal(identities.length, 50);
  assert.equal(registered.size, 50);
  assert.equal(result.created, 48);
  assert.equal(registered.get(2), "user-2");
  assert.ok(identities.every((u) => u.ban_duration === "876000h"));
  const retry = await provisionAccounts(
    personas,
    "virtual.example.test",
    ports,
  );
  assert.equal(retry.created, 0);
});
