import { test, expect, type Page } from "@playwright/test";
import { createApprovedSpecification } from "./spec-support";
async function save(page: Page) {
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
async function open(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator("dialog[open]")).toBeVisible();
}
test("authentication gates routes and CSV", async ({ page, request }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/login/);
  const response = await request.get("/api/reports?report=sales");
  expect(response.status()).toBe(401);
});
test("administrator runs a persisted sales-to-production workflow through the UI", async ({
  page,
}) => {
  const unique = Date.now().toString();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/customers");
  await open(page, "Add customer");
  await page.getByLabel("Company name").fill(`E2E Customer ${unique}`);
  await save(page);
  await page.goto("/products");
  await open(page, "Add product");
  await page.getByLabel("Product name").fill(`E2E Jacket ${unique}`);
  await page.getByLabel("Product SKU").fill(`E2E-${unique}`);
  await save(page);
  await page.getByLabel("Search records").fill(`E2E Jacket ${unique}`);
  await page
    .getByRole("link", { name: `E2E Jacket ${unique}`, exact: true })
    .click();
  await open(page, "Add variant");
  await page.getByLabel("Variant SKU").fill(`E2E-${unique}-L`);
  await page.getByLabel("Size", { exact: false }).fill("L");
  await page
    .getByRole("textbox", { name: "Color *", exact: true })
    .fill("Navy");
  await page.getByLabel("Selling price").fill("100");
  await save(page);
  await createApprovedSpecification(
    page,
    `E2E Jacket ${unique}`,
    `E2E-${unique}-L`,
  );
  await page.goto("/boms");
  await open(page, "New BOM version");
  await page.getByLabel("Variant", { exact: false }).selectOption({
    label: `E2E-${unique}-L · E2E Jacket ${unique} / L / Navy`,
  });
  await page
    .getByRole("combobox", { name: "Material *", exact: true })
    .selectOption({ label: "Polycotton fabric (Meters)" });
  await page.getByLabel("Consumption per unit").fill("2.5");
  await save(page);
  await page.goto("/sales");
  await open(page, "New sales order");
  await page
    .getByLabel("Customer *")
    .selectOption({ label: `E2E Customer ${unique}` });
  await page.getByLabel("Product variant").selectOption({
    label: `E2E-${unique}-L · E2E Jacket ${unique} / L / Navy`,
  });
  await page.getByLabel("Quantity *", { exact: true }).fill("10");
  await page.getByLabel("Unit price").fill("100");
  await save(page);
  const saleRow = page
    .getByRole("row")
    .filter({ hasText: `E2E Customer ${unique}` });
  const saleNumber = await saleRow.getByRole("link").innerText();
  await saleRow.getByRole("link").click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]+$/);
  const saleUrl = page.url();
  await open(page, "Confirm order");
  await save(page);
  await page.goto("/manufacturing");
  await open(page, "New production order");
  await page
    .getByRole('combobox',{name:'BOM version *',exact:true})
    .selectOption({ label: `E2E Jacket ${unique} / L / Navy · v1` });
  await page.getByLabel("Planned quantity").fill("10");
  await save(page);
  const moRow = page
    .getByRole("row")
    .filter({ hasText: `E2E Jacket ${unique}` });
  await moRow.getByRole("link").click();
  await open(page, "Check & reserve materials");
  await save(page);
  await open(page, "Start production");
  await save(page);
  await open(page, "Record output");
  await page.getByLabel("Completed units").fill("10");
  await save(page);
  await open(page, "Approve quality & complete");
  await page.getByLabel("QC: Visual finish").selectOption("Pass");
  await page.getByLabel("Reserved material").selectOption({ index: 1 });
  await page.getByLabel("Actual consumed").fill("25");
  await save(page);
  await expect(page.getByRole("heading", { name: /MO-/ })).toContainText(
    "Completed",
  );
  await page.goto(saleUrl);
  await open(page, "Reserve available stock");
  await save(page);
  await expect(page.getByRole("heading", { name: /SO-/ })).toContainText(
    "Ready for Shipment",
  );
  await open(page, "Record shipment");
  await page.getByLabel("Sales line").selectOption({ index: 1 });
  await page
    .locator("dialog[open]")
    .getByLabel("Quantity *", { exact: true })
    .fill("10");
  await save(page);
  await open(page, "Generate invoice");
  await page.getByLabel("Due date").fill("2027-01-01");
  await save(page);
  await page.goto("/invoices");
  await page
    .getByRole("row")
    .filter({ hasText: saleNumber })
    .first()
    .getByRole("link")
    .click();
  await open(page, "Record payment");
  await page.getByLabel("Payment amount").fill("1000");
  await page.getByLabel("Payment reference").fill(`E2E-${unique}`);
  await save(page);
  await expect(
    page.getByRole("cell", { name: `E2E-${unique}`, exact: true }),
  ).toBeVisible();
  await page.goto(saleUrl);
  await expect(page.getByRole("heading", { name: /SO-/ })).toContainText(
    "Completed",
  );
  await page.goto("/dashboard");
  await expect(page.getByText("Business overview.")).toBeVisible();
  await expect(page.locator(".financial-row")).toContainText("Total invoiced");
  expect(
    Number(await page.locator(".kpi").nth(2).locator("strong").innerText()),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: ".local/dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/mobile.png", fullPage: true });
});
