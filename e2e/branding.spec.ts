import { test, expect, type Page } from "@playwright/test";
import { createApprovedSpecification } from "./spec-support";
async function save(page: Page) {
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
test("sales staff can create and revise a real branding draft; unconfigured private storage blocks proof approval", async ({
  page,
  request,
}) => {
  const anonymous = await request.get(
    "/api/branding/00000000-0000-4000-8000-000000000000/files/00000000-0000-4000-8000-000000000000",
  );
  expect(anonymous.status()).toBe(401);
  const suffix = Date.now().toString();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await createApprovedSpecification(
    page,
    "Industrial Work Jacket",
    "JKT-NAV-L",
  );
  await page.goto("/customers");
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await page.getByLabel("Company name").fill(`Branding customer ${suffix}`);
  await save(page);
  await page.goto("/sales");
  await page
    .getByRole("button", { name: "New sales order", exact: true })
    .click();
  await page
    .getByLabel("Customer *")
    .selectOption({ label: `Branding customer ${suffix}` });
  await page
    .getByRole("combobox", { name: "Product variant *", exact: true })
    .selectOption({ label: "JKT-NAV-L · Industrial Work Jacket / L / Navy" });
  await page
    .locator("dialog[open]")
    .getByLabel("Quantity *", { exact: true })
    .fill("10");
  await page.getByLabel("Unit price").fill("100");
  await save(page);
  await page.getByLabel("Search records").fill(`Branding customer ${suffix}`);
  await page
    .getByRole("row")
    .filter({ hasText: `Branding customer ${suffix}` })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]+$/);
  const orderUrl = page.url();
  await page
    .getByRole("link", { name: "Request customer branding", exact: true })
    .click();
  await expect(page).toHaveURL(/\/branding\/new/);
  await page
    .getByLabel("Design title", { exact: true })
    .fill(`Customer design ${suffix}`);
  await page
    .getByLabel("Change summary", { exact: true })
    .fill("Initial company branding");
  await page
    .getByLabel("Customer-specific design instructions")
    .fill("White company logo on left chest");
  await page
    .getByLabel("Exact production instructions")
    .fill("Use approved artwork. Position logo 90 mm below shoulder seam.");
  await page
    .getByRole("button", { name: "Add decoration", exact: true })
    .click();
  await page
    .getByLabel("Decoration 1 Ink / transfer / thread colors", { exact: true })
    .fill("White");
  await page
    .getByLabel("Decoration 1 Embroidery thread specification", { exact: true })
    .fill("Polyester 40");
  await page
    .getByLabel("Decoration 1 Exact position / distance from datum", {
      exact: true,
    })
    .fill("90 mm below left shoulder");
  await page
    .getByLabel(
      "Decoration 1 Application instructions (stitches / inks / temperature / time / pressure)",
      { exact: true },
    )
    .fill("Use backing and satin stitch");
  await page
    .getByLabel("Decoration 1 Customization price per garment", { exact: true })
    .fill("2.50");
  await page
    .getByLabel("Decoration 1 One-time setup price", { exact: true })
    .fill("10");
  await expect(page.getByText("35.00", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Save branding draft", exact: true })
    .click();
  await expect(page).toHaveURL(/\/branding\/[0-9a-f-]+$/);
  const designUrl = page.url();
  await expect(
    page.getByRole("button", {
      name: "Upload private branding file",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByText("Private file storage is not connected.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Submit design proof", exact: true })
    .click();
  await expect(
    page.getByText("Upload a design proof for the current draft revision.", {
      exact: false,
    }),
  ).toBeVisible();
  const id = new URL(designUrl).pathname.split("/").pop()!;
  const crossOrigin = await page.request.post(`/api/branding/${id}/files`, {
    headers: { Origin: "https://untrusted.example" },
  });
  expect(crossOrigin.status()).toBe(403);
  const unavailable = await page.request.post(`/api/branding/${id}/files`, {
    headers: { Origin: "http://localhost:3000" },
  });
  expect(unavailable.status()).toBe(503);
  await page.goto(orderUrl);
  await page
    .getByRole("button", { name: "Confirm order", exact: true })
    .click();
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.locator("dialog[open]").getByRole("alert")).toContainText(
    "Approve all requested branding designs",
  );
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.goto(designUrl);
  await page
    .getByRole("button", { name: "Create branding revision", exact: true })
    .click();
  await expect(page).toHaveURL(/edit=1/);
  await page
    .getByLabel("Change summary", { exact: true })
    .fill("Revised thread color");
  await page
    .getByLabel("Decoration 1 Ink / transfer / thread colors", { exact: true })
    .fill("Silver");
  await page
    .getByRole("button", { name: "Save branding draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customer branding · v2", exact: true }),
  ).toBeVisible();
  await page.goto(designUrl);
  await expect(
    page.getByText("Colors: White · Thread: Polyester 40", { exact: true }),
  ).toBeVisible();
});
