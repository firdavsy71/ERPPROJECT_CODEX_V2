import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute, type BusinessAction } from "../src/services/operations";
import {
  allocateByValue,
  inspectionTotals,
  receiptLineCost,
} from "../src/services/procurement";
import type { Actor } from "../src/lib/permissions";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor, supplier: string, material: string;
const act = (action: BusinessAction, input: unknown, key = randomUUID()) =>
  execute(actor, action, input, key);
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
beforeEach(async () => {
  await db().execute(
    sql`truncate users,warehouses,materials,suppliers cascade`,
  );
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  actor = { id: u.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  [supplier] = (
    await db().insert(s.suppliers).values({ name: "Supplier" }).returning()
  ).map((x) => x.id);
  [material] = (
    await db()
      .insert(s.materials)
      .values({ name: "Fabric", sku: "FAB", unit: "Meters" })
      .returning()
  ).map((x) => x.id);
});
async function purchase(track = false) {
  if (track)
    await act("activateRollTracking", { materialId: material, rolls: [] });
  await act("purchase", {
    partyId: supplier,
    currency: "UZS",
    date: "2099-01-01",
    lines: [{ itemId: material, quantity: "100", price: "50000" }],
  });
  const [order] = await db().select().from(s.purchases);
  const [line] = await db().select().from(s.purchaseItems);
  await act("orderPurchase", { id: order.id });
  await act("receive", {
    id: order.id,
    lines: [
      {
        id: line.id,
        quantity: "100",
        ...(track
          ? {
              rolls: [
                {
                  rollNumber: "R1",
                  receivedLength: "100",
                  color: "Lime",
                  composition: "Cotton",
                  widthCm: "150",
                  storageLocation: "A",
                },
              ],
            }
          : {}),
      },
    ],
  });
  const [receipt] = await db().select().from(s.receipts);
  const [item] = await db().select().from(s.purchaseReceiptItems);
  return { order, line, receipt, item };
}
it("records original supplier prices, inspection, incidents and landed costs without changing purchase prices", async () => {
  const { order, line, receipt, item } = await purchase();
  expect(item.unitPrice).toBe("50000.00");
  expect(item.orderedAt).not.toBeNull();
  const key = randomUUID(),
    inspection = {
      receiptItemId: item.id,
      accepted: "90",
      rejected: "10",
      notes: "Damage on arrival",
    };
  await act("inspectProcurement", inspection, key);
  await act("inspectProcurement", inspection, key);
  expect(
    (
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.materialId, material))
    )[0].onHand,
  ).toBe("90.0000");
  expect(await db().select().from(s.supplierIncidents)).toHaveLength(1);
  expect(
    inspectionTotals(item, await db().select().from(s.procurementInspections)),
  ).toEqual({
    accepted: "90.0000",
    rejected: "10.0000",
    uninspected: "0.0000",
  });
  await expect(
    act("inspectProcurement", { ...inspection, accepted: "1", rejected: "0" }),
  ).rejects.toThrow("exceed");
  await act("recordProcurementExpense", {
    receiptId: receipt.id,
    kind: "Freight",
    reference: "FREIGHT-1",
    amount: "300000",
    notes: "Freight invoice",
  });
  await act("recordProcurementExpense", {
    receiptId: receipt.id,
    kind: "Handling",
    reference: "HANDLING-1",
    amount: "100000",
    notes: "Handling invoice",
  });
  expect(
    receiptLineCost(item, await db().select().from(s.procurementAllocations)),
  ).toEqual({
    base: "5000000.00",
    expenses: "400000.00",
    landed: "5400000.00",
    landedPerUnit: "54000.0000",
  });
  expect(
    (
      await db()
        .select()
        .from(s.purchaseItems)
        .where(eq(s.purchaseItems.id, line.id))
    )[0].price,
  ).toBe("50000.00");
  await expect(
    db()
      .update(s.purchaseItems)
      .set({ price: "1" })
      .where(eq(s.purchaseItems.id, line.id)),
  ).rejects.toThrow();
  await expect(
    db()
      .update(s.purchases)
      .set({ currency: "USD" })
      .where(eq(s.purchases.id, order.id)),
  ).rejects.toThrow();
  await expect(
    db()
      .delete(s.purchaseReceiptItems)
      .where(eq(s.purchaseReceiptItems.id, item.id)),
  ).rejects.toThrow();
  await expect(
    execute(
      { id: actor.id, role: "sales" },
      "recordProcurementExpense",
      {
        receiptId: receipt.id,
        kind: "Other",
        reference: "X",
        amount: "1",
        notes: "no",
      },
      randomUUID(),
    ),
  ).rejects.toThrow("permission");
});
it("rejects only the physical fabric roll from the received batch", async () => {
  const { item } = await purchase(true);
  const [roll] = await db().select().from(s.fabricRolls);
  await expect(
    act("inspectProcurement", {
      receiptItemId: item.id,
      accepted: "0",
      rejected: "5",
      notes: "Damage",
    }),
  ).rejects.toThrow("Select the received");
  await act("inspectProcurement", {
    receiptItemId: item.id,
    accepted: "95",
    rejected: "5",
    rollId: roll.id,
    notes: "Damaged end",
  });
  expect((await db().select().from(s.fabricRolls))[0].remainingLength).toBe(
    "95.0000",
  );
  expect(
    (
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.materialId, material))
    )[0].onHand,
  ).toBe("95.0000");
});
it("does not assert unverified prices for an order placed before snapshot tracking", async () => {
  const [order]=await db().insert(s.purchases).values({number:"PO-OLD-OPEN",supplierId:supplier,status:"Ordered",currency:"UZS",expectedDate:"2099-01-01"}).returning();
  const [line]=await db().insert(s.purchaseItems).values({orderId:order.id,materialId:material,quantity:"5",price:"20"}).returning();
  await act("receive",{id:order.id,lines:[{id:line.id,quantity:"5"}]});
  const [item]=await db().select().from(s.purchaseReceiptItems);
  expect(item).toMatchObject({unitPrice:null,expectedDate:null,orderedAt:null,provenance:"Legacy order"});
  await expect(act("recordProcurementExpense",{receiptId:item.receiptId,kind:"Freight",reference:"OLD",amount:"1",notes:"Unverified historical price"})).rejects.toThrow("verified original prices");
});
it("captures receipt movements from a previous application version during rollout", async () => {
  const [order]=await db().insert(s.purchases).values({number:"PO-OLD-DEPLOY",supplierId:supplier,status:"Ordered",currency:"UZS"}).returning();
  const [line]=await db().insert(s.purchaseItems).values({orderId:order.id,materialId:material,quantity:"5",price:"20"}).returning();
  const [warehouse]=await db().select().from(s.warehouses);
  const [balance]=await db().insert(s.balances).values({warehouseId:warehouse.id,materialId:material,onHand:"5",reserved:"0"}).returning();
  const key=randomUUID();
  const [receipt]=await db().insert(s.receipts).values({orderId:order.id,operationKey:key}).returning();
  await db().insert(s.movements).values({balanceId:balance.id,quantity:"5",reservedDelta:"0",reason:"Purchase receipt",source:order.number,operationKey:key+":"+line.id,createdBy:actor.id});
  const [item]=await db().select().from(s.purchaseReceiptItems);
  expect(item).toMatchObject({receiptId:receipt.id,purchaseItemId:line.id,unitPrice:null,provenance:"Legacy order"});
});
it("allocates costs by received value with no lost cents", () => {
  const result = allocateByValue("0.02", [
    { id: "a", quantity: "1", unitPrice: "1" },
    { id: "b", quantity: "1", unitPrice: "1" },
    { id: "c", quantity: "1", unitPrice: "1" },
  ]);
  expect(result.map((x) => x.amount)).toEqual(["0.01", "0.00", "0.01"]);
  expect(() =>
    allocateByValue("1", [{ id: "a", quantity: "1", unitPrice: "0" }]),
  ).toThrow("Positive known");
});

