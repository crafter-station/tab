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

  await context.close();
});
