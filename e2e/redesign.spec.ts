import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("industrial workspace navigation, theme persistence, command search and mobile signout", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search workspace" });
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).not.toBeVisible();
  const preferenceSaved = page.waitForResponse(r => r.url().endsWith("/api/theme") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Switch color theme" }).click();
  expect((await preferenceSaved).ok()).toBeTruthy();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.locator("dialog[open]");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/login/);
});

test("screens remain readable across viewports and themes with real persisted record details", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await login(page);
  const routes = ["dashboard", "products", "manufacturing", "materials", "sales", "customers", "invoices", "settings", "inventory", "boms", "purchases", "reports"];
  const details: { name: string; path: string }[] = [];
  for (const area of ["products", "manufacturing", "sales", "customers", "invoices"]) {
    await page.goto(`/${area}`);
    const link = page.locator(`main table a[href^='/${area}/']`).first();
    if (await link.count()) details.push({ name: `${area}-detail`, path: (await link.getAttribute("href"))! });
    else testInfo.annotations.push({ type: "coverage-limit", description: `${area} detail: no persisted fixture record available` });
  }
  for (const theme of ["light", "dark"]) {
    const preference = await page.request.post("/api/theme", { data: { theme }, headers: { origin: "http://localhost:3000" } });
    expect(preference.ok()).toBeTruthy();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of [...routes.map((name) => ({ name, path: `/${name}` })), ...details]) {
        await page.goto(route.path);
        await expect(page.locator("main h1").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, `${route.path} at ${width}px (${theme}) overflows page`).toBeLessThanOrEqual(2);
        await page.screenshot({ path: testInfo.outputPath(`${route.name}-${theme}-${width}.png`), fullPage: true });
      }
    }
  }
});

test("shared forms and tables expose keyboard-friendly controls without changing business data", async ({ page }) => {
  await login(page);
  await page.goto("/products");
  const table = page.locator(".table-card").first();
  await table.getByRole("button", { name: "Compact", exact: true }).click();
  await expect(table).toHaveClass(/table-density-compact/);
  const firstSort = table.locator("thead th").first();
  await firstSort.getByRole("button").click();
  await expect(firstSort).toHaveAttribute("aria-sort", "ascending");
  await table.getByRole("textbox", { name: "Search records" }).fill("UNMATCHED-REDESIGN-RECORD-902010");
  await expect(table.getByText("No matching records", { exact: true })).toBeVisible();
  await table.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add product", exact: true });
  await expect(dialog).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    // A modal can reserve a scrollbar gutter on one side of the viewport.
    expect(Math.abs(box!.x + box!.width / 2 - viewportWidth / 2)).toBeLessThan(10);
    expect(Math.abs(box!.y + box!.height / 2 - 450)).toBeLessThan(2);
  }
  await expect(dialog.getByLabel("Product name")).toHaveAttribute("aria-required", "true");
  await dialog.getByLabel("Product name").fill("Unsaved keyboard QA draft");
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
