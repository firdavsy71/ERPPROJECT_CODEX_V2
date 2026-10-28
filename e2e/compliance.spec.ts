import {test,expect,type Page,type Locator} from "@playwright/test";
async function action(page:Page,name:string,fill:(dialog:Locator)=>Promise<void>) {
  await page.getByRole("button",{name,exact:true}).click();
  const d=page.locator("dialog[open]"); await fill(d);
  await d.getByRole("button",{name:"Save record",exact:true}).click();
  await expect(d).toHaveCount(0);
}
test("administrator approves evidence and revokes a certificate",async({page})=>{
  await page.goto("/login"); await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!); await page.getByLabel("Password",{exact:true}).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"Sign in to workspace"}).click(); await expect(page).toHaveURL(/dashboard/);
  await page.goto("/compliance");
  await action(page,"Add safety standard reference",async d=>{
    await d.getByLabel("Standard reference").fill("TEST-UI-REFERENCE"); await d.getByLabel("Standard title").fill("Test safety reference");
  });
  await action(page,"Create certification draft",async d=>{
    await d.getByRole("combobox",{name:"Product *",exact:true}).selectOption({label:"Industrial Work Jacket"});
    await d.getByLabel("Safety standard").selectOption({label:"TEST-UI-REFERENCE · Test safety reference"});
    await d.getByLabel("Certificate number").fill("TEST-CERTIFICATE-UI"); await d.getByLabel("Issuing organization").fill("Test issuer");
    await d.getByLabel("Issue date").fill("2026-01-01"); await d.getByLabel("Expiration date").fill("2099-12-31"); await d.getByLabel("Certified scope / limitations").fill("User-provided sample scope");
  });
  await page.getByRole("link",{name:"TEST-CERTIFICATE-UI"}).click();
  await expect(page.getByText("Draft",{exact:true})).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({name:"test.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-test evidence")});
  await page.getByRole("button",{name:"Upload evidence"}).click(); await expect(page.getByText("Evidence saved")).toBeVisible();
  await action(page,"Approve evidence and certify",async d=>{await d.getByLabel("Approval / revocation evidence notes").fill("Verified certificate and scope");});
  await expect(page.getByText("Certified",{exact:true})).toBeVisible();
  const response=await page.request.get(await page.getByRole("link",{name:"Certificate · test.pdf"}).getAttribute("href") as string);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
  await action(page,"Revoke certification",async d=>{await d.getByLabel("Approval / revocation evidence notes").fill("Issuer withdrew certification");});
  await expect(page.getByText("Revoked",{exact:true}).first()).toBeVisible();
});
