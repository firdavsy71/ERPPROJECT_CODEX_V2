import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
if (
  process.env.NODE_ENV === "production" ||
  (process.env.DATABASE_URL && process.env.SEED_DEMO_DATA !== "1")
)
  throw new Error(
    "Demo seed is development-only. For a development Neon branch explicitly set SEED_DEMO_DATA=1. Use db:bootstrap for production.",
  );
const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = z.string().min(12).parse(process.env.ADMIN_PASSWORD);
await db().transaction(async (tx) => {
  await tx
    .insert(s.users)
    .values({
      name: "Workspace administrator",
      email,
      passwordHash: await hash(password, 12),
      role: "admin",
    })
    .onConflictDoNothing();
  await tx
    .insert(s.warehouses)
    .values({ name: "Main warehouse" })
    .onConflictDoNothing();
  await tx.insert(s.settings).values({ id: 1 }).onConflictDoNothing();
  const [user] = await tx
    .select()
    .from(s.users)
    .where(eq(s.users.email, email));
  const [warehouse] = await tx
    .select()
    .from(s.warehouses)
    .where(eq(s.warehouses.name, "Main warehouse"));
  const catalog = [
    ["Industrial Work Jacket", "JKT", "Work jackets", "185000"],
    ["Industrial Work Trousers", "TRS", "Trousers", "145000"],
    ["Protective Coverall", "CVR", "Coveralls", "275000"],
    ["Hi-Vis Safety Jacket", "HVJ", "High visibility", "210000"],
    ["Hi-Vis Trousers", "HVT", "High visibility", "165000"],
    ["Winter Work Parka", "PRK", "Winter workwear", "425000"],
    ["Safety Vest", "VST", "High visibility", "65000"],
    ["Industrial Uniform", "UNI", "Uniforms", "320000"],
    ["Corporate Work Shirt", "SHT", "Uniforms", "115000"],
    ["Two-Piece Workwear Set", "SET", "Workwear sets", "395000"],
  ];
  for (const [name, sku, category, price] of catalog) {
    await tx
      .insert(s.categories)
      .values({ name: category })
      .onConflictDoNothing();
    const [c] = await tx
      .select()
      .from(s.categories)
      .where(eq(s.categories.name, category));
    await tx
      .insert(s.products)
      .values({
        name,
        sku,
        categoryId: c.id,
        description:
          "Development catalog sample. Edit specifications before operational use.",
      })
      .onConflictDoNothing();
    const [p] = await tx
      .select()
      .from(s.products)
      .where(eq(s.products.sku, sku));
    for (const size of ["M", "L", "XL"])
      await tx
        .insert(s.variants)
        .values({
          productId: p.id,
          sku: `${sku}-NAV-${size}`,
          size,
          color: "Navy",
          fabric: "Polycotton",
          price,
        })
        .onConflictDoNothing();
  }
  for (const [name, sku, unit, price, minimum] of [
    ["Polycotton fabric", "FAB-PC", "Meters", "28000", "100"],
    ["Reflective tape", "TAPE", "Meters", "4500", "50"],
    ["Heavy-duty zipper", "ZIP", "Pieces", "3500", "50"],
    ["Sewing thread", "THR", "Rolls", "15000", "10"],
    ["Woven label", "LBL", "Pieces", "500", "100"],
  ]) {
    await tx
      .insert(s.materials)
      .values({
        name,
        sku,
        unit,
        price,
        minimum,
        category: unit === "Meters" ? "Fabric & tape" : "Accessories",
      })
      .onConflictDoNothing();
  }
  if (
    !(
      await tx
        .select()
        .from(s.customers)
        .where(eq(s.customers.name, "Industrial Solutions LLC"))
    ).length
  )
    await tx
      .insert(s.customers)
      .values({
        name: "Industrial Solutions LLC",
        contact: "Development sample",
        email: "purchasing@example.com",
      });
  if (
    !(
      await tx
        .select()
        .from(s.suppliers)
        .where(eq(s.suppliers.name, "Textile Supply Co."))
    ).length
  )
    await tx
      .insert(s.suppliers)
      .values({ name: "Textile Supply Co.", email: "orders@example.com" });
  // Idempotent seed inventory uses a unique operation key and a real ledger entry.
  const mats = await tx.select().from(s.materials);
  for (const m of mats) {
    await tx
      .insert(s.balances)
      .values({ warehouseId: warehouse.id, materialId: m.id })
      .onConflictDoNothing();
    const [b] = await tx
      .select()
      .from(s.balances)
      .where(eq(s.balances.materialId, m.id));
    const inserted = await tx
      .insert(s.movements)
      .values({
        balanceId: b.id,
        quantity: "1000",
        reservedDelta: "0",
        source: "Development seed",
        reason: "Opening development balance",
        operationKey: `seed:${m.id}`,
        createdBy: user.id,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length)
      await tx
        .update(s.balances)
        .set({ onHand: "1000" })
        .where(eq(s.balances.id, b.id));
  }
  const [v] = await tx
    .select()
    .from(s.variants)
    .where(eq(s.variants.sku, "JKT-NAV-L"));
  const [bom] = await tx
    .insert(s.boms)
    .values({ variantId: v.id, version: 1, laborCost: "30000" })
    .onConflictDoNothing()
    .returning();
  if (bom) {
    for (const [sku, quantity] of [
      ["FAB-PC", "2.5"],
      ["TAPE", "1.8"],
      ["ZIP", "1"],
      ["THR", "0.1"],
      ["LBL", "2"],
    ])
      await tx
        .insert(s.bomItems)
        .values({
          bomId: bom.id,
          materialId: mats.find((m) => m.sku === sku)!.id,
          quantity,
        });
  }
});
console.log(
  "Development seed complete. Credentials are read from environment only.",
);
await localClient()?.close();
process.exit(0);
