import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
export const repairActivities = [
  "Trouser length adjustment",
  "Sleeve length adjustment",
  "Zipper replacement",
  "Reflective tape replacement",
  "Seam repair",
  "Button replacement",
  "Logo or patch replacement",
] as const;
const note = z.string().trim().min(1).max(2000);
const id = z.uuid();
const quantity = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,4})?$/)
  .refine((v) => new Decimal(v).gt(0));
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
type Context = {
  actorId: string;
  consume: (
    materialId: string,
    quantity: string,
    rollId?: string,
  ) => Promise<string>;
};

export async function repairAction(
  tx: Tx,
  action: string,
  input: unknown,
  c: Context,
) {
  if (action === "createRepair") {
    const v = z
      .object({
        customerId: id,
        variantId: id.optional().or(z.literal("")),
        productDescription: note,
        activity: z.enum(repairActivities),
        instructions: note,
        employeeId: id.optional().or(z.literal("")),
        estimatedDate: z.iso.date().optional().or(z.literal("")),
        cost: money,
        currency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/),
      })
      .parse(input);
    const [customer] = await tx
      .select()
      .from(s.customers)
      .where(eq(s.customers.id, v.customerId));
    if (!customer?.active) throw new Error("Select an active customer.");
    if (
      v.variantId &&
      !(
        await tx.select().from(s.variants).where(eq(s.variants.id, v.variantId))
      )[0]
    )
      throw new Error("Product variant not found.");
    if (
      v.employeeId &&
      !(
        await tx
          .select()
          .from(s.employees)
          .where(eq(s.employees.id, v.employeeId))
      )[0]?.active
    )
      throw new Error("Select an active employee.");
    const [order] = await tx
      .insert(s.repairOrders)
      .values({
        number: `REP-${randomUUID().slice(0, 8).toUpperCase()}`,
        customerId: v.customerId,
        variantId: v.variantId || null,
        productDescription: v.productDescription,
        activity: v.activity,
        instructions: v.instructions,
        employeeId: v.employeeId || null,
        estimatedDate: v.estimatedDate || null,
        cost: v.cost,
        currency: v.currency,
        createdBy: c.actorId,
      })
      .returning();
    await tx
      .insert(s.repairEvents)
      .values({
        repairId: order.id,
        event: "Received",
        notes: v.instructions,
        actorId: c.actorId,
      });
    return;
  }
  const { id: repairId } = z.object({ id }).parse(input);
  const [order] = await tx
    .select()
    .from(s.repairOrders)
    .where(eq(s.repairOrders.id, repairId))
    .for("update");
  if (!order) throw new Error("Repair order not found.");
  if (["Returned", "Cancelled"].includes(order.status))
    throw new Error("This repair order is closed.");
  if (action === "repairStatus") {
    const v = z
      .object({
        status: z.enum([
          "Diagnosed",
          "Awaiting Materials",
          "In Progress",
          "Quality Check",
          "Completed",
          "Returned",
          "Cancelled",
        ]),
        notes: note,
      })
      .parse(input);
    const allowed: Record<string, string[]> = {
      Received: ["Diagnosed", "Cancelled"],
      Diagnosed: ["Awaiting Materials", "In Progress", "Cancelled"],
      "Awaiting Materials": ["In Progress", "Cancelled"],
      "In Progress": ["Awaiting Materials", "Quality Check", "Cancelled"],
      "Quality Check": ["In Progress", "Completed"],
      Completed: ["Returned"],
    };
    if (!allowed[order.status]?.includes(v.status))
      throw new Error("Invalid repair status transition.");
    if (v.status === "In Progress" && !order.employeeId)
      throw new Error("Assign an employee before work begins.");
    await tx
      .update(s.repairOrders)
      .set({
        status: v.status,
        ...(v.status === "Completed" ? { completionNotes: v.notes } : {}),
      })
      .where(eq(s.repairOrders.id, repairId));
    await tx
      .insert(s.repairEvents)
      .values({
        repairId,
        event: v.status,
        notes: v.notes,
        actorId: c.actorId,
      });
  } else if (action === "assignRepair") {
    const v = z
      .object({
        employeeId: id,
        estimatedDate: z.iso.date().optional().or(z.literal("")),
        cost: money,
        notes: note,
      })
      .parse(input);
    if (["Completed"].includes(order.status))
      throw new Error("Completed repairs cannot be changed.");
    const [employee] = await tx
      .select()
      .from(s.employees)
      .where(eq(s.employees.id, v.employeeId));
    if (!employee?.active) throw new Error("Select an active employee.");
    await tx
      .update(s.repairOrders)
      .set({
        employeeId: v.employeeId,
        estimatedDate: v.estimatedDate || null,
        cost: v.cost,
      })
      .where(eq(s.repairOrders.id, repairId));
    await tx
      .insert(s.repairEvents)
      .values({
        repairId,
        event: "Assignment / estimate",
        notes: v.notes,
        actorId: c.actorId,
      });
  } else if (action === "requireRepairMaterial") {
    const v = z.object({ materialId: id, quantity, notes: note }).parse(input);
    if (
      !["Received", "Diagnosed", "Awaiting Materials", "In Progress"].includes(
        order.status,
      )
    )
      throw new Error("Requirements cannot be added at this stage.");
    const [material] = await tx
      .select()
      .from(s.materials)
      .where(eq(s.materials.id, v.materialId));
    if (!material?.active) throw new Error("Select an active material.");
    await tx
      .insert(s.repairRequirements)
      .values({
        repairId,
        materialId: v.materialId,
        quantity: v.quantity,
        notes: v.notes,
      });
    await tx
      .insert(s.repairEvents)
      .values({
        repairId,
        event: "Material requirement",
        notes: v.notes,
        actorId: c.actorId,
      });
  } else if (action === "consumeRepairMaterial") {
    const v = z
      .object({
        materialId: id,
        quantity,
        rollId: id.optional().or(z.literal("")),
        notes: note,
      })
      .parse(input);
    if (order.status !== "In Progress")
      throw new Error(
        "Materials can only be consumed while work is in progress.",
      );
    const movementId = await c.consume(
      v.materialId,
      v.quantity,
      v.rollId || undefined,
    );
    await tx
      .insert(s.repairMaterialUsage)
      .values({
        repairId,
        materialId: v.materialId,
        rollId: v.rollId || null,
        quantity: v.quantity,
        movementId,
        createdBy: c.actorId,
      });
    await tx
      .insert(s.repairEvents)
      .values({
        repairId,
        event: "Material consumed",
        notes: v.notes,
        actorId: c.actorId,
      });
  } else if (action === "recordRepairLabor") {
    const v = z
      .object({
        employeeId: id,
        minutes: z.coerce.number().int().positive().max(100000),
        notes: note,
      })
      .parse(input);
    if (order.status !== "In Progress")
      throw new Error("Labor can only be recorded while work is in progress.");
    const [employee] = await tx
      .select()
      .from(s.employees)
      .where(eq(s.employees.id, v.employeeId));
    if (!employee?.active) throw new Error("Select an active employee.");
    await tx
      .insert(s.repairLabor)
      .values({
        repairId,
        employeeId: v.employeeId,
        minutes: v.minutes,
        notes: v.notes,
        createdBy: c.actorId,
      });
    await tx
      .insert(s.repairEvents)
      .values({
        repairId,
        event: "Labor recorded",
        notes: v.notes,
        actorId: c.actorId,
      });
  } else throw new Error("Unknown repair action.");
}
