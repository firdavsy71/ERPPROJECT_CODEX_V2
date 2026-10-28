import {test,expect,type Page,type Locator} from "@playwright/test";
import sharp from "sharp";
async function action(page:Page,name:string,fill?:(dialog:Locator)=>Promise<void>){
  await page.getByRole("button",{name,exact:true}).click();const d=page.locator("dialog[open]");if(fill)await fill(d);
  await d.getByRole("button",{name:"Save record",exact:true}).click();await expect(d).toHaveCount(0);
}
test("creates a historical sales document with logo and downloads a protected PDF",async({page,request})=>{
  await page.goto("/login");await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);await page.getByLabel("Password",{exact:true}).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"Sign in to workspace"}).click();await expect(page).toHaveURL(/dashboard/);
  await page.goto("/settings");
  const png=await sharp({create:{width:20,height:20,channels:3,background:"#1a7766"}}).png().toBuffer();
  await page.locator('input[type="file"][name="file"]').setInputFiles({name:"logo.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"Upload company logo"}).click();await expect(page.getByText("Company logo saved.")).toBeVisible();
  await page.goto("/sales");await action(page,"New sales order",async d=>{
    await d.getByRole("combobox",{name:"Customer *",exact:true}).selectOption({label:"Industrial Solutions LLC"});
    await d.getByLabel("Product variant").selectOption({label:"JKT-NAV-L · Industrial Work Jacket / L / Navy"});
    await d.getByRole("spinbutton",{name:"Quantity *",exact:true}).fill("2");
    await d.getByLabel("Unit price").fill("100");
  });
  await page.getByRole("row").filter({hasText:"Industrial Solutions LLC"}).getByRole("link").first().click();
  await action(page,"Confirm order");await page.getByRole("link",{name:"Printable sales order / PDF"}).click();
  await expect(page.getByRole("heading",{name:"Sales order confirmation"})).toBeVisible();await expect(page.getByRole("img",{name:"Company logo"})).toBeVisible();
  const documentUrl=page.url();
  const response=await page.request.get(await page.getByRole("link",{name:"Download PDF"}).getAttribute("href") as string);
  expect(response.status()).toBe(200);expect(response.headers()["content-type"]).toBe("application/pdf");expect((await response.body()).subarray(0,5).toString()).toBe("%PDF-");
  const anonymous=await request.get(await page.getByRole("link",{name:"Download PDF"}).getAttribute("href") as string);expect(anonymous.status()).toBe(401);
  await page.goto("/settings");await page.getByRole("button",{name:"Remove logo from future documents"}).click();await expect(page.getByText("Company logo removed from future documents.")).toBeVisible();
  await page.goto(documentUrl);await expect(page.getByRole("img",{name:"Company logo"})).toBeVisible();
});
