const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createClient } = require("@supabase/supabase-js");
function load(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("module", "exports", "require", code)(
    module,
    module.exports,
    (name) => {
      if (name === "server-only") return {};
      if (name.startsWith("."))
        return load(path.resolve(path.dirname(file), name + ".ts"));
      return require(name);
    },
  );
  return module.exports;
}
const ID = "11111111-1111-4111-8111-111111111111";
function database(rows = {}) {
  return createClient("https://fixture.supabase.co", "fixture-anon", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: "Bearer viewer-token" },
      fetch: async (url, init) => {
        const request = new Request(url, init);
        assert.equal(
          request.headers.get("authorization"),
          "Bearer viewer-token",
        );
        const table = new URL(url).pathname.split("/").pop();
        const row = rows[table];
        return Response.json(
          row === undefined
            ? null
            : row && ["posts", "events"].includes(table)
              ? { moderation_status: "approved", ...row }
              : row,
        );
      },
    },
  });
}
test("a listing resolves only to its public area without exposing its seller's coordinate or address", async () => {
  const { resolveDirectionsDestination } = load(
    "src/lib/location/directions-destination.ts",
  );
  const result = await resolveDirectionsDestination(
    { type: "marketplace", id: ID },
    database({
      posts: {
        id: ID,
        title: "Desk",
        category: "For Sale",
        lat: 6.543219,
        lng: 3.123456,
        location: { address: "42 Private Home Road" },
        state: "Lagos",
        lga: "Ikeja",
        ward: "Ward A",
      },
      lga_wards: [{ latitude: 6.6, longitude: 3.3 }],
    }),
  );
  assert.equal(result.lat, 6.6);
  assert.equal(result.lng, 3.3);
  assert.equal(result.approximate, true);
  assert.equal(result.address, "Ward A, Ikeja, Lagos");
  assert.equal(result.href, `/marketplace/${ID}`);
  assert.doesNotMatch(JSON.stringify(result), /42 Private|6\.543219|3\.123456/);
});
test("physical business and event destinations keep published venue coordinates and images", async () => {
  const { resolveDirectionsDestination } = load(
    "src/lib/location/directions-destination.ts",
  );
  for (const [type, table, row, href] of [
    [
      "business",
      "businesses",
      {
        name: "Bakery",
        is_active: true,
        location: { address: "Market Square", lat: 6.4, lng: 3.2 },
        logo_url: "https://images.test/logo.png",
      },
      `/businesses/${ID}`,
    ],
    [
      "event",
      "events",
      {
        title: "Fair",
        status: "PUBLISHED",
        location_online: false,
        location_address: "Market Square",
        lat: 6.4,
        lng: 3.2,
        cover_image_url: "https://images.test/logo.png",
      },
      `/events/${ID}`,
    ],
    [
      "legacy-event",
      "posts",
      {
        title: "Fair",
        category: "Event",
        event_location: { address: "Market Square", lat: 6.4, lng: 3.2 },
        image_urls: ["https://images.test/logo.png"],
      },
      `/posts/${ID}`,
    ],
  ]) {
    const result = await resolveDirectionsDestination(
      { type, id: ID },
      database({ [table]: { id: ID, ...row } }),
    );
    assert.equal(result.lat, 6.4);
    assert.equal(result.lng, 3.2);
    assert.equal(result.address, "Market Square");
    assert.equal(result.approximate, false);
    assert.equal(result.image, "https://images.test/logo.png");
    assert.equal(result.href, href);
  }
});
test("hidden, draft, archived, online, inactive, sold, and wrong-category destinations cannot be routed", async () => {
  const { resolveDirectionsDestination } = load(
    "src/lib/location/directions-destination.ts",
  );
  for (const [type, table, row] of [
    ["event", "events", null],
    ["event", "events", { status: "DRAFT" }],
    ["event", "events", { status: "PUBLISHED", is_archived: true }],
    ["event", "events", { status: "PUBLISHED", location_online: true }],
    ["business", "businesses", { is_active: false }],
    ["marketplace", "posts", { category: "For Sale", is_sold: true }],
    ["marketplace", "posts", { category: "Discussion" }],
    ["legacy-event", "posts", { category: "Discussion" }],
    [
      "legacy-event",
      "posts",
      { category: "Event", event_link: "yrdly://events/new-event" },
    ],
  ]) {
    await assert.rejects(
      resolveDirectionsDestination(
        { type, id: ID },
        database({
          [table]: row && {
            id: ID,
            lat: 6.4,
            lng: 3.2,
            state: "Lagos",
            lga: "Ikeja",
            ward: "A",
            ...row,
          },
          lga_wards: [{ latitude: 6.6, longitude: 3.3 }],
        }),
      ),
      { status: 404, code: "DESTINATION_UNAVAILABLE" },
    );
  }
});
test("private and area-restricted events do not disclose a route to an unauthorized viewer", async () => {
  const { resolveDirectionsDestination } = load(
    "src/lib/location/directions-destination.ts",
  );
  for (const visibility of ["PRIVATE", "FRIENDS", "WARD_ONLY", "LGA_ONLY"]) {
    await assert.rejects(
      resolveDirectionsDestination(
        { type: "event", id: ID },
        database({
          events: {
            id: ID,
            title: "Restricted",
            status: "PUBLISHED",
            visibility,
            organizer_id: "owner",
            lat: 6.4,
            lng: 3.2,
            state: "Lagos",
            lga: "Ikeja",
            ward: "A",
          },
          users: { state: "Abuja", lga: "Abuja", ward: "B" },
        }),
        { userId: "viewer" },
      ),
      { status: 404 },
    );
  }
  const result = await resolveDirectionsDestination(
    { type: "event", id: ID },
    database({
      events: {
        id: ID,
        title: "Local",
        status: "PUBLISHED",
        visibility: "WARD_ONLY",
        lat: 6.4,
        lng: 3.2,
        state: "Lagos",
        lga: "Ikeja",
        ward: "A",
      },
      users: { state: "Lagos", lga: "Ikeja", ward: "A" },
    }),
    { userId: "viewer" },
  );
  assert.equal(result.title, "Local");
});
test("address-only venues can resolve while listings without a public area ask for a pickup point", async () => {
  const { resolveDirectionsDestination } = load(
    "src/lib/location/directions-destination.ts",
  );
  const result = await resolveDirectionsDestination(
    { type: "business", id: ID },
    database({
      businesses: {
        id: ID,
        name: "Bakery",
        is_active: true,
        location: "Market Square",
        state: "Lagos",
        lga: "Ikeja",
      },
    }),
    {
      geocode: async (address) => {
        assert.equal(address, "Market Square, Ikeja, Lagos, Nigeria");
        return { lat: 6.4, lng: 3.2, approximate: false };
      },
    },
  );
  assert.equal(result.address, "Market Square");
  assert.equal(result.lat, 6.4);
  await assert.rejects(
    resolveDirectionsDestination(
      { type: "marketplace", id: ID },
      database({
        posts: {
          id: ID,
          title: "Desk",
          category: "For Sale",
          lat: 6.543219,
          lng: 3.123456,
          location: { address: "42 Private Home Road" },
        },
      }),
      {
        geocode: async () => {
          assert.fail("A private listing address must never be geocoded");
        },
      },
    ),
    { status: 422 },
  );
});
test("destination and route endpoints require an active account before contacting providers", async () => {
  const { createDirectionsHandlers } = load(
    "src/lib/location/directions-service.ts",
  );
  const handlers = createDirectionsHandlers({
    authenticate: async () => ({ errorStatus: 401 }),
    consumeLimit: async () => {
      assert.fail("Unauthenticated request cannot spend rate limit");
    },
    fetch: async () => {
      assert.fail("Unauthenticated request cannot call Google");
    },
  });
  for (const [handler, request] of [
    [
      handlers.destination,
      new Request(
        `https://yrdly.test/api/directions/destination?type=event&id=${ID}`,
      ),
    ],
    [
      handlers.route,
      new Request("https://yrdly.test/api/directions/route", {
        method: "POST",
        body: "{}",
      }),
    ],
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("authenticated routes resolve the authorized destination and return sanitized driving and walking instructions", async () => {
  const { createDirectionsHandlers } = load(
    "src/lib/location/directions-service.ts",
  );
  const calls = [];
  const handlers = createDirectionsHandlers({
    authenticate: async () => ({
      userId: "viewer",
      client: database({
        businesses: {
          id: ID,
          name: "Bakery",
          is_active: true,
          lat: 6.4,
          lng: 3.2,
        },
      }),
    }),
    consumeLimit: async () => true,
    directionsKey: "private-key",
    fetch: async (url, init) => {
      calls.push(new URL(url));
      assert.equal(init.cache, "no-store");
      return Response.json({
        status: "OK",
        routes: [
          {
            overview_polyline: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
            warnings: ["Use <b>caution</b> &amp; check access"],
            copyrights: "Map data ©2026 Google",
            legs: [
              {
                distance: { value: 1250 },
                duration: { value: 901 },
                steps: [
                  {
                    html_instructions: "Turn <b>left</b> &amp; continue",
                    distance: { value: 120 },
                    duration: { value: 60 },
                  },
                ],
              },
            ],
          },
        ],
      });
    },
  });
  for (const mode of ["driving", "walking"]) {
    const response = await handlers.route(
      new Request("https://yrdly.test/api/directions/route", {
        method: "POST",
        body: JSON.stringify({
          destination: { type: "business", id: ID },
          origin: { lat: 6.5, lng: 3.4 },
          mode,
        }),
      }),
    );
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.destination.title, "Bakery");
    assert.equal(value.mode, mode);
    assert.equal(value.distance_meters, 1250);
    assert.equal(value.duration_seconds, 901);
    assert.equal(value.steps[0].instruction, "Turn left & continue");
    assert.deepEqual(value.warnings, [
      "Use caution & check access",
      "Map data ©2026 Google",
    ]);
    assert.doesNotMatch(JSON.stringify(value), /private-key/);
    assert.equal(calls.at(-1).searchParams.get("destination"), "6.4,3.2");
    assert.equal(calls.at(-1).searchParams.get("origin"), "6.5,3.4");
    assert.equal(calls.at(-1).searchParams.get("mode"), mode);
  }
});

test("invalid inputs, inaccessible destinations and rate limits never spend provider requests", async () => {
  const { createDirectionsHandlers } = load(
    "src/lib/location/directions-service.ts",
  );
  const base = {
    authenticate: async () => ({ userId: "viewer", client: database() }),
    consumeLimit: async () => true,
    fetch: async () => assert.fail("No provider call allowed"),
  };
  const handlers = createDirectionsHandlers(base);
  for (const destination of [
    { type: "friend", id: ID },
    { type: "event", id: ID, lat: 6.4, lng: 3.2 },
  ]) {
    const response = await handlers.route(
      new Request("https://yrdly.test", {
        method: "POST",
        body: JSON.stringify({
          destination,
          origin: { lat: 6.5, lng: 3.4 },
          mode: "driving",
        }),
      }),
    );
    assert.equal(response.status, 400);
  }
  assert.equal(
    (
      await handlers.destination(
        new Request(`https://yrdly.test?type=event&id=${ID}`),
      )
    ).status,
    404,
  );
  const limited = createDirectionsHandlers({
    ...base,
    consumeLimit: async () => false,
  });
  assert.equal(
    (
      await limited.destination(
        new Request(`https://yrdly.test?type=event&id=${ID}`),
      )
    ).status,
    429,
  );
});
test("provider denials, missing routes and malformed route lines return safe useful errors", async () => {
  const { createDirectionsHandlers } = load(
    "src/lib/location/directions-service.ts",
  );
  for (const [data, status] of [
    [
      {
        status: "REQUEST_DENIED",
        error_message: "key=private-key origin=6.5,3.4",
      },
      503,
    ],
    [{ status: "ZERO_RESULTS" }, 422],
    [
      {
        status: "OK",
        routes: [{ overview_polyline: { points: "broken" }, legs: [{}] }],
      },
      502,
    ],
  ]) {
    const handlers = createDirectionsHandlers({
      authenticate: async () => ({
        userId: "viewer",
        client: database({
          businesses: {
            id: ID,
            name: "Bakery",
            is_active: true,
            lat: 6.4,
            lng: 3.2,
          },
        }),
      }),
      consumeLimit: async () => true,
      directionsKey: "private-key",
      fetch: async () => Response.json(data),
    });
    const response = await handlers.route(
      new Request("https://yrdly.test", {
        method: "POST",
        body: JSON.stringify({
          destination: { type: "business", id: ID },
          origin: { lat: 6.5, lng: 3.4 },
          mode: "driving",
        }),
      }),
    );
    assert.equal(response.status, status);
    assert.doesNotMatch(
      JSON.stringify(await response.json()),
      /private-key|6\.5,3\.4/,
    );
  }
});
test("listings without a ward use their public LGA centroid and online legacy events stay unroutable", async () => {
  const { resolveDirectionsDestination } = load(
    "src/lib/location/directions-destination.ts",
  );
  const result = await resolveDirectionsDestination(
    { type: "marketplace", id: ID },
    database({
      posts: {
        title: "Desk",
        category: "For Sale",
        state: "Lagos",
        lga: "Ikeja",
      },
      lga_wards: [
        { latitude: 6.4, longitude: 3.2 },
        { latitude: 6.6, longitude: 3.4 },
      ],
    }),
  );
  assert.equal(result.lat, 6.5);
  assert.ok(Math.abs(result.lng - 3.3) < 1e-10);
  assert.equal(result.approximate, true);
  await assert.rejects(
    resolveDirectionsDestination(
      { type: "legacy-event", id: ID },
      database({
        posts: {
          title: "Online event",
          category: "Event",
          event_location: "Online",
          lat: 6.4,
          lng: 3.2,
        },
      }),
    ),
    { status: 404 },
  );
});

test("address-only venues geocode inside their recorded Nigerian area and remain approximate", async () => {
  const { createDirectionsHandlers } = load(
    "src/lib/location/directions-service.ts",
  );
  const calls = [];
  const handlers = createDirectionsHandlers({
    authenticate: async () => ({
      userId: "viewer",
      client: database({
        businesses: {
          id: ID,
          name: "Bakery",
          is_active: true,
          location: "Market Square",
          state: "Lagos",
          lga: "Ikeja",
        },
      }),
    }),
    consumeLimit: async () => true,
    geocodeKey: "secret-geocode",
    fetch: async (url) => {
      calls.push(new URL(url));
      return Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Market Square, Ikeja, Lagos, Nigeria",
            geometry: {
              location: { lat: 6.4, lng: 3.2 },
              location_type: "APPROXIMATE",
            },
            address_components: [
              { long_name: "Nigeria", short_name: "NG", types: ["country"] },
              { long_name: "Lagos", types: ["administrative_area_level_1"] },
              { long_name: "Ikeja", types: ["administrative_area_level_2"] },
            ],
          },
        ],
      });
    },
  });
  const response = await handlers.destination(
    new Request(`https://yrdly.test?type=business&id=${ID}`),
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.approximate, true);
  assert.equal(value.lat, 6.4);
  assert.equal(calls[0].searchParams.get("components"), "country:NG");
  assert.doesNotMatch(JSON.stringify(value), /secret-geocode/);
});

