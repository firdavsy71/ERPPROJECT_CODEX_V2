import { test, expect } from "@playwright/test";
import { createApprovedSpecification } from "./spec-support";
test("engineer creates, attaches, approves, prints and revises a technical sheet", async ({
  page,
  request,
}) => {
  const unauth = await request.post(
    "/api/specifications/00000000-0000-4000-8000-000000000000/attachments",
  );
  expect(unauth.status()).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  const crossOrigin=await page.request.post('/api/specifications/00000000-0000-4000-8000-000000000000/attachments',{headers:{Origin:'https://untrusted.example'}});expect(crossOrigin.status()).toBe(403);
  const url = await createApprovedSpecification(
    page,
    "Industrial Work Jacket",
    "JKT-NAV-L",
    true,
  );
  const image = page.getByRole("img", { name: "engineering-drawing.png" });
  await expect(image).toBeVisible();
  const response = await page.request.get(
    (await image.getAttribute("src")) as string,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  await expect(
    page.getByRole("link", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Upload attachment", exact: true }),
  ).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Print technical sheet" }),
  ).toBeHidden();
  await expect(page.getByText("Chest half width").first()).toBeVisible();
  await page.pdf({
    path: ".local/technical-sheet.pdf",
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Create next version", exact: true })
    .click();
  await expect(page).toHaveURL(/edit=1/);
  await expect(
    page.getByLabel("Specification title", { exact: true }),
  ).toHaveValue("JKT-NAV-L technical sheet");
  await page.getByLabel("Revision / change summary").fill("Updated lining");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Edit draft", exact: true }),
  ).toBeVisible();
  await page.goto(url);
  await expect(
    page.getByText("PRODUCT TECHNICAL SPECIFICATION · APPROVED"),
  ).toBeVisible();
});
