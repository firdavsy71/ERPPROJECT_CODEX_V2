import { test, expect, type Page } from "@playwright/test";
async function save(page: Page) {
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
test("approved wholesale quotation converts to a fixed-price sales order", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/pricing");
  await page
    .getByRole("button", {
      name: "New price list / contract version",
      exact: true,
    })
    .click();
  let dialog = page.locator("dialog[open]");
  await dialog
    .getByLabel("Product variant")
    .selectOption({ label: "JKT-NAV-L · L / Navy" });
  await dialog
    .getByLabel("Contract number / price list name")
    .fill("E2E Jacket wholesale");
  await dialog.getByLabel("Rule priority").selectOption("Volume");
  await dialog
    .getByRole("combobox", { name: "Currency *", exact: true })
    .selectOption("UZS");
  await dialog.getByLabel("Starts on").fill("2020-01-01");
  await dialog.getByLabel("Expires on").fill("2099-12-31");
  await dialog.getByLabel("Minimum order quantity").fill("1");
  for (const [i, q, p] of [
    [0, 1, "180000"],
    [1, 50, "165000"],
    [2, 200, "150000"],
  ] as const) {
    if (i)
      await dialog
        .getByRole("button", { name: "Add line", exact: true })
        .click();
    const row = dialog.locator(".line-row").nth(i);
    await row.getByLabel("From quantity").fill(String(q));
    await row
      .getByLabel("Fixed price or exclusive discount")
      .selectOption("Price");
    await row.getByLabel("Unit price / discount percent").fill(p);
  }
  await save(page);
  await page
    .getByRole("link", { name: "E2E Jacket wholesale", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pricing\/[0-9a-f-]+$/);
  await page
    .getByRole("button", { name: "Approve pricing rule", exact: true })
    .click();
  await save(page);
  await page.goto("/quotations");
  await page
    .getByRole("button", { name: "New priced quotation", exact: true })
    .click();
  dialog = page.locator("dialog[open]");
  await dialog
    .getByRole("combobox", { name: "Customer *", exact: true })
    .selectOption({ label: "Industrial Solutions LLC" });
  await dialog
    .getByRole("combobox", { name: "Currency *", exact: true })
    .selectOption("UZS");
  await dialog.getByLabel("Quotation valid through").fill("2099-01-01");
  await dialog
    .getByRole("combobox", { name: "Variant *", exact: true })
    .selectOption({ label: "JKT-NAV-L" });
  await dialog.getByLabel("Quantity").fill("50");
  await save(page);
  await page.getByRole("link", { name: /^QUO-/ }).click();
  await expect(page).toHaveURL(/\/quotations\/[0-9a-f-]+$/);
  await expect(page.getByText(/product total 8250000.00 UZS/)).toBeVisible();
  await page
    .getByRole("button", { name: "Approve quotation prices", exact: true })
    .click();
  await save(page);
  await page
    .getByRole("button", {
      name: "Convert approved quotation to sales order",
      exact: true,
    })
    .click();
  await save(page);
  await page.getByRole("link", { name: /^SO-/ }).click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]+$/);
  await page
    .getByRole("button", { name: "Confirm order", exact: true })
    .click();
  await save(page);
  await expect(page.getByRole("heading", { name: /SO-/ })).toContainText(
    "Confirmed",
  );
  await expect(
    page.getByRole("cell", { name: "165000.00", exact: true }),
  ).toBeVisible();
});
