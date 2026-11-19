import { test, expect, chromium, webkit } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

test.use({ screenshot: "only-on-failure" });

const QA_REF = "jxgpvvehajxegeeozlnl";
const OUTPUT = ".qa-artifacts/mobile-web-visual";

function isolatedCredentials() {
  const env = parse(readFileSync(".env.qa", "utf8"));
  const origin = new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  if (
    env.QA_ENVIRONMENT !== "staging" ||
    env.QA_EXPECTED_PROJECT_REF !== QA_REF ||
    origin.hostname !== `${QA_REF}.supabase.co` ||
    !env.QA_BUYER_EMAIL ||
    !env.QA_BUYER_PASSWORD
  ) {
    throw new Error(
      "Visual review must use the isolated YRDLY QA tenant and QA buyer",
    );
  }
  return env;
}

async function loginQaBuyer(page: import("@playwright/test").Page) {
  const env = isolatedCredentials();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email address").fill(env.QA_BUYER_EMAIL);
  await page
    .getByPlaceholder("Password", { exact: true })
    .fill(env.QA_BUYER_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
}

async function waitForLoadedContent(
  page: import("@playwright/test").Page,
  route: string,
) {
  const main = page.locator("main");
  // MainLayout can mount before the screen hydrates. Wait for the screen's
  // own content, then for its loading placeholders and category requests.
  if (route === "/home") {
    await expect(
      main.getByRole("button", { name: "Post", exact: true }),
    ).toBeVisible({ timeout: 30000 });
  } else {
    await expect(main.getByRole("heading").first()).toBeVisible({ timeout: 30000 });
  }
  await expect(
    main.locator(".yrdly-skeleton:visible, .animate-pulse:visible, .animate-spin:visible"),
  ).toHaveCount(0, { timeout: 30000 });
  await expect(main.getByText(/Loading categories/)).toHaveCount(0, {
    timeout: 30000,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

const widths = [320, 360, 375, 390, 430, 768, 1024, 1440] as const;

for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]] as const) {
  test(`Create actions respond to a single phone tap in ${engine}`, async () => {
    test.setTimeout(180000);
    const browser = await browserType.launch();
    const context = await browser.newContext({
      baseURL: engine === "webkit" ? "https://localhost:9443" : "http://localhost:9002",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    try {
      await loginQaBuyer(page);
      for (const [action, route] of [
        ["post", "/posts/create"], ["listing", "/marketplace/create"],
        ["event", "/events/create"], ["alert", "/alerts/new"],
      ] as const) {
        await page.goto("/home", { waitUntil: "domcontentloaded" });
        await waitForLoadedContent(page, "/home");
        await page.getByRole("button", { name: "Create a post, listing, event or safety alert" }).tap();
        await page.locator(`[data-create-action="${action}"]`).tap();
        await expect(page).toHaveURL(new RegExp(
          action === "listing" || action === "event" ? `(?:${route}|/verify-phone)$` : `${route}$`,
        ), { timeout: 15000 });
        await expect(page.getByRole("dialog", { name: "What would you like to create?" })).toHaveCount(0);
        await expect(page.locator("main h1")).toBeVisible();
        mkdirSync(OUTPUT, { recursive: true });
        await page.screenshot({ path: `${OUTPUT}/touch-${engine}-${action}.png` });
      }
    } catch (error) {
      mkdirSync(OUTPUT, { recursive: true });
      await page.screenshot({ path: `${OUTPUT}/touch-${engine}-failure.png` });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} appearance`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("yrdly-theme", value),
        theme,
      );
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    });

    test("authenticated Create menu is usable at every responsive breakpoint", async ({
      page,
    }) => {
      test.setTimeout(480000);
      mkdirSync(OUTPUT, { recursive: true });
      await loginQaBuyer(page);
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.goto("/home");
        await waitForLoadedContent(page, "/home");
        await expect(
          page.getByRole("link", { name: "Explore", exact: true }),
        ).toBeVisible({ timeout: 30000 });
        const button =
          width >= 1024
            ? page.getByRole("button", { name: "Create", exact: true })
            : page.getByRole("button", {
                name: "Create a post, listing, event or safety alert",
              });
        await expect(button).toBeVisible();
        await button.click();
        const dialog = page.getByRole("dialog", {
          name: "What would you like to create?",
        });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS("opacity", "1");
        await expect(dialog.locator("xpath=preceding-sibling::*[1]")).toHaveCSS("opacity", "1");
        for (const title of [
          "Community post",
          "Marketplace listing",
          "Event",
          "Safety alert",
        ]) {
          await expect(
            dialog.getByRole("link", { name: new RegExp(title) }),
          ).toBeVisible();
        }

        const dims = await dialog.evaluate((el) => {
          const b = el.getBoundingClientRect();
          const boxes = Array.from(el.querySelectorAll("[data-create-action]"))
            .map((button) => {
              const r = button.getBoundingClientRect();
              return { width: r.width, height: r.height };
            });
          return {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            boxes,
          };
        });
        expect(dims.left, `Dialog left at ${width}`).toBeGreaterThanOrEqual(-1);
        expect(dims.right, `Dialog right at ${width}`).toBeLessThanOrEqual(
          width + 1,
        );
        expect(dims.top, `Dialog top at ${width}`).toBeGreaterThanOrEqual(-1);
        expect(
          dims.boxes,
          "Four distinct Create actions must be touch-friendly",
        ).toHaveLength(4);
        for (const rect of dims.boxes) {
          expect(rect.width).toBeGreaterThanOrEqual(110);
          expect(rect.height).toBeGreaterThanOrEqual(150);
        }
        await page.screenshot({
          path: `${OUTPUT}/${theme}-${width}-create-menu.png`,
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(button).toBeFocused();
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          )
          .toBe(true);
        console.log(`PASS authenticated Create menu at ${width}px`);
      }
    });

    test("authenticated loaded page snapshots cover every breakpoint without horizontal overflow", async ({
      page,
    }) => {
      test.setTimeout(480000);
      mkdirSync(OUTPUT, { recursive: true });
      await loginQaBuyer(page);
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        for (const route of [
          "/home",
          "/explore",
          "/marketplace",
          "/businesses",
          "/events",
          "/messages",
          "/profile",
          "/settings",
        ]) {
          await page.goto(route);
          await expect(page.locator("main")).toHaveCount(1);
          await expect(page.locator("main")).toBeVisible({ timeout: 30000 });
          await expect(page).toHaveURL(new RegExp(`${route}$`));
          await waitForLoadedContent(page, route);
          await expect(page.locator("html")).toHaveClass(
            new RegExp(`\\b${theme}\\b`),
          );
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth <= window.innerWidth + 1,
              ),
            )
            .toBe(true);
          const filename = route.slice(1);
          await page.screenshot({
            path: `${OUTPUT}/${theme}-${width}-${filename}.png`,
            fullPage: true,
            mask: [page.locator("input[type=password]")],
          });
          console.log(`PASS authenticated ${route} at ${width}px`);
          if (width === 390 && route === "/settings") {
            const email = page.getByRole("button", { name: /^Email Address/ });
            await email.focus();
            await email.press("Enter");
            const dialog = page.getByRole("alertdialog", { name: "Change Email" });
            await expect(dialog).toBeVisible();
            await dialog.getByRole("button", { name: "OK", exact: true }).click();
            await expect(dialog).toBeHidden();
            const toggle = page.getByRole("switch", { name: "Dark Mode", exact: true });
            const size = await toggle.boundingBox();
            expect(size?.height).toBeGreaterThanOrEqual(44);
            expect(size?.width).toBeGreaterThanOrEqual(44);
            await toggle.focus();
            await toggle.press("Enter");
            await expect(toggle).toHaveAttribute("aria-checked", String(theme !== "dark"));
            await toggle.press("Enter");
            await expect(toggle).toHaveAttribute("aria-checked", String(theme === "dark"));
            await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
          }
          if (width === 390 && route === "/profile") {
            for (const name of ["Edit Profile", "Posts", "Texts", "Saved"]) {
              const control = page.locator("main").getByRole("button", { name, exact: true });
              const size = await control.boundingBox();
              expect(size?.height, `${name} touch height`).toBeGreaterThanOrEqual(44);
            }
          }

        }
      }
    });

    test("Create actions preserve creation routes and phone-verification gates", async ({
      page,
    }) => {
      test.setTimeout(480000);
      mkdirSync(OUTPUT, { recursive: true });
      await loginQaBuyer(page);
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        for (const [action, route] of [
          ["post", "/posts/create"],
          ["listing", "/marketplace/create"],
          ["event", "/events/create"],
        ] as const) {
          await page.goto("/home");
          const trigger =
            width >= 1024
              ? page.getByRole("button", { name: "Create", exact: true })
              : page.getByRole("button", {
                  name: "Create a post, listing, event or safety alert",
                });
          await trigger.click();
          await page.locator(`[data-create-action="${action}"]`).click();
          await expect(
            page.getByRole("dialog", {
              name: "What would you like to create?",
            }),
          ).toHaveCount(0);
          // The general QA seed does not promise a phone-verified buyer.
          // Capture the existing gate explicitly; never bypass it for screenshots.
          const destination =
            action === "post" ? `${route}$` : `(?:${route}|/verify-phone)$`;
          await expect(page).toHaveURL(new RegExp(destination));
          const gated = new URL(page.url()).pathname === "/verify-phone";
          if (gated)
            console.log(
              `Phone verification required for ${action}; form review remains pending`,
            );
          await expect(page.locator("main h1")).toBeVisible();
          await waitForLoadedContent(page, gated ? "/verify-phone" : route);
          if (!gated && width < 1024) {
            await expect(
              page.getByRole("navigation", {
                name: "Main navigation",
                exact: true,
              }),
            ).toBeHidden();
          }
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth <= window.innerWidth + 1,
              ),
            )
            .toBe(true);
          await page.screenshot({
            path: `${OUTPUT}/${theme}-${width}-create-${action}${gated ? "-phone-gate" : ""}.png`,
            fullPage: true,
          });
        }
      }
    });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} release forms and daily question UI reach review without publishing`, async ({ page }) => {
    test.setTimeout(480000);
    mkdirSync(OUTPUT, { recursive: true });
    await page.addInitScript(value => localStorage.setItem("yrdly-theme", value), theme);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await loginQaBuyer(page);
    let publications = 0;
    page.on("request", request => {
      if (request.method() === "POST" && /\/api\/posts$|\/api\/events\/create$|\/storage\/v1\/object\//.test(request.url())) publications++;
    });
    // Presentation-only fixtures. Authentication still uses the isolated QA tenant.
    await page.route("**/api/seller/setup-account", route => route.fulfill({ json: { account: { isVerified: true } } }));
    await page.route("**/rest/v1/categories?**", route => route.fulfill({ json: [{ id: "qa-release-category", name: "Community", type: "event", is_active: true }] }));
    const capture = async (width: number, surface: string) => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.evaluate(async () => { await document.fonts.ready; });
      await page.screenshot({ path: `${OUTPUT}/${theme}-${width}-${surface}.png`, fullPage: true });
    };
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto("/marketplace/create");
      await page.locator('input[type="file"]').setInputFiles({ name: "qa-release.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64") });
      await page.getByRole("button", { name: "Continue to Details", exact: true }).click();
      await page.getByLabel("Title *", { exact: true }).fill("YRDLY-QA release review item");
      const price = page.getByLabel("Price (₦) *", { exact: true });
      await price.fill("1199");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const errorToast = page.getByText("Valid Price Required", { exact: true }).first().locator("xpath=ancestor::li[1]");
      await expect(errorToast).toBeVisible();
      await expect.poll(async () => {
        const box = await errorToast.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width + 1;
      }).toBe(true);
      await capture(width, "listing-validation");
      const dismiss = errorToast.getByRole("button", { name: "Dismiss notification" });
      expect((await dismiss.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await dismiss.click();
      await expect(errorToast).toBeHidden();
      await price.fill("2500");
      await capture(width, "listing-details");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByLabel("Description", { exact: true }).fill("QA preview only. This item will not be published.");
      await capture(width, "listing-description");
      await page.getByRole("button", { name: "Review Listing", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Review & Publish", exact: true })).toBeVisible();
      if (width < 768) {
        const summary = page.getByRole("region", { name: "Listing summary" });
        await expect(summary).toContainText("YRDLY-QA release review item");
        await expect(summary).toContainText("₦2,500");
      }
      await capture(width, "listing-review");

      await page.goto("/events/create");
      await page.getByLabel("Title *", { exact: true }).fill("YRDLY-QA release review event");
      await page.getByRole("button", { name: "Community", exact: true }).click();
      await page.getByRole("button", { name: "Continue to Date & Time", exact: true }).click();
      await page.locator('input[type="date"]').fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
      await capture(width, "event-date");
      await page.getByRole("button", { name: "Continue to Location", exact: true }).click();
      await page.getByRole("button", { name: /Online/ }).click();
      await page.getByPlaceholder("https://zoom.us/j/... or Youtube Live link").fill("https://example.test/qa-release");
      await capture(width, "event-location");
      await page.getByRole("button", { name: "Continue to Tickets", exact: true }).click();
      await capture(width, "event-tickets");
      await page.getByRole("button", { name: "Continue to Media", exact: true }).click();
      await capture(width, "event-media");
      await page.getByRole("button", { name: "Review Event", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Review & Publish", exact: true })).toBeVisible();
      if (width < 768) {
        const summary = page.getByRole("region", { name: "Event summary" });
        await expect(summary).toContainText("YRDLY-QA release review event");
        await expect(summary).toContainText("https://example.test/qa-release");
        await expect(summary).toContainText("Free");
      }
      await capture(width, "event-review");

      const prompt = { id: "11111111-1111-4111-8111-111111111111", question: "Which local business would you recommend to a new neighbour?", category: "General", prompt_date: new Date().toISOString().slice(0, 10) };
      await page.route("**/api/daily-prompts", route => route.fulfill({ json: { date: prompt.prompt_date, prompt } }));
      await page.route("**/api/daily-prompts/responses?**", route => route.fulfill({ json: { responses: [], nextPage: null } }));
      // Exercise the exact URL-only push preflight that previously fell back to Notifications.
      await page.goto("/daily-prompts?notificationTarget=%2Fdaily-prompts");
      await expect(page).toHaveURL(/\/daily-prompts$/);
      await expect(page.getByRole("heading", { name: prompt.question, exact: true })).toBeVisible();
      await expect(page.locator("main")).toHaveCount(1);
      await capture(width, "daily-question");
      const answer = page.getByRole("link", { name: "Share your answer", exact: true });
      expect((await answer.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await answer.click();
      await expect(page).toHaveURL(/\/posts\/create\?dailyPrompt=/);
      await expect(page.getByText(prompt.question, { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Post content", exact: true })).toBeVisible();
      await capture(width, "daily-answer-composer");
    }
    expect(publications, "Reviewing forms must not upload media or publish content").toBe(0);
  });
}


for (const theme of ["light", "dark"] as const) {
  test(`${theme} populated conversations support long messages and enlarged text`, async ({ page }) => {
    test.setTimeout(240000);
    mkdirSync(OUTPUT, { recursive: true });
    await page.addInitScript(value => localStorage.setItem("yrdly-theme", value), theme);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await loginQaBuyer(page);
    const seed = JSON.parse(readFileSync("qa-seed-output.json", "utf8"));
    const buyer = seed.users.buyer;
    const neighbour = "22222222-2222-4222-8222-222222222222";
    const conversationId = "33333333-3333-4333-8333-333333333333";
    const timestamp = new Date().toISOString();
    const longMessage = "YRDLY-QA long message " + "neighbourhood".repeat(16) + "\nSecond line stays readable.";
    const conversation = { id: conversationId, participant_ids: [buyer, neighbour], type: "friend", last_message_text: longMessage, last_message_timestamp: timestamp, last_message_sender_id: neighbour, created_at: timestamp, updated_at: timestamp };
    const messages = [
      { id: "44444444-4444-4444-8444-444444444444", conversation_id: conversationId, sender_id: neighbour, text: longMessage, image_url: null, created_at: timestamp, is_read: true, read_by: [buyer], delivered_by: [buyer] },
      { id: "55555555-5555-4555-8555-555555555555", conversation_id: conversationId, sender_id: buyer, text: "YRDLY-QA reply: yes, we can meet near the community centre.", image_url: null, created_at: timestamp, is_read: true, read_by: [neighbour], delivered_by: [neighbour] },
    ];
    // Explicit presentation fixtures: real QA sign-in, no new conversations,
    // message sends, read-receipt writes or notification side effects.
    await page.route(`https://${QA_REF}.supabase.co/rest/v1/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const table = url.pathname.split("/").pop();
      if (table === "acknowledge_messages") return route.fulfill({ json: [] });
      if (request.method() !== "GET") {
        if (["conversations", "messages", "chat_messages"].includes(table || "")) return route.fulfill({ json: [] });
        // Session-policy RPCs must reach isolated QA; mocking them signs the user out.
        return route.continue();
      }
      if (table === "conversations") return route.fulfill({ json: request.headers().accept?.includes("vnd.pgrst.object") ? conversation : [conversation] });
      if (table === "messages") return route.fulfill({ json: messages });
      if (table === "chat_messages") return route.fulfill({ json: [] });
      if (table === "public_profiles" && url.search.includes(neighbour)) return route.fulfill({ json: [
        { id: buyer, name: "YRDLY-QA Buyer", username: "yrdly_qa_buyer", created_at: timestamp },
        { id: neighbour, name: "YRDLY-QA Neighbour With A Long Display Name", username: "yrdly_qa_neighbour_long_username", created_at: timestamp, is_online: false, phone_verified: false },
      ] });
      return route.continue();
    });
    const noOverflow = async () => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const bubbles = page.locator("[data-message-id]");
      for (const bubble of await bubbles.all()) {
        const dims = await bubble.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        expect(dims.scroll).toBeLessThanOrEqual(dims.client + 1);
      }
    };
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto("/messages");
      const open = page.getByRole("button", { name: "Open conversation with YRDLY-QA Neighbour With A Long Display Name", exact: true });
      await expect(open).toBeVisible();
      if (width !== 1440) await page.screenshot({ path: `${OUTPUT}/${theme}-${width}-populated-messages.png`, fullPage: true });
      await open.focus();
      await open.press("Enter");
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(input).toBeVisible();
      await expect(input).toBeInViewport();
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("region", { name: "Conversation messages", exact: true }).getByText(longMessage, { exact: true })).toBeVisible();
      for (const name of ["Back to messages", "Conversation options", "Attach photo", "Attach video", "Send a GIF", "Send message"]) {
        const control = page.getByRole("button", { name, exact: true });
        if (name === "Back to messages" && width >= 768) continue;
        await expect(control).toBeVisible();
        const size = await control.boundingBox();
        expect(size?.height, name).toBeGreaterThanOrEqual(44);
        expect(size?.width, name).toBeGreaterThanOrEqual(44);
      }
      const reply = page.getByRole("region", { name: "Conversation messages", exact: true }).getByText("YRDLY-QA reply: yes, we can meet near the community centre.", { exact: true });
      const replyContrast = await reply.evaluate(el => {
        const channel = (value: number) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const luminance = (color: string) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(channel)
          .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
        const style = getComputedStyle(el), fg = luminance(style.color), bg = luminance(style.backgroundColor);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
      expect(replyContrast, "Outgoing message contrast").toBeGreaterThanOrEqual(4.5);
      await input.fill("QA draft only — never sent");
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
      await noOverflow();
      await page.screenshot({ path: `${OUTPUT}/${theme}-${width}-conversation.png`, fullPage: true });
      // Keep the font preference on the root itself: Next head reconciliation
      // can remove injected style tags and silently undo text scaling.
      await page.evaluate(() => document.documentElement.style.setProperty("font-size", "32px", "important"));
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
      await expect(page.getByRole("region", { name: "Conversation messages", exact: true }).getByText(longMessage, { exact: true }))
        .toHaveCSS("font-size", "32px");
      await noOverflow();
      const inputSize = await input.boundingBox();
      expect(inputSize?.width, "Enlarged-text composer remains usable").toBeGreaterThanOrEqual(100);
      await page.screenshot({ path: `${OUTPUT}/${theme}-${width}-conversation-large-text.png`, fullPage: true });
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} daily answers quote their original question in feed and detail`, async ({ page }) => {
    test.setTimeout(240000);
    mkdirSync(OUTPUT, { recursive: true });
    await page.addInitScript(value => localStorage.setItem("yrdly-theme", value), theme);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await loginQaBuyer(page);
    const seed = JSON.parse(readFileSync("qa-seed-output.json", "utf8"));
    const promptId = "66666666-6666-4666-8666-666666666666";
    const postId = "77777777-7777-4777-8777-777777777777";
    const prompt = { id: promptId, question: "What’s your favourite restaurant in your area?", prompt_date: "2026-11-16", category: "food" };
    const post = { id: postId, user_id: seed.users.buyer, author_name: "YRDLY-QA Buyer", text: "Chicken Republic", category: "General", daily_prompt_id: promptId, liked_by: [], comment_count: 0, timestamp: new Date().toISOString(), created_at: new Date().toISOString(), visibility: "public", moderation_status: "approved", user: { id: seed.users.buyer, name: "YRDLY-QA Buyer" } };
    await page.route(`https://${QA_REF}.supabase.co/rest/v1/posts?**`, route => {
      if (route.request().method() !== "GET") return route.fulfill({ json: [] });
      return route.fulfill({ json: route.request().headers().accept?.includes("vnd.pgrst.object") ? post : [post] });
    });
    await page.route("**/api/daily-prompts?promptId=**", route => {
      expect(new URL(route.request().url()).searchParams.get("promptId")).toBe(promptId);
      return route.fulfill({ json: { date: "2026-11-17", prompt } });
    });
    await page.route("**/api/daily-prompts/responses?**", route => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get("promptId")).toBe(promptId);
      expect(query.get("answerId")).toBe(postId);
      return route.fulfill({ json: { linkedAnswer: post, responses: [
        { id: "88888888-8888-4888-8888-888888888888", user_id: seed.users.seller, author_name: "YRDLY-QA Neighbour", text: "The small restaurant beside the community centre", comment_count: 2 },
      ], nextPage: null } });
    });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      for (const [route, label] of [["/home", "feed"], [`/posts/${postId}`, "detail"]]) {
        await page.goto(route);
        const quote = page.getByRole("complementary", { name: "Daily question context", exact: true });
        await expect(quote).toContainText(prompt.question);
        await expect(page.locator('img[src*="placehold.co/100x100"]')).toHaveCount(0);
        const contrast = await quote.evaluate(el => {
          const rgba = (color: string) => {
            const values = color.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
            return [...values.slice(0, 3), values[3] ?? 1];
          };
          const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => {
            const v = value / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
          return Array.from(el.querySelectorAll("p, blockquote, a")).map(node => {
            let background = [255, 255, 255];
            const ancestors: Element[] = [];
            for (let parent: Element | null = node; parent; parent = parent.parentElement) ancestors.unshift(parent);
            for (const ancestor of ancestors) {
              const color = rgba(getComputedStyle(ancestor).backgroundColor);
              background = background.map((value, index) => color[index] * color[3] + value * (1 - color[3]));
            }
            const fg = luminance(rgba(getComputedStyle(node).color));
            const bg = luminance(background);
            return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          });
        });
        for (const ratio of contrast) expect(ratio, "Daily-question text contrast").toBeGreaterThanOrEqual(4.5);
        await expect(page.getByText("Chicken Republic", { exact: true }).first()).toBeVisible();
        const link = quote.getByRole("link", { name: "View question and neighbours’ answers", exact: true });
        await expect(link).toHaveAttribute("href", `/daily-prompts?promptId=${promptId}&answerId=${postId}`);
        expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `${OUTPUT}/${theme}-${width}-daily-answer-${label}.png`, fullPage: true });
        if (label === "detail") {
          await link.click();
          await expect(page).toHaveURL(`/daily-prompts?promptId=${promptId}&answerId=${postId}`);
          await expect(page.getByRole("heading", { name: prompt.question, exact: true })).toBeVisible();
          await expect(page.getByText("Past neighbourhood question", { exact: true })).toBeVisible();
          await expect(page.getByRole("region", { name: "Answer you opened" }).getByText("Chicken Republic", { exact: true })).toBeVisible();
          await expect(page.getByText("The small restaurant beside the community centre", { exact: true })).toBeVisible();
          await expect(page.getByRole("link", { name: "Share your answer", exact: true })).toHaveCount(0);
          await page.screenshot({ path: `${OUTPUT}/${theme}-${width}-daily-neighbour-answers.png`, fullPage: true });
        }
      }
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} marketplace search, budget, sorting and recovery work on phones`, async ({ page }) => {
    test.setTimeout(240000);
    mkdirSync(OUTPUT, { recursive: true });
    await page.addInitScript(value => localStorage.setItem("yrdly-theme", value), theme);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await loginQaBuyer(page);
    // Read-only catalog fixtures: real QA authentication, no listings published.
    const base = {
      user_id: "11111111-1111-4111-8111-111111111111", category: "For Sale",
      text: "", is_sold: false, image_urls: [], state: "Lagos", lga: "Ikeja",
      user: { id: "11111111-1111-4111-8111-111111111111", name: "QA seller with a long display name", phone_verified: true },
    };
    const fixtures = [
      { ...base, id: "qa-groceries", title: "QA fresh grocery basket", price: 4500, condition: "New", image_urls: ["/images/cards/card-center.jpg"], created_at: "2026-11-06" },
      { ...base, id: "qa-shirt", title: "QA cotton shirt", description: "Blue, size medium", price: 9500, condition: "Used", created_at: "2026-11-05" },
      { ...base, id: "qa-case", title: "QA phone case", price: 10000, condition: "New", created_at: "2026-11-04" },
      { ...base, id: "qa-phone", title: "QA Android phone", price: 25000, condition: "Used", created_at: "2026-11-03" },
      { ...base, id: "qa-free", title: "QA kitchen shelf", price: 0, condition: "Used", created_at: "2026-11-02" },
      { ...base, id: "qa-unknown", title: "QA dining table", price: null, created_at: "2026-11-01", user: { ...base.user, phone_verified: false } },
    ];
    let failCatalog = false;
    await page.route("**/rest/v1/posts?**", async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" || url.searchParams.get("category") !== "eq.For Sale") return route.continue();
      return failCatalog
        ? route.fulfill({ status: 503, json: { message: "QA simulated network failure" } })
        : route.fulfill({ json: fixtures });
    });
    await page.goto("/marketplace");
    const listings = page.getByRole("region", { name: "Marketplace listings", exact: true });
    const cards = listings.getByRole("link", { name: /^View / });
    const budgets = page.getByRole("group", { name: "Listing budget", exact: true });
    const categories = page.getByRole("group", { name: "Listing categories", exact: true });
    const search = page.getByRole("searchbox", { name: "Search marketplace", exact: true });
    await expect(cards).toHaveCount(6);
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.evaluate(async () => { await document.fonts.ready; });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const control of [budgets.getByRole("button", { name: "All prices", exact: true }), page.getByRole("button", { name: "Save item", exact: true }).first(), page.getByRole("combobox", { name: "Sort listings" })]) {
        const bounds = await control.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      await expect(cards.first().getByRole("img")).toBeVisible();
      await expect.poll(() => cards.first().getByRole("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await page.screenshot({ path: `${OUTPUT}/${theme}-${width}-marketplace-fixtures.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await budgets.getByRole("button", { name: "Under ₦10,000", exact: true }).click();
    await expect(cards).toHaveCount(3);
    await expect(cards.filter({ hasText: "QA phone case" })).toHaveCount(0);
    await categories.getByRole("button", { name: "Fashion", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await search.fill(" BLUE shirt ");
    await expect(cards.first()).toContainText("QA cotton shirt");
    await search.fill("unmatched");
    await expect(page.getByRole("heading", { name: "No matching listings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(cards).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await budgets.getByRole("button", { name: "Free", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("QA kitchen shelf");
    await budgets.getByRole("button", { name: "All prices", exact: true }).click();
    await page.getByRole("combobox", { name: "Sort listings" }).selectOption("price-high");
    await expect(cards.first()).toContainText("QA Android phone");
    await expect(cards.last()).toContainText("Price unavailable");
    await page.getByRole("combobox", { name: "Sort listings" }).selectOption("price-low");
    await expect(cards.first()).toContainText("QA kitchen shelf");
    await expect(cards.last().getByText("Phone verified", { exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Sort listings" }).selectOption("newest");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${OUTPUT}/${theme}-320-marketplace-text-200.png`, fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    failCatalog = true;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Couldn’t load listings", exact: true })).toBeVisible({ timeout: 30000 });
    failCatalog = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(cards).toHaveCount(6);
    // Real link semantics remain available for detail pages and modifier clicks.
    await expect(cards.first()).toHaveAttribute("href", "/marketplace/qa-groceries");
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} navigation avatar displays photos and a readable broken-photo fallback`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(value => localStorage.setItem("yrdly-theme", value), theme);
    const env = isolatedCredentials();
    const isolatedUrl = new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
    const seed = JSON.parse(readFileSync("qa-seed-output.json", "utf8"));
    expect(isolatedUrl.origin).toBe(`https://${QA_REF}.supabase.co`);
    expect(seed.projectRef).toBe(QA_REF);
    const client = createClient(isolatedUrl.origin, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const buyer = seed.users.buyer;
    const username = "yrdly_qa_buyer";
    const original = await client.from("users").select("name,avatar_url")
      .eq("id", buyer).eq("username", username).single();
    const profile = original.data;
    if (original.error || typeof profile?.name !== "string") {
      throw new Error(`Disposable QA buyer profile could not be read (${original.error?.code ?? "missing profile"})`);
    }
    const name = profile.name.trim();
    const setPhoto = async (avatarUrl: string | null) => {
      const { error } = await client.from("users").update({ avatar_url: avatarUrl })
        .eq("id", buyer).eq("username", username).select("id").single();
      expect(error?.code).toBeUndefined();
    };
    const profileButton = page.getByRole("button", { name: "Open profile", exact: true });
    mkdirSync(OUTPUT, { recursive: true });
    // A disposable QA profile exercises the same persisted image loading path
    // as production. Restore its original avatar even when an assertion fails.
    try {
      await setPhoto(`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#513d8f"/><circle cx="16" cy="13" r="6" fill="#fff"/><ellipse cx="16" cy="29" rx="11" ry="9" fill="#fff"/></svg>')}`);
      await loginQaBuyer(page);
      const avatar = profileButton.getByRole("img", { name: `${name}'s avatar`, exact: true });
      await expect(avatar).toBeVisible({ timeout: 30000 });
      await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await page.screenshot({ path: `${OUTPUT}/${theme}-390-avatar-photo.png` });
      for (const [state, url] of [["broken", "data:image/png;base64,AAAA"], ["missing", null]] as const) {
        await setPhoto(url);
        await page.reload();
        const fallback = profileButton.getByText(Array.from(name)[0].toUpperCase(), { exact: true });
        await expect(fallback).toBeVisible({ timeout: 30000 });
        const presentation = await fallback.evaluate(element => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return { background: style.backgroundColor, color: style.color, width: bounds.width, height: bounds.height };
        });
        expect(presentation.background).not.toBe("rgba(0, 0, 0, 0)");
        expect(presentation.background).not.toBe(presentation.color);
        expect(presentation.width).toBeGreaterThanOrEqual(32);
        expect(presentation.height).toBeGreaterThanOrEqual(32);
        await expect(avatar).toHaveCount(0);
        await page.screenshot({ path: `${OUTPUT}/${theme}-390-avatar-${state}.png` });
      }
    } finally {
      await setPhoto(profile.avatar_url);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} daily question opens its own neighbours answers with recovery`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(value => localStorage.setItem("yrdly-theme", value), theme);
    await loginQaBuyer(page);
    const id = "11111111-1111-4111-8111-111111111111";
    const prompt = { id, question: "QA: Which local restaurant do you recommend?", prompt_date: "2026-11-17", category: "General" };
    await page.route("**/api/daily-prompts?**", route => route.fulfill({ json: { date: "2026-11-18", prompt } }));
    await page.route("**/api/daily-prompts", route => route.fulfill({ json: { date: "2026-11-18", prompt } }));
    let mode = "populated";
    await page.route("**/api/daily-prompts/responses?**", route => {
      expect(new URL(route.request().url()).searchParams.get("promptId")).toBe(id);
      if (mode === "error") return route.fulfill({ status: 503, json: { error: "Could not load answers" } });
      if (mode === "location") return route.fulfill({ json: { responses: [], nextPage: null, locationRequired: true } });
      const pageNumber = new URL(route.request().url()).searchParams.get("page");
      return route.fulfill({ json: { responses: [{ id: pageNumber === "0" ? "qa-answer-1" : "qa-answer-2", author_name: pageNumber === "0" ? "QA neighbour A" : "QA neighbour B", text: pageNumber === "0" ? "Chicken Republic" : "The local cafe", comment_count: 2 }], nextPage: pageNumber === "0" ? 1 : null } });
    });
    await page.goto("/home");
    const answersLink = page.getByRole("link", { name: /See neighbours.*answers/ });
    await expect(answersLink).toHaveAttribute("href", `/daily-prompts?promptId=${id}`);
    await answersLink.click();
    await expect(page.getByRole("heading", { name: prompt.question, exact: true })).toBeVisible();
    await expect(page.getByText("Chicken Republic", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Load more answers", exact: true }).click();
    await expect(page.getByText("The local cafe", { exact: true })).toBeVisible();
    mkdirSync(OUTPUT, { recursive: true });
    await page.screenshot({ path: `${OUTPUT}/${theme}-390-neighbour-answers.png`, fullPage: true });
    mode = "error";
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Could not load answers" })).toBeVisible();
    await expect(page.getByText("No responses nearby yet. You can be the first!", { exact: true })).toHaveCount(0);
    mode = "populated";
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText("Chicken Republic", { exact: true })).toBeVisible();
    mode = "location";
    await page.reload();
    await expect(page.getByRole("heading", { name: "Choose your neighbourhood to see local answers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Set your home neighbourhood" })).toHaveAttribute("href", "/onboarding/profile");
  });
}