it("recovers old receipt quantities without inventing historical prices or timing", async () => {
  const client = new PGlite();
  const database = drizzle(client);
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  const procurementIndex = migrations.findIndex(m => m.sql.some(q => q.includes('CREATE TABLE "purchase_receipt_items"')));
  expect(procurementIndex).toBeGreaterThan(0);
  for (const migration of migrations.slice(0, procurementIndex))
    for (const statement of migration.sql) await client.exec(statement);
  const user = randomUUID(),
    warehouse = randomUUID(),
    supplierId = randomUUID(),
    materialId = randomUUID(),
    purchaseId = randomUUID(),
    lineId = randomUUID(),
    receiptId = randomUUID(),
    balanceId = randomUUID(),
    movementId = randomUUID(),
    key = randomUUID();
  await database.execute(
    sql`insert into users (id,name,email,password_hash,role) values (${user},'Admin','legacy@example.com','x','admin')`,
  );
  await database.execute(
    sql`insert into warehouses (id,name) values (${warehouse},'Legacy')`,
  );
  await database.execute(
    sql`insert into suppliers (id,name) values (${supplierId},'Supplier')`,
  );
  await database.execute(
    sql`insert into materials (id,name,sku,unit) values (${materialId},'Fabric','LEGACY','Meters')`,
  );
  await database.execute(
    sql`insert into purchase_orders (id,number,supplier_id,status,currency,expected_date,total) values (${purchaseId},'PO-LEGACY',${supplierId},'Received','UZS','2025-01-01',100)`,
  );
  await database.execute(
    sql`insert into purchase_order_items (id,order_id,material_id,quantity,received,price) values (${lineId},${purchaseId},${materialId},10,10,10)`,
  );
  await database.execute(
    sql`insert into purchase_receipts (id,order_id,operation_key) values (${receiptId},${purchaseId},${key})`,
  );
  await database.execute(
    sql`insert into inventory_balances (id,warehouse_id,material_id,on_hand,reserved) values (${balanceId},${warehouse},${materialId},10,0)`,
  );
  await database.execute(
    sql`insert into inventory_movements (id,balance_id,quantity,reserved_delta,reason,source,operation_key,created_by) values (${movementId},${balanceId},10,0,'Purchase receipt','PO-LEGACY',${key + ":" + lineId},${user})`,
  );
  for (const migration of migrations.slice(procurementIndex))
    for (const statement of migration.sql) await client.exec(statement);
  const rows = await database.select().from(s.purchaseReceiptItems);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    receiptId,
    purchaseItemId: lineId,
    quantity: "10.0000",
    unitPrice: null,
    expectedDate: null,
    orderedAt: null,
    provenance: "Recovered",
  });
  await client.close();
});
