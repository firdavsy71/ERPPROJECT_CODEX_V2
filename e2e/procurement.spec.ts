import { test, expect, type Page, type Locator } from "@playwright/test";
async function action(
  page: Page,
  name: string,
  fill?: (dialog: Locator) => Promise<void>,
) {
  await page.getByRole("button", { name, exact: true }).click();
  const d = page.locator("dialog[open]");
  if (fill) await fill(d);
  await d.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(d).toHaveCount(0);
}
test("records receipt quality and landed costs in purchasing", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/purchases");
  await action(page, "New purchase order", async (d) => {
    await d
      .getByRole("combobox", { name: "Supplier *", exact: true })
      .selectOption({ label: "Textile Supply Co." });
    await d.getByLabel("Expected delivery").fill("2099-01-01");
    await d
      .getByRole("combobox", { name: "Material *", exact: true })
      .selectOption({ label: "Polycotton fabric (Meters)" });
    await d
      .getByRole("spinbutton", { name: "Quantity *", exact: true })
      .fill("100");
    await d.getByLabel("Unit price").fill("50000");
  });
  await page.getByRole("link", { name: /^PO-/ }).click();
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  const placeDialog = page.locator("dialog[open]");
  await page.context().clearCookies();
  await placeDialog.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(placeDialog.getByRole("alert")).toContainText("session is no longer active");
  const [loginPage] = await Promise.all([
    page.context().waitForEvent("page"),
    placeDialog.getByRole("link", {name: "Sign in in a new tab"}).click(),
  ]);
  await loginPage.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await loginPage.getByLabel("Password", {exact:true}).fill(process.env.ADMIN_PASSWORD!);
  await loginPage.getByRole("button", {name:"Sign in to workspace"}).click();
  await expect(loginPage).toHaveURL(/dashboard/);
  await placeDialog.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(placeDialog).toHaveCount(0);
  await action(page, "Receive materials", async (d) => {
    await d.getByLabel("Purchase line").selectOption({ index: 1 });
    await d.getByLabel("Received quantity").fill("100");
  });
  await page
    .getByRole("link", { name: "Receipt quality and landed costs" })
    .click();
  await action(page, "Inspect received material", async (d) => {
    await d.getByLabel("Receipt line").selectOption({ index: 1 });
    await d.getByLabel("Accepted quantity").fill("90");
    await d.getByLabel("Rejected quantity").fill("10");
    await d.getByLabel("Inspection findings").fill("Damaged fabric on receipt");
  });
  await action(page, "Record procurement expense", async (d) => {
    await d.getByLabel("Receipt", { exact: false }).selectOption({ index: 1 });
    await d.getByLabel("Expense type").selectOption("Freight");
    await d.getByLabel("Unique expense document reference").fill("FREIGHT-UI");
    await d.getByLabel("Amount in purchase currency").fill("300000");
    await d.getByLabel("Expense details").fill("Freight");
  });
  await action(page, "Record procurement expense", async (d) => {
    await d.getByLabel("Receipt", { exact: false }).selectOption({ index: 1 });
    await d.getByLabel("Expense type").selectOption("Handling");
    await d.getByLabel("Unique expense document reference").fill("HANDLING-UI");
    await d.getByLabel("Amount in purchase currency").fill("100000");
    await d.getByLabel("Expense details").fill("Handling");
  });
  await expect(
    page.getByRole("cell", { name: "5400000.00", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("cell", { name: "Damaged fabric on receipt", exact: true })
      .first(),
  ).toBeVisible();
});
