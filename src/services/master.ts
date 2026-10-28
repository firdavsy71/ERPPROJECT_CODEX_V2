import { z } from "zod";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { type Actor, authorize } from "@/lib/permissions";
import { amount } from "@/lib/validation";
const name = z.string().trim().min(1).max(200);
const optional = z.string().max(2000).default("");
const email = z.union([z.email(), z.literal("")]).default("");
const contact = {
  name,
  contact: optional,
  email,
  phone: optional,
  address: optional,
  notes: optional,
};
const schemas = {
  products: z.object({ name, sku: name, description: optional }),
  variants: z.object({
    productId: z.uuid(),
    sku: name,
    size: name,
    color: name,
    fabric: optional,
    cost: amount,
    price: amount,
  }),
  customers: z.object({ ...contact, taxId: optional }),
  suppliers: z.object(contact),
  employees: z.object({
    name,
    position: optional,
    department: optional,
    email,
    phone: optional,
  }),
  materials: z.object({
    name,
    sku: name,
    category: name,
    unit: z.enum(["Meters", "Pieces", "Kilograms", "Rolls", "Packs"]),
    price: amount,
    minimum: z.string().regex(/^\d+(\.\d{1,4})?$/),
  }),
  users: z.object({
    name,
    email: z.email().transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(200),
    role: z.enum(["admin", "production", "sales", "inventory", "viewer"]),
  }),
  settings: z.object({
    name,
    currency: z.enum(["UZS", "USD"]),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
    taxRate: amount.refine((v) => Number(v) <= 100),
    address: optional,
    email,
    phone: optional,
    taxId: optional,
    registrationNumber: optional,
    bankDetails: optional,
  }),
};
export type MasterModule = keyof typeof schemas;
export async function saveMaster(
  actor: Actor,
  module: MasterModule,
  input: unknown,
  id?: string,
) {
  authorize(actor, module === "variants" ? "products" : module);
  if (id) z.uuid().parse(id);
  const parsed = schemas[module].parse(input);
  await db().transaction(async (tx) => {
    if (module === "users") {
      const v = schemas.users.parse(input);
      if (id)
        throw new Error("Use activate/deactivate to manage existing users");
      await tx.insert(s.users).values({
        name: v.name,
        email: v.email,
        role: v.role,
        passwordHash: await hash(v.password, 12),
      });
    } else if (module === "settings") {
      const v = schemas.settings.parse(input);
      await tx
        .insert(s.settings)
        .values({ id: 1, ...v })
        .onConflictDoUpdate({ target: s.settings.id, set: v });
    } else {
      // Each branch retains Drizzle's field/column types rather than allowing arbitrary client columns.
      if (module === "products") {
        const v = schemas.products.parse(input);
        if (id) await tx.update(s.products).set(v).where(eq(s.products.id, id));
        else await tx.insert(s.products).values(v);
      }
      if (module === "variants") {
        const v = schemas.variants.parse(input);
        const [previous] = id
          ? await tx
              .select()
              .from(s.variants)
              .where(eq(s.variants.id, id))
              .for("update")
          : [];
        const [saved] = id
          ? await tx
              .update(s.variants)
              .set(v)
              .where(eq(s.variants.id, id))
              .returning()
          : await tx.insert(s.variants).values(v).returning();
        if (saved && previous?.price !== saved.price) {
          const [settings] = await tx.select().from(s.settings);
          await tx.insert(s.audit).values({
            actorId: actor.id,
            action: "catalog-price-change",
            entityId: saved.id,
            details: {
              sku: saved.sku,
              before: previous?.price ?? null,
              after: saved.price,
              currency: settings?.currency ?? "UZS",
            },
          });
        }
      }
      if (module === "customers") {
        const v = schemas.customers.parse(input);
        if (id)
          await tx.update(s.customers).set(v).where(eq(s.customers.id, id));
        else await tx.insert(s.customers).values(v);
      }
      if (module === "suppliers") {
        const v = schemas.suppliers.parse(input);
        if (id)
          await tx.update(s.suppliers).set(v).where(eq(s.suppliers.id, id));
        else await tx.insert(s.suppliers).values(v);
      }
      if (module === "materials") {
        const v = schemas.materials.parse(input);
        if (id)
          await tx.update(s.materials).set(v).where(eq(s.materials.id, id));
        else await tx.insert(s.materials).values(v);
      }
      if (module === "employees") {
        const v = schemas.employees.parse(input);
        if (id)
          await tx.update(s.employees).set(v).where(eq(s.employees.id, id));
        else await tx.insert(s.employees).values(v);
      }
    }
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action: `save:${module}`,
      entityId: id ?? module,
      details: {
        fields: Object.keys(parsed).filter((k) => k !== "password"),
      },
    });
  });
}
export async function archiveMaster(actor: Actor, module: string, id: string) {
  authorize(actor, module);
  z.uuid().parse(id);
  const table = (
    {
      products: s.products,
      materials: s.materials,
      customers: s.customers,
      suppliers: s.suppliers,
      employees: s.employees,
      users: s.users,
    } as const
  )[module as "products"];
  if (!table) throw new Error("This record cannot be archived");
  if (module === "users" && id === actor.id)
    throw new Error("You cannot deactivate yourself");
  await db().transaction(async (tx) => {
    await tx.update(table).set({ active: false }).where(eq(table.id, id));
    await tx
      .insert(s.audit)
      .values({ actorId: actor.id, action: `archive:${module}`, entityId: id });
  });
}
