import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute } from "../src/services/operations";
import { checkConsistency } from "../src/services/consistency";

process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;

beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});

it("preserves untracked material and finished-goods movement history while allowing append-only corrections", async () => {
  const [user] = await db().insert(s.users).values({
    name: "Ledger administrator", email: "ledger@example.test",
    passwordHash: "test-only", role: "admin",
  }).returning();
  await db().insert(s.warehouses).values({ name: "Main" });
  const [material] = await db().insert(s.materials).values({
    name: "Buttons", sku: "BUTTONS", unit: "Pieces",
  }).returning();
  const [product] = await db().insert(s.products).values({ name: "Jacket", sku: "JACKET" }).returning();
  const [variant] = await db().insert(s.variants).values({
    productId: product.id, sku: "JACKET-L", size: "L", color: "Navy",
  }).returning();

  for (const [kind, itemId] of [["material", material.id], ["variant", variant.id]] as const) {
    const post = (delta: string) => execute({ id: user.id, role: "admin" }, "adjust", {
      kind, itemId, delta, reason: "Documented stock count adjustment",
    }, randomUUID());
    await post("10");
    const [balance] = await db().select().from(s.balances).where(
      kind === "material" ? eq(s.balances.materialId, itemId) : eq(s.balances.variantId, itemId),
    );
    expect(balance.rollTracked).toBe(false);
    await expect(db().update(s.balances).set({onHand:"11"}).where(eq(s.balances.id,balance.id))).rejects.toThrow();
    await expect(db().update(s.balances).set({held:"1"}).where(eq(s.balances.id,balance.id))).rejects.toThrow();
    const [movement] = await db().select().from(s.movements).where(eq(s.movements.balanceId, balance.id));
    await expect(db().update(s.movements).set({ quantity: "999" }).where(eq(s.movements.id, movement.id))).rejects.toThrow();
    await expect(db().delete(s.movements).where(eq(s.movements.id, movement.id))).rejects.toThrow();
    expect((await db().select().from(s.movements).where(eq(s.movements.id, movement.id)))[0].quantity).toBe("10.0000");
    await post("-2");
    expect((await db().select().from(s.balances).where(eq(s.balances.id, balance.id)))[0].onHand).toBe("8.0000");
    expect(await db().select().from(s.movements).where(eq(s.movements.balanceId, balance.id))).toHaveLength(2);
  }
  expect((await checkConsistency()).every((check) => check.violations === 0)).toBe(true);
});
