const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "https://yrdly.test/events/team",
});
global.window = dom.window;
global.document = dom.window.document;
global.self = dom.window;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
let user = { id: "owner" },
  role = "organizer",
  forbidden = false;
const writes = [];
let assignments = [
  {
    id: "invitation",
    event_id: "event",
    role: "checkin",
    status: "pending",
    expires_at: "2099-10-25T10:00:00Z",
    event: {
      id: "event",
      title: "Garden social",
      start_time: "2099-10-25T12:00:00Z",
      status: "PUBLISHED",
    },
  },
];
const snapshot = () => ({
  event: { id: "event", title: "Garden social", status: "PUBLISHED" },
  role,
  members: [
    {
      id: "member",
      user_id: "staff",
      name: "Ada Staff",
      role: "checkin",
      status: "active",
    },
  ],
  summary: { total: 100, checked_in: 30, remaining: 70 },
  history: [
    {
      id: "scan",
      scanned_at: "2026-10-23T12:00:00Z",
      scanned_by: "staff",
      scanner_name: "Ada Staff",
    },
  ],
  guests:
    role === "checkin"
      ? []
      : [
          {
            id: "ticket",
            attendee_name: "Guest One",
            status: "USED",
            tier_name: "General",
          },
        ],
});
let hold = null;
async function request(path, body) {
  if (hold) return hold;
  if (forbidden) throw Object.assign(Error("Access revoked"), { status: 403 });
  if (body) {
    writes.push({ path, ...body });
    if (body.action === "accept")
      assignments = assignments.map((a) => ({ ...a, status: "active" }));
    return { success: true };
  }
  return path === "/api/events/team" ? { assignments } : snapshot();
}
const moduleObject = { exports: {} };
const code = ts.transpileModule(
  fs.readFileSync("src/components/events/EventTeamWorkspace.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
new Function("require", "module", "exports", code)(
  (name) => {
    if (name === "react") return React;
    if (name === "next/link")
      return {
        __esModule: true,
        default: ({ children, ...props }) =>
          React.createElement("a", props, children),
      };
    if (name === "@/hooks/use-supabase-auth")
      return { useAuth: () => ({ user }) };
    if (name === "@/lib/events/event-team")
      return {
        eventTeamEndpoint: (id) =>
          id ? `/api/events/${id}/team` : "/api/events/team",
        eventTeamRequest: request,
        eventTeamRoleLabel: (value) =>
          ({
            organizer: "Organiser",
            manager: "Event manager",
            checkin: "Check-in staff",
          })[value],
      };
    return require(name);
  },
  moduleObject,
  moduleObject.exports,
);
const Component = moduleObject.exports.EventTeamWorkspace;
async function mount(props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async () => {
    await act(async () => root.render(React.createElement(Component, props)));
  };
  await render();
  return {
    host,
    render,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function click(node) {
  assert.ok(node);
  await act(async () =>
    node.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
}
const button = (host, label) =>
  [...host.querySelectorAll("button")].find(
    (n) => n.textContent.trim() === label,
  );

test("assigned invitation accepts for its member/event and then opens the event desk", async () => {
  user = { id: "staff" };
  const app = await mount();
  try {
    if (process.env.YRDLY_TEAM_SNAPSHOT)
      fs.writeFileSync(
        "/private/tmp/yrdly-team-assignments.html",
        app.host.innerHTML,
      );
    assert.ok(button(app.host, "Accept invitation"));
    assert.equal(app.host.querySelector('a[href="/events/event/scan"]'), null);
    await click(button(app.host, "Accept invitation"));
    assert.deepEqual(writes.at(-1), {
      path: "/api/events/event/team",
      action: "accept",
      member_id: "invitation",
    });
    assert.ok(app.host.querySelector('a[href="/events/event/team"]'));
  } finally {
    await app.close();
  }
});
test("check-in staff see operational totals and scanner, without manager or financial controls", async () => {
  role = "checkin";
  user = { id: "staff" };
  const app = await mount({ eventId: "event" });
  try {
    assert.ok(app.host.querySelector('a[href="/events/event/scan"]'));
    assert.match(app.host.textContent, /100/);
    assert.match(app.host.textContent, /30/);
    assert.equal(app.host.querySelector("form"), null);
    assert.doesNotMatch(
      app.host.textContent,
      /Build your door team|Guest One|Make manager|Refund|Revenue/,
    );
  } finally {
    await app.close();
  }
});
test("managers cannot promote staff and revocation needs confirmation", async () => {
  role = "manager";
  user = { id: "manager" };
  const app = await mount({ eventId: "event" });
  const previous = window.confirm;
  try {
    if (process.env.YRDLY_TEAM_SNAPSHOT)
      fs.writeFileSync(
        "/private/tmp/yrdly-team-workspace.html",
        app.host.innerHTML,
      );
    assert.ok(app.host.querySelector("form"));
    assert.equal(button(app.host, "Make manager"), undefined);
    assert.match(app.host.textContent, /Guest One/);
    const revoke = [...app.host.querySelectorAll("button")].find((n) =>
      /Revoke/.test(n.textContent),
    );
    assert.ok(revoke);
    const before = writes.length;
    window.confirm = () => false;
    await click(revoke);
    assert.equal(writes.length, before);
    window.confirm = () => true;
    await click(revoke);
    assert.equal(writes.at(-1).action, "revoke");
    assert.equal(writes.at(-1).member_id, "member");
  } finally {
    window.confirm = previous;
    await app.close();
  }
});
test("revoked access clears operational data and a new account never sees old attendance", async () => {
  role = "organizer";
  user = { id: "owner" };
  const app = await mount({ eventId: "event" });
  try {
    assert.match(app.host.textContent, /Guest One/);
    forbidden = true;
    await click(button(app.host, "Refresh"));
    assert.doesNotMatch(app.host.textContent, /Guest One|Checked in/);
    assert.ok(app.host.querySelector('[role="alert"]'));
    forbidden = false;
    await click(button(app.host, "Try again"));
    assert.match(app.host.textContent, /Guest One/);
    hold = new Promise(() => {});
    user = { id: "different" };
    await app.render();
    assert.doesNotMatch(app.host.textContent, /Guest One|Checked in/);
    user = null;
    await app.render();
    assert.match(app.host.textContent, /Sign in/);
    assert.doesNotMatch(app.host.textContent, /Guest One/);
  } finally {
    hold = null;
    forbidden = false;
    await app.close();
  }
});
