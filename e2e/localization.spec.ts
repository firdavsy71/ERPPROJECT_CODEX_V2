import { test, expect } from "@playwright/test";
test("language selection persists across navigation and localizes common forms, reports and invoices", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByLabel("Language", { exact: true }).selectOption("ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(
    page.getByRole("link", { name: "Счета", exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Изменить настройки" }).click();
  await expect(page.locator("dialog[open]").getByLabel("ИНН")).toBeVisible();
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Отмена" })
    .click();
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Отчёты" })).toBeVisible();
  await page.goto("/invoices");
  await page.getByRole("link", { name: /^INV-/ }).first().click();
  await page.getByRole("link", { name: "Печать счёта" }).click();
  await expect(
    page.getByText("Дата выставления", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Язык", { exact: true }).selectOption("uz");
  await expect(page.locator("html")).toHaveAttribute("lang", "uz");
  await expect(page.getByText("Berilgan sana", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "uz");
  await expect(
    page.getByRole("button", { name: "Hisobni chop etish" }),
  ).toBeVisible();
  await page.getByLabel("Til", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