test("geocoding never silently routes an address to a different area or country", async () => {
  const { createDirectionsHandlers } = load(
    "src/lib/location/directions-service.ts",
  );
  for (const [country, state, lga] of [
    ["US", "Lagos", "Ikeja"],
    ["NG", "Oyo", "Ibadan"],
    ["NG", "Lagos", "Epe"],
  ]) {
    const handlers = createDirectionsHandlers({
      authenticate: async () => ({
        userId: "viewer",
        client: database({
          businesses: {
            id: ID,
            name: "Bakery",
            is_active: true,
            location: "Market Square",
            state: "Lagos",
            lga: "Ikeja",
          },
        }),
      }),
      consumeLimit: async () => true,
      geocodeKey: "secret-geocode",
      fetch: async () =>
        Response.json({
          status: "OK",
          results: [
            {
              geometry: {
                location: { lat: 6.4, lng: 3.2 },
                location_type: "ROOFTOP",
              },
              address_components: [
                { short_name: country, types: ["country"] },
                { long_name: state, types: ["administrative_area_level_1"] },
                { long_name: lga, types: ["administrative_area_level_2"] },
              ],
            },
          ],
        }),
    });
    assert.equal(
      (
        await handlers.destination(
          new Request(`https://yrdly.test?type=business&id=${ID}`),
        )
      ).status,
      422,
    );
  }
});

