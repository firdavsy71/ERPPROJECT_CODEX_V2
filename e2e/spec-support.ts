import { expect, type Page } from "@playwright/test";
export async function createApprovedSpecification(
  page: Page,
  product: string,
  sku: string,
  attach = false,
) {
  await page.goto("/specifications/new");
  await page
    .getByRole('combobox', {name:'Product',exact:true})
    .selectOption({ label: product });
  await page
    .getByLabel("Specification title", { exact: true })
    .fill(`${sku} technical sheet`);
  await page
    .getByLabel("Revision / change summary")
    .fill("Initial engineering release");
  await page
    .getByLabel(
      "Garment construction (panels, pockets, lining, set components)",
    )
    .fill("Two front panels, two chest pockets and center-front zipper.");
  await page
    .getByLabel("Manufacturing instructions", { exact: true })
    .fill(
      "Cut according to approved pattern. Assemble panels and inspect all seams.",
    );
  await page.getByRole("button", { name: "Add fabric", exact: true }).click();
  await page.getByLabel("Fabric name", { exact: true }).fill("Polycotton");
  await page
    .getByLabel("Composition 1 Fiber", { exact: true })
    .fill("Polyester");
  await page.getByLabel("Composition 1 Percent", { exact: true }).fill("65");
  await page
    .getByRole("button", { name: "Add composition", exact: true })
    .click();
  await page.getByLabel("Composition 2 Fiber", { exact: true }).fill("Cotton");
  await page.getByLabel("Composition 2 Percent", { exact: true }).fill("35");
  await page
    .getByRole("button", { name: "Add size chart measurements", exact: true })
    .click();
  await page
    .getByLabel("Size chart measurements 1 Measurement point", { exact: true })
    .fill("Chest half width");
  await page
    .getByLabel("Size chart measurements 1 Target", { exact: true })
    .fill("60");
  await page.getByRole("button", { name: "Add seams", exact: true }).click();
  await page
    .getByLabel("Seams 1 Location / component", { exact: true })
    .fill("Side seam");
  await page.getByLabel("Seams 1 Stitch type", { exact: true }).fill("301");
  await page
    .getByLabel("Seams 1 Seam type", { exact: true })
    .fill("Superimposed");
  await page
    .getByLabel("Seams 1 Thread specification", { exact: true })
    .fill("Polyester 40");
  await page
    .getByRole("button", { name: "Add quality checks", exact: true })
    .click();
  await page
    .getByLabel("Quality checks 1 Acceptance criterion", { exact: true })
    .fill("Visual finish");
  await page
    .getByRole("checkbox", { name: `${sku} · L / Navy`, exact: true })
    .check();
  await page.getByLabel("Fabric consumption per unit").fill("2.5");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/specifications\/[0-9a-f-]+$/);
  const url = page.url();
  if (attach) {
    await page
      .getByLabel("PNG, JPEG or PDF · up to 2 MiB · maximum 12 files")
      .setInputFiles({
        name: "engineering-drawing.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await page
      .getByRole("button", { name: "Upload attachment", exact: true })
      .click();
    await expect(
      page.getByText("Attachment saved", { exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Submit for approval", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve version", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Review note / rejection reason")
    .fill("Approved for production");
  await page
    .getByRole("button", { name: "Approve version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve version", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("PRODUCT TECHNICAL SPECIFICATION · APPROVED"),
  ).toBeVisible();
  return url;
}
