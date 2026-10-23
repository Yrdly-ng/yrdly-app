const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://yrdly.test/communities/garden",
});
global.window = dom.window;
global.self = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = (fn) => {
  fn();
  return 0;
};
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const account = {
  user: { id: "viewer" },
  profile: { name: "Viewer", phone_verified: true },
};
const community = {
  id: "garden",
  name: "Garden Club",
  member_count: 25,
  type: "interest",
  privacy: "open",
  avatar_url: "https://fixture/avatar.jpg",
  banner_url: "https://fixture/banner.jpg",
  description: "Grow something together.",
};
let memberActive = true;
let replies = 0;
const service = {
  isStaffProfile: () => false,
  listMyCommunities: async () => [community],
  discoverCommunities: async () => [community],
  listInvitations: async () => [],
  listMyCommunitySubmissions: async () => [],
  pendingSubmissionNames: async () => [],
  members: async () => [
    {
      id: "membership",
      user_id: "friend",
      role: "member",
      status: "active",
      user: { name: "Ada Green", avatar_url: "https://fixture/ada.jpg" },
    },
  ],
  getCommunity: async () => community,
  getMyMembership: async () => ({
    role: "member",
    status: memberActive ? "active" : "left",
  }),
  getMyJoinRequest: async () => null,
  ownershipOffer: async () => null,
  getMyInvite: async () => null,
  fetchPosts: async (_, page = 0) =>
    Array.from({ length: page ? 5 : 20 }, (_, i) => ({
      id: `post-${page * 20 + i}`,
      author_id: "friend",
      author: { name: "Ada Green" },
      content: `Garden post ${page * 20 + i}`,
      moderation_status: "approved",
      created_at: "2026-10-20T12:00:00Z",
      like_count: 0,
      comment_count: replies,
    })),
};
const query = {
  select() {
    return this;
  },
  eq() {
    return this;
  },
  in: async () => ({ data: [], error: null }),
};
const supabase = {
  from: () => query,
  channel: () => ({
    on() {
      return this;
    },
    subscribe() {
      return this;
    },
  }),
  removeChannel: async () => {},
};
const element =
  (tag) =>
  ({ children, ...props }) =>
    React.createElement(tag, props, children);
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const overrides = {
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "next/link": {
      __esModule: true,
      default: ({ children, onClick, ...props }) =>
        React.createElement(
          "a",
          {
            ...props,
            onClick(event) {
              event.preventDefault();
              onClick?.(event);
            },
          },
          children,
        ),
    },
    "@/hooks/use-supabase-auth": { useAuth: () => account },
    "@/lib/communities/community-service": { CommunityService: service },
    "@/lib/supabase/supabase": { supabase },
    "@/components/ui/dialog": {
      Dialog: ({ children }) => children,
      DialogContent: element("section"),
      DialogTitle: element("h2"),
    },
    "@/components/ui/avatar": {
      Avatar: element("span"),
      AvatarImage: element("img"),
      AvatarFallback: element("span"),
    },
    "@/components/VerifiedBadge": { VerifiedBadge: () => null },
    "./CommunityMedia": { CommunityMedia: () => null },
  };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("module", "exports", "require", output)(
    module,
    module.exports,
    (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("."))
        return load(path.resolve(path.dirname(file), name + ".tsx"));
      return require(name);
    },
  );
  return module.exports;
}
const { CommunityDirectory } = load(
  "src/components/communities/CommunityDirectory.tsx",
);
const { CommunityManager } = load(
  "src/components/communities/CommunityManagement.tsx",
);
const { CommunityWorkspace } = load(
  "src/components/communities/CommunityWorkspace.tsx",
);
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
async function mount(Component, props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Component, props)));
  await settle();
  return {
    host,
    root,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function click(button) {
  await act(async () =>
    button.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
  await settle();
}

test("directory renders real cover/avatar, joined status and responsive community links", async () => {
  const view = await mount(CommunityDirectory);
  try {
    const card = view.host.querySelector('a[href="/communities/garden"]');
    assert.ok(card);
    assert.match(card.textContent, /Shared interest/);
    assert.match(card.textContent, /25 members/);
    assert.match(card.textContent, /Joined/);
    assert.ok(card.querySelector('img[src="https://fixture/banner.jpg"]'));
    assert.ok(card.querySelector('img[src="https://fixture/avatar.jpg"]'));
    if (process.env.YRDLY_COMMUNITY_SNAPSHOT)
      fs.writeFileSync(
        process.env.YRDLY_COMMUNITY_SNAPSHOT,
        view.host.innerHTML,
      );
    assert.equal(
      view.host.querySelector('input[aria-label="Search communities"]')
        .placeholder,
      "Search your communities",
    );
    assert.equal(
      view.host.querySelector('nav button[aria-pressed="true"]').textContent,
      "My communities",
    );
  } finally {
    await view.close();
  }
});

test("members display supplied profile photos and do not expose leader actions to regular members", async () => {
  const view = await mount(CommunityManager, {
    community,
    role: "member",
    onClose() {},
    onChanged() {},
  });
  try {
    await settle(280);
    assert.ok(view.host.querySelector('img[src="https://fixture/ada.jpg"]'));
    assert.ok(view.host.querySelector('a[href="/profile/friend"]'));
    assert.doesNotMatch(
      view.host.textContent,
      /Make admin|Offer ownership|Join requests/,
    );
  } finally {
    await view.close();
  }
});

test("reply return retains loaded feed pages and scroll, updates reply counts, and clears cached content after membership loss", async () => {
  memberActive = true;
  replies = 0;
  let view = await mount(CommunityWorkspace, { id: "garden" });
  try {
    await click(
      [...view.host.querySelectorAll("button")].find(
        (button) => button.textContent === "Load more posts",
      ),
    );
    assert.equal(view.host.querySelectorAll("article").length, 25);
    document.scrollingElement = document.documentElement;
    document.documentElement.scrollTop = 730;
    await click(
      view.host.querySelector('a[href="/communities/garden/posts/post-0"]'),
    );
    await view.close();
    replies = 2;
    view = await mount(CommunityWorkspace, { id: "garden" });
    assert.equal(view.host.querySelectorAll("article").length, 25);
    assert.match(
      view.host.querySelector('a[href="/communities/garden/posts/post-0"]')
        .textContent,
      /2 replies/,
    );
    assert.equal(document.documentElement.scrollTop, 730);
    await view.close();
    memberActive = false;
    view = await mount(CommunityWorkspace, { id: "garden" });
    assert.equal(view.host.querySelectorAll("article").length, 0);
    assert.doesNotMatch(view.host.textContent, /Garden post/);
  } finally {
    await view.close();
    memberActive = true;
  }
});

test("account changes hide old feed before fresh access resolves and logout clears content", async () => {
  memberActive = true;
  account.user = { id: "viewer" };
  const view = await mount(CommunityWorkspace, { id: "garden" });
  const originalMembership = service.getMyMembership;
  let resolveMembership;
  try {
    assert.equal(view.host.querySelectorAll("article").length, 20);
    service.getMyMembership = () =>
      new Promise((resolve) => {
        resolveMembership = resolve;
      });
    account.user = { id: "another-viewer" };
    await act(async () =>
      view.root.render(
        React.createElement(CommunityWorkspace, { id: "garden" }),
      ),
    );
    assert.equal(view.host.querySelectorAll("article").length, 0);
    await act(async () =>
      resolveMembership({ status: "active", role: "member" }),
    );
    await settle();
    assert.equal(view.host.querySelectorAll("article").length, 20);
    account.user = null;
    await act(async () =>
      view.root.render(
        React.createElement(CommunityWorkspace, { id: "garden" }),
      ),
    );
    assert.equal(view.host.querySelectorAll("article").length, 0);
    assert.doesNotMatch(view.host.textContent, /Garden post/);
  } finally {
    service.getMyMembership = originalMembership;
    account.user = { id: "viewer" };
    await view.close();
  }
});
