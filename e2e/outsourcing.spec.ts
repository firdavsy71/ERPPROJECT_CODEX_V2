import { test, expect, type Page } from "@playwright/test";
import { createApprovedSpecification } from "./spec-support";
async function save(page: Page) {
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
test("outsourcing custody and QC receipts are persisted through the UI", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/subcontractors");
  await page.getByRole("button", { name: "New subcontractor profile" }).click();
  await page
    .getByRole("combobox", { name:"Supplier *", exact: true })
    .selectOption({ label: "Textile Supply Co." });
  await page.getByLabel("Workshop specialties").fill("Jacket sewing");
  await page.getByLabel("Capacity (garments per month)").fill("200");
  await save(page);
  await createApprovedSpecification(
    page,
    "Industrial Work Jacket",
    "JKT-NAV-L",
  );
  await page.goto("/manufacturing");
  await page.getByRole("button", { name: "New production order" }).click();
  await page
    .getByRole("combobox", { name: "BOM version *", exact: true })
    .selectOption({ label: "Industrial Work Jacket / L / Navy · v1" });
  await page.getByLabel("Planned quantity").fill("2");
  await save(page);
  await page
    .getByRole("row")
    .filter({ hasText: "Industrial Work Jacket / L / Navy" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/manufacturing\/[0-9a-f-]+$/);
  const moId = page.url().split("/").at(-1)!;
  await page.goto("/outsourcing");
  await page.getByRole("button", { name: "New outsourcing order" }).click();
  await page
    .getByLabel("Draft manufacturing order / product / quantity")
    .selectOption(moId);
  await page
    .getByRole("combobox", { name:"Subcontractor *", exact: true })
    .selectOption({ label: "Textile Supply Co." });
  await page.getByLabel("Expected final return date").fill("2027-01-01");
  await page.getByRole("combobox", { name:"Currency *", exact: true }).selectOption("USD");
  await page.getByLabel("Agreed cost per assigned garment").fill("5");
  await save(page);
  await page.getByRole("link", { name: /^OUT-/ }).click();
  await page
    .getByRole("button", { name: "Activate and reserve BOM materials" })
    .click();
  await save(page);
  await page
    .getByRole("button", { name: "Issue materials into subcontractor custody" })
    .click();
  const material = page.getByRole("combobox", { name:"Allocated material *", exact: true });
  const option = await material
    .locator("option", { hasText: "Polycotton fabric" })
    .getAttribute("value");
  await material.selectOption(option!);
  await page.getByLabel("Quantity physically issued").fill("5");
  await page.locator("dialog[open]").getByLabel("Document reference").fill("ISSUE-E2E");
  await save(page);
  await page
    .getByRole("button", {
      name: "Record consumption or unused material return",
    })
    .click();
  await page.getByLabel("Outstanding custody line").selectOption({ index: 1 });
  await page.getByLabel("Document type").selectOption("Consumed");
  await page
    .locator("dialog[open]")
    .getByRole("spinbutton", { name:"Quantity *", exact: true })
    .fill("5");
  await page.locator("dialog[open]").getByLabel("Document reference").fill("USE-E2E");
  await save(page);
  await page
    .getByRole("button", { name: "Record cumulative production progress" })
    .click();
  await page.getByLabel("Cumulative quantity produced").fill("2");
  await save(page);
  await page
    .getByRole("button", { name: "Receive and inspect partial delivery" })
    .click();
  await page.locator("dialog[open]").getByLabel("Document reference").fill("RECEIPT-E2E");
  await page.getByLabel("Accepted finished goods").fill("2");
  await page.getByLabel("Rejected / defective goods").fill("0");
  await page.getByLabel("QC: Visual finish").selectOption("Pass");
  await page
    .getByLabel("Inspection findings / defect description")
    .fill("All units match the approved specification");
  await save(page);
  await page.getByRole("button", { name: "Close reconciled order" }).click();
  await save(page);
  await expect(
    page.getByText("Completed · 2 assigned", { exact: false }),
  ).toBeVisible();
});
