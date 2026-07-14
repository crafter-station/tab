import { expect, test, type Locator } from "@playwright/test";

async function waitForHydration(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => (
    Object.keys(element).some((key) => key.startsWith("__reactProps"))
  ))).toBe(true);
}

test("shared menus dismiss on outside click and Escape", async ({ page }) => {
  await page.goto("/");

  const brandTrigger = page.getByRole("link", { name: "Tab home. Right-click for menu" });
  await expect(brandTrigger).toHaveAttribute("href", "/");
  await waitForHydration(brandTrigger);
  await brandTrigger.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Brand page" })).toBeVisible();

  await page.mouse.click(700, 400);
  await expect(page.getByRole("menuitem", { name: "Brand page" })).toBeHidden();

  await brandTrigger.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Brand page" })).toBeHidden();

  const moreTrigger = page.getByRole("button", { name: "More" });
  await moreTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Privacy" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(moreTrigger).toBeFocused();
});

test("mobile navigation uses the shared Sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Open navigation" });
  await waitForHydration(trigger);
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("marketing controls use hydrated Tabs and Toggle state", async ({ page }) => {
  await page.goto("/");

  const slackTab = page.getByRole("tab", { name: "Slack" });
  await waitForHydration(slackTab);
  await slackTab.click();
  await expect(slackTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").filter({ hasText: "# product" })).toBeVisible();

  const pause = page.locator('button[aria-controls="workflow-animation"]');
  await waitForHydration(pause);
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect(pause).toHaveAttribute("aria-label", "Resume animation");
});

test("stored theme selection persists across navigation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tab-theme", "dark"));
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tab-theme"))).toBe("dark");

  await page.goto("/pricing");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("Option+Tab advances through consecutive Suggestions", async ({ page }) => {
  await page.goto("/");

  const demo = page.getByRole("region", { name: "Interactive Tab autocomplete example" });
  await waitForHydration(demo);
  await demo.focus();
  await page.keyboard.press("Alt+Tab");

  await expect(demo).toHaveAttribute("data-step", "1");
  await expect(demo.getByRole("button", { name: "Accept suggestion 2 with Option plus Tab" })).toBeVisible();
  await page.keyboard.press("Alt+Tab");
  await expect(demo).toHaveAttribute("data-step", "2");
  await page.keyboard.press("Alt+Tab");
  await expect(demo).toHaveAttribute("data-step", "3");
  await expect(demo.locator("[data-demo-announcement]")).toHaveText("Thought complete. The suggestion sequence will restart.");
});

test("double Option requests Deep Complete before Option+Tab accepts it", async ({ page }) => {
  await page.goto("/");

  const demo = page.getByRole("region", { name: "Interactive Deep Complete example" });
  await waitForHydration(demo);
  await demo.focus();
  await page.keyboard.press("Alt");
  await page.keyboard.press("Alt");

  await expect(demo).toHaveAttribute("data-phase", "requesting");
  await expect(demo.locator("[data-deep-announcement]")).toHaveText("Deep Complete requested with a double-tap of Option.");
  await expect(demo).toHaveAttribute("data-phase", "ready");
  await page.keyboard.press("Alt+Tab");
  await expect(demo).toHaveAttribute("data-phase", "accepted");
  await expect(demo.locator("[data-deep-announcement]")).toHaveText("Deep Complete suggestion accepted.");
});

test("reduced motion keeps both workflows usable without looping movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator(".tab-motion-toggle").first()).toBeHidden();
  await expect(page.locator(".tab-deep-key").first()).toHaveCSS("animation-name", "none");
  await expect(page.locator(".tab-app-marquee-track")).toHaveCSS("animation-name", "none");

  const demo = page.getByRole("region", { name: "Interactive Tab autocomplete example" });
  await waitForHydration(demo);
  await demo.focus();
  await page.keyboard.press("Alt+Tab");
  await expect(demo).toHaveAttribute("data-step", "1");
});

test("links and account forms remain usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto("http://localhost:3000/");
  await expect(page.getByRole("link", { name: "Download for Mac" }).first()).toHaveAttribute("href", "/download/tab.dmg");

  await page.goto("http://localhost:3000/login");
  const form = page.locator('form[action="/login"]');
  await expect(form).toHaveAttribute("method", "post");
  await expect(form.locator('input[name="email"]')).toBeVisible();
  await expect(form.locator('input[name="password"]')).toBeVisible();
  await form.locator('input[name="email"]').fill("missing-e2e-user@example.com");
  await form.locator('input[name="password"]').fill("invalid-password");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\?error=invalid_credentials/);
  await expect(page.getByText("Invalid email or password.")).toBeVisible();

  await context.close();
});