test("owner-readable moderated listings and legacy events cannot acquire destination metadata or a route", async () => {
  const { createDirectionsHandlers } = load(
    "src/lib/location/directions-service.ts",
  );
  for (const type of ["marketplace", "legacy-event"]) {
    for (const moderation_status of ["pending", "hidden", "rejected"]) {
      const handlers = createDirectionsHandlers({
        authenticate: async () => ({
          userId: "owner",
          client: database({
            posts: {
              id: ID,
              title: "Moderated content",
              category: type === "marketplace" ? "For Sale" : "Event",
              moderation_status,
              state: "Lagos",
              lga: "Ikeja",
              ward: "A",
              lat: 6.4,
              lng: 3.2,
            },
            lga_wards: [{ latitude: 6.6, longitude: 3.3 }],
          }),
        }),
        consumeLimit: async () => true,
        directionsKey: "private-key",
        fetch: async () =>
          assert.fail("Moderated content must never reach the provider"),
      });
      const metadata = await handlers.destination(
        new Request(`https://yrdly.test?type=${type}&id=${ID}`),
      );
      assert.equal(metadata.status, 404);
      const routed = await handlers.route(
        new Request("https://yrdly.test", {
          method: "POST",
          body: JSON.stringify({
            destination: { type, id: ID },
            origin: { lat: 6.5, lng: 3.4 },
            mode: "driving",
          }),
        }),
      );
      assert.equal(routed.status, 404);
    }
  }
});
