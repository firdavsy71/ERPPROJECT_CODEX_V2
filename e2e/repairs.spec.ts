import { test, expect, type Page, type Locator } from "@playwright/test";
async function action(page: Page, name: string, fill: (dialog: Locator) => Promise<void>) {
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.locator("dialog[open]");
  await fill(dialog);
  await dialog.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test("customer garment moves through repair, quality inspection and return", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("Password", {exact:true}).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"Sign in to workspace"}).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/employees");
  await action(page,"Add employee",async d=>{await d.getByLabel("Full name").fill("Repair Test Tailor");});
  await page.goto("/repairs");
  await action(page,"Receive repair request",async d=>{
    await d.getByRole("combobox", {name:"Customer *",exact:true}).selectOption({label:"Industrial Solutions LLC"});
    await d.getByLabel("Original garment identification / condition").fill("Customer jacket L with torn seam");
    await d.getByLabel("Requested activity").selectOption("Seam repair");
    await d.getByLabel("Requested adjustments / customer instructions").fill("Repair torn sleeve seam");
    await d.getByLabel("Assigned employee (optional)").selectOption({label:"Repair Test Tailor"});
    await d.getByLabel("Repair cost").fill("25");
    await d.getByLabel("Currency").fill("UZS");
  });
  await page.getByRole("link",{name:/^REP-/}).click();
  await expect(page.getByText("Received · Customer-owned garment")).toBeVisible();
  async function status(value:string) {
    await action(page,"Update repair status / record quality result",async d=>{
      await d.getByLabel("Next status").selectOption(value);
      await d.getByLabel("Notes / evidence").fill("Work and inspection recorded");
    });
  }
  await status("Diagnosed"); await status("In Progress");
  await action(page,"Record actual labor",async d=>{
    await d.getByRole("combobox",{name:"Employee *",exact:true}).selectOption({label:"Repair Test Tailor"});
    await d.getByLabel("Actual labor minutes").fill("35");
    await d.getByLabel("Notes / evidence").fill("Stitched sleeve seam");
  });
  await action(page,"Record material consumption",async d=>{
    await d.getByRole("combobox",{name:"Material *",exact:true}).selectOption({label:"THR · Sewing thread · Rolls"});
    await d.getByLabel("Actual quantity used").fill("1");
    await d.getByLabel("Notes / evidence").fill("Thread used for repair");
  });
  await status("Quality Check"); await status("Completed"); await status("Returned");
  await expect(page.getByText("Returned · Customer-owned garment")).toBeVisible();
  await expect(page.getByText("Stitched sleeve seam").first()).toBeVisible();
});
