import { test, expect } from "@playwright/test";
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
  await page.goto("/login");
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
    await expect(main.locator("h1").first()).toBeVisible({ timeout: 30000 });
  }
  await expect(
    main.locator(".animate-pulse:visible, .animate-spin:visible"),
  ).toHaveCount(0, { timeout: 30000 });
  await expect(main.getByText(/Loading categories/)).toHaveCount(0, {
    timeout: 30000,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

const widths = [320, 360, 375, 390, 430, 768, 1024, 1440] as const;

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
        for (const title of [
          "Community post",
          "Marketplace listing",
          "Event",
          "Safety alert",
        ]) {
          await expect(
            dialog.getByRole("button", { name: new RegExp(title) }),
          ).toBeVisible();
        }

        const dims = await dialog.evaluate((el) => {
          const b = el.getBoundingClientRect();
          const boxes = Array.from(el.querySelectorAll("button"))
            .filter((button) => button.hasAttribute("data-create-action"))
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
