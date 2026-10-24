const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const ts = require("typescript");
const { createClient } = require("@supabase/supabase-js");

// Run the real service through supabase-js, replaying the PostgREST relationship
// ambiguity at the HTTP boundary. No credentials or live database are required.
function fixture() {
  const requests = [];
  const buyers = Array.from({ length: 6 }, (_, index) => ({
    id: `buyer-${index}`,
    name: `Neighbour ${index}`,
    avatar_url: null,
  }));
  const tickets = [
    ...buyers.flatMap((buyer) => [
      { event_id: "event-one", buyer },
      { event_id: "event-one", buyer },
    ]),
    { event_id: "event-two", buyer: buyers[0] },
    { event_id: "event-one", buyer: null },
  ];
  const supabase = createClient("https://fixture.supabase.co", "fixture-key", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input) => {
        const url = new URL(input);
        requests.push(url);
        if (url.pathname.endsWith("/events"))
          return Response.json([
            { id: "event-one", ticket_tiers: [] },
            { id: "event-two", ticket_tiers: [] },
            { id: "event-empty", ticket_tiers: [] },
          ]);
        assert.ok(url.pathname.endsWith("/tickets"));
        if (
          !url.searchParams
            .get("select")
            .includes("buyer:public_profiles!tickets_buyer_id_fkey(")
        ) {
          return Response.json(
            {
              code: "PGRST201",
              message:
                "More than one relationship was found for tickets and public_profiles",
            },
            { status: 300 },
          );
        }
        const eventFilter = url.searchParams.get("event_id");
        const data = eventFilter?.startsWith("eq.")
          ? tickets.filter((ticket) => ticket.event_id === eventFilter.slice(3))
          : tickets;
        return Response.json(
          data.slice(0, Number(url.searchParams.get("limit") || data.length)),
        );
      },
    },
  });
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync("src/lib/events/event-service.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("require", "module", "exports", code)(
    (name) => {
      if (name === "../supabase/supabase") return { supabase };
      if (name === "@/lib/shared/constants")
        return { EVENT_CONSTANTS: { COMMISSION_RATE: 0.05 } };
      throw Error(`Unexpected import: ${name}`);
    },
    module,
    module.exports,
  );
  return { service: module.exports, requests, buyers };
}

test("published events receive distinct buyers per event, capped at five", async () => {
  const { service, requests, buyers } = fixture();
  const events = await service.getPublishedEvents();
  assert.deepEqual(events[0].attendees, buyers.slice(0, 5));
  assert.deepEqual(events[1].attendees, [buyers[0]]);
  assert.deepEqual(events[2].attendees, []);
  const request = requests.find((url) => url.pathname.endsWith("/tickets"));
  assert.equal(request.searchParams.get("status"), "eq.PAID");
  assert.equal(
    request.searchParams.get("event_id"),
    "in.(event-one,event-two,event-empty)",
  );
});
test("event attendees resolve buyers and deduplicate before applying the requested limit", async () => {
  const { service, requests, buyers } = fixture();
  assert.deepEqual(
    await service.getEventAttendees("event-one", 2),
    buyers.slice(0, 2),
  );
  assert.equal(requests[0].searchParams.get("event_id"), "eq.event-one");
  assert.equal(requests[0].searchParams.get("status"), "eq.PAID");
});
