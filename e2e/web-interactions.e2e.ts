import { expect, test, type Locator } from "@playwright/test";

async function waitForHydration(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => (
    Object.keys(element).some((key) => key.startsWith("__reactProps"))
  ))).toBe(true);
}

test("shared dropdowns dismiss on outside click and Escape", async ({ page }) => {
  await page.goto("/");

  const brandTrigger = page.getByRole("button", { name: "Open Tab brand menu" });
  await waitForHydration(brandTrigger);
  await brandTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Brand guidelines" })).toBeVisible();

  await page.mouse.click(700, 400);
  await expect(brandTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("menuitem", { name: "Brand guidelines" })).toBeHidden();

  await brandTrigger.click();
  await page.keyboard.press("Escape");
  await expect(brandTrigger).toBeFocused();
  await expect(brandTrigger).toHaveAttribute("aria-expanded", "false");

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

test("theme radio selection persists across navigation", async ({ page }) => {
  await page.goto("/");

  const brandTrigger = page.getByRole("button", { name: "Open Tab brand menu" });
  await waitForHydration(brandTrigger);
  await brandTrigger.click();
  const darkTheme = page.getByRole("menuitemradio", { name: "Dark" });
  await darkTheme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tab-theme"))).toBe("dark");

  await page.goto("/pricing");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Open Tab brand menu" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
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
