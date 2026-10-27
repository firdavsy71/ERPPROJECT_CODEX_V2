import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
export const operationNames = [
  "Fabric cutting",
  "Sewing",
  "Overlock stitching",
  "Pocket assembly",
  "Zipper installation",
  "Reflective tape attachment",
  "Button installation",
  "Final assembly",
  "Pressing",
  "Packaging",
  "Inspection",
] as const;
export async function bindLatestRouting(
  tx: Tx,
  order: typeof s.manufacturing.$inferSelect,
) {
  const [variant] = await tx
    .select()
    .from(s.variants)
    .where(eq(s.variants.id, order.variantId));
  const [route] = await tx
    .select()
    .from(s.productionRoutings)
    .where(eq(s.productionRoutings.productId, variant.productId))
    .orderBy(desc(s.productionRoutings.version))
    .limit(1);
  if (route)
    await tx
      .insert(s.orderRoutings)
      .values({ orderId: order.id, routingId: route.id, steps: route.steps });
}
export function operationProgress(
  quantity: number,
  steps: s.RoutingStep[],
  entries: (typeof s.laborEntries.$inferSelect)[],
) {
  let allowed = quantity;
  let ready = true;
  return steps.map((step, index) => {
    const sessions = entries.filter((e) => e.sequence === index);
    const completed = sessions.reduce((n, e) => n + e.completed, 0),
      rejected = sessions.reduce((n, e) => n + e.rejected, 0);
    const remaining = allowed - completed - rejected;
    const row = {
      ...step,
      index,
      allowed,
      completed,
      rejected,
      remaining,
      status: !ready
        ? "Blocked"
        : remaining === 0
          ? "Completed"
          : sessions.some((e) => !e.endedAt)
            ? "In Progress"
            : sessions.length
              ? "Partial"
              : "Pending",
    };
    ready = ready && remaining === 0;
    allowed = ready ? completed : 0;
    return row;
  });
}
export async function requireRoutingOutput(
  tx: Tx,
  order: typeof s.manufacturing.$inferSelect,
  quantity: number,
) {
  const [route] = await tx
    .select()
    .from(s.orderRoutings)
    .where(eq(s.orderRoutings.orderId, order.id));
  if (!route) return;
  const entries = await tx
    .select()
    .from(s.laborEntries)
    .where(eq(s.laborEntries.orderRoutingId, route.id));
  const progress = operationProgress(order.quantity, route.steps, entries);
  if (
    progress.some((p) => p.remaining !== 0) ||
    entries.some((e) => !e.endedAt) ||
    quantity > progress.at(-1)!.completed
  )
    throw new Error(
      "Finish routed operations first; output cannot exceed accepted units from the final operation",
    );
}
export async function laborAction(
  tx: Tx,
  action: string,
  input: unknown,
  actorId: string,
) {
  if (action === "saveRouting") {
    const v = z
      .object({
        productId: z.uuid(),
        steps: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(150),
              minutes: z
                .string()
                .regex(/^\d{1,6}(\.\d{1,4})?$/)
                .refine((v) => Number(v) > 0),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input);
    if (
      new Set(v.steps.map((s) => s.name.toLowerCase())).size !== v.steps.length
    )
      throw new Error("Operation names must be unique within a routing");
    const [p] = await tx
      .select()
      .from(s.products)
      .where(eq(s.products.id, v.productId));
    if (!p?.active) throw new Error("Select an active product");
    const routes = await tx
      .select()
      .from(s.productionRoutings)
      .where(eq(s.productionRoutings.productId, v.productId));
    await tx.insert(s.productionRoutings).values({
      ...v,
      version: Math.max(0, ...routes.map((r) => r.version)) + 1,
      createdBy: actorId,
    });
    return;
  }
  if (action === "bindRouting") {
    const { id } = z.object({ id: z.uuid() }).parse(input);
    const [order] = await tx
      .select()
      .from(s.manufacturing)
      .where(eq(s.manufacturing.id, id));
    if (!order || !["Draft", "Planned"].includes(order.status))
      throw new Error("Routing can only be bound before production starts");
    if (
      (
        await tx
          .select()
          .from(s.orderRoutings)
          .where(eq(s.orderRoutings.orderId, id))
      ).length
    )
      throw new Error("Manufacturing routing is already fixed");
    await bindLatestRouting(tx, order);
    if (
      !(
        await tx
          .select()
          .from(s.orderRoutings)
          .where(eq(s.orderRoutings.orderId, id))
      ).length
    )
      throw new Error("Create a product routing first");
    return;
  }
  const v = z
    .object({
      id: z.uuid(),
      sequence: z.coerce.number().int().nonnegative().max(99),
    })
    .parse(input);
  const [route] = await tx
    .select()
    .from(s.orderRoutings)
    .where(eq(s.orderRoutings.orderId, v.id));
  if (!route) throw new Error("Manufacturing routing not found");
  const [order] = await tx
    .select()
    .from(s.manufacturing)
    .where(eq(s.manufacturing.id, v.id));
  if (
    (
      await tx
        .select()
        .from(s.outsourcingOrders)
        .where(
          and(
            eq(s.outsourcingOrders.manufacturingOrderId, v.id),
            eq(s.outsourcingOrders.status, "Active"),
          ),
        )
    ).length
  )
    throw new Error(
      "Outsourced production uses subcontractor progress and receipt inspection",
    );
  if (order.status !== "In Progress")
    throw new Error("Start manufacturing before recording operations");
  const entries = await tx
    .select()
    .from(s.laborEntries)
    .where(eq(s.laborEntries.orderRoutingId, route.id));
  const progress = operationProgress(order.quantity, route.steps, entries);
  const step = progress[v.sequence];
  if (
    !step ||
    step.remaining <= 0 ||
    (v.sequence > 0 && progress[v.sequence - 1].remaining !== 0)
  )
    throw new Error(
      "Operation is complete or its predecessor has not finished",
    );
  if (action === "startOperation") {
    const { employeeId } = z.object({ employeeId: z.uuid() }).parse(input);
    const [employee] = await tx
      .select()
      .from(s.employees)
      .where(eq(s.employees.id, employeeId));
    if (!employee?.active) throw new Error("Choose an active employee");
    if (entries.some((e) => e.sequence === v.sequence && !e.endedAt))
      throw new Error("Operation already has an active session");
    await tx.insert(s.laborEntries).values({
      orderRoutingId: route.id,
      sequence: v.sequence,
      employeeId,
      startedAt: new Date(),
      createdBy: actorId,
    });
  } else {
    const result = z
      .object({
        completed: z.coerce.number().int().nonnegative(),
        rejected: z.coerce.number().int().nonnegative(),
        notes: z.string().max(2000).default(""),
      })
      .parse(input);
    if (result.completed + result.rejected > step.remaining)
      throw new Error(
        "Completed and rejected units exceed the operation's remaining applicable quantity",
      );
    const active = entries.find((e) => e.sequence === v.sequence && !e.endedAt);
    if (!active) throw new Error("Start an employee session first");
    await tx
      .update(s.laborEntries)
      .set({ ...result, endedAt: new Date() })
      .where(and(eq(s.laborEntries.id, active.id)));
  }
}
