import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import { resolveApprovedSpecification } from "@/services/specifications";
import * as s from "@/db/schema";
import { type Actor, authorize } from "@/lib/permissions";
import { amount, quantity, orderSchema } from "@/lib/validation";
import { discountedLineTotal } from "@/lib/money";
import {
  laborAction,
  bindLatestRouting,
  requireRoutingOutput,
} from "@/services/labor";
import { cuttingAction, cuttingCompletion } from "@/services/cutting";
import { outsourcingAction } from "@/services/outsourcing";
import { pricingAction, approveSalePricing } from "@/services/pricing";
import { repairAction } from "@/services/repairs";
import { complianceAction } from "@/services/compliance";
import { procurementAction } from "@/services/procurement";
import {captureOperationDocuments} from "@/services/documents";
import { shippingAction, deliveryCommitted } from "@/services/shipping";
import {
  returnsAction,
  invoiceReturnPosition,
  requireReplacementBranding,
} from "@/services/returns";
import {
  planRolls,
  consumeRolls,
  releaseRolls,
  rollInputSchema,
  receiveRolls,
  activateRollTracking,
  adjustRoll,
  damageRoll,
} from "@/services/fabric-rolls";
import {
  checkBrandingBeforeConfirmation,
  resolveBrandingForManufacturing,
  checkBrandedShipment,
} from "@/services/branding";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const Arithmetic = Decimal.clone({precision:40});
const num = (v: Decimal.Value) => new Arithmetic(v);
export function lineTotal(
  q: Decimal.Value,
  p: Decimal.Value,
  discount: Decimal.Value = "0",
) {
  return discountedLineTotal(q, p, discount);
}
export const actions = [
  "inspectProcurement", "recordSupplierIncident", "recordProcurementExpense",
  "createSafetyStandard", "editSafetyStandard", "archiveSafetyStandard", "createCertification", "editCertification", "reviseCertification", "approveCertification", "revokeCertification",
  "createRepair", "assignRepair", "repairStatus", "requireRepairMaterial", "consumeRepairMaterial", "recordRepairLabor",
  "confirmLegacyShipmentDelivery",
  "createReturn",
  "approveReturn",
  "rejectReturn",
  "cancelReturn",
  "receiveReturn",
  "inspectReturn",
  "closeReturnIntake",
  "dispositionReturnQuarantine",
  "requestReturnSettlement",
  "approveReturnSettlement",
  "rejectReturnSettlement",
  "processReturnSettlement",
  "recordReturnRefund",
  "createDelivery",
  "editDelivery",
  "recordDeliveryPacking",
  "reopenDelivery",
  "dispatchDelivery",
  "cancelDelivery",
  "updateDeliveryStatus",
  "savePricingRule",
  "approvePricingRule",
  "rejectPricingRule",
  "retirePricingRule",
  "createQuotation",
  "editQuotation",
  "approveQuotation",
  "rejectQuotation",
  "convertQuotation",
  "saveSubcontractor",
  "createOutsourcing",
  "editOutsourcing",
  "activateOutsourcing",
  "cancelOutsourcing",
  "outsourcingProgress",
  "issueOutsourcingMaterial",
  "settleOutsourcingMaterial",
  "receiveOutsourcing",
  "recordOutsourcingCost",
  "closeOutsourcing",
  "saveRouting",
  "bindRouting",
  "startOperation",
  "finishOperation",
  "createCutting",
  "completeCutting",
  "cancelCutting",
  "adjust",
  "activateRollTracking",
  "registerRolls",
  "adjustRoll",
  "damageRoll",
  "bom",
  "purchase",
  "orderPurchase",
  "receive",
  "sale",
  "confirmSale",
  "reserveSale",
  "ship",
  "manufacture",
  "bindSpecification",
  "plan",
  "start",
  "record",
  "complete",
  "cancelProduction",
  "invoice",
  "pay",
] as const;
export type BusinessAction = (typeof actions)[number];
const resources: Record<BusinessAction, string> = {
  inspectProcurement: "purchases",
  recordSupplierIncident: "purchases",
  recordProcurementExpense: "procurement.cost",
  createSafetyStandard: "compliance.manage",
  editSafetyStandard: "compliance.manage",
  archiveSafetyStandard: "compliance.manage",
  createCertification: "compliance.manage",
  editCertification: "compliance.manage",
  reviseCertification: "compliance.manage",
  approveCertification: "compliance.manage",
  revokeCertification: "compliance.manage",
  createRepair: "repairs.create",
  assignRepair: "repairs.work",
  repairStatus: "repairs.work",
  requireRepairMaterial: "repairs.work",
  consumeRepairMaterial: "repairs.work",
  recordRepairLabor: "repairs.work",
  confirmLegacyShipmentDelivery: "shipping",
  createReturn: "returns.sales",
  approveReturn: "returns.sales",
  rejectReturn: "returns.sales",
  cancelReturn: "returns.sales",
  receiveReturn: "returns.receive",
  inspectReturn: "returns.inspect",
  closeReturnIntake: "returns.sales",
  dispositionReturnQuarantine: "returns.inspect",
  requestReturnSettlement: "returns.sales",
  approveReturnSettlement: "returns.finance",
  rejectReturnSettlement: "returns.finance",
  processReturnSettlement: "returns.finance",
  recordReturnRefund: "returns.finance",
  createDelivery: "shipping",
  editDelivery: "shipping",
  recordDeliveryPacking: "shipping",
  reopenDelivery: "shipping",
  dispatchDelivery: "shipping",
  cancelDelivery: "shipping",
  updateDeliveryStatus: "shipping",
  savePricingRule: "pricing",
  approvePricingRule: "pricing.approve",
  rejectPricingRule: "pricing.approve",
  retirePricingRule: "pricing.approve",
  createQuotation: "quotations",
  editQuotation: "quotations",
  approveQuotation: "pricing.approve",
  rejectQuotation: "pricing.approve",
  convertQuotation: "quotations",
  saveSubcontractor: "suppliers",
  createOutsourcing: "manufacturing",
  editOutsourcing: "manufacturing",
  activateOutsourcing: "manufacturing",
  cancelOutsourcing: "manufacturing",
  outsourcingProgress: "manufacturing",
  issueOutsourcingMaterial: "inventory",
  settleOutsourcingMaterial: "inventory",
  receiveOutsourcing: "manufacturing",
  recordOutsourcingCost: "manufacturing",
  closeOutsourcing: "manufacturing",
  saveRouting: "manufacturing",
  bindRouting: "manufacturing",
  startOperation: "manufacturing",
  finishOperation: "manufacturing",
  createCutting: "manufacturing",
  completeCutting: "manufacturing",
  cancelCutting: "manufacturing",
  adjust: "inventory",
  activateRollTracking: "inventory",
  registerRolls: "inventory",
  adjustRoll: "inventory",
  damageRoll: "inventory",
  bom: "boms",
  purchase: "purchases",
  orderPurchase: "purchases",
  receive: "purchases",
  sale: "sales",
  confirmSale: "sales",
  reserveSale: "inventory",
  ship: "inventory",
  manufacture: "manufacturing",
  bindSpecification: "manufacturing",
  plan: "manufacturing",
  start: "manufacturing",
  record: "manufacturing",
  complete: "manufacturing",
  cancelProduction: "manufacturing",
  invoice: "invoices",
  pay: "invoices",
};
const idInput = z.object({ id: z.uuid() });
async function balance(
  tx: Tx,
  warehouseId: string,
  itemId: string,
  kind: "material" | "variant",
) {
  const field =
    kind === "material" ? s.balances.materialId : s.balances.variantId;
  await tx
    .insert(s.balances)
    .values({
      warehouseId,
      ...(kind === "material" ? { materialId: itemId } : { variantId: itemId }),
    })
    .onConflictDoNothing();
  const [b] = await tx
    .select()
    .from(s.balances)
    .where(and(eq(s.balances.warehouseId, warehouseId), eq(field, itemId)))
    .for("update");
  if (!b) throw new Error("Stock balance could not be created");
  return b;
}
async function move(
  tx: Tx,
  b: typeof s.balances.$inferSelect,
  q: Decimal.Value,
  r: Decimal.Value,
  reason: string,
  source: string,
  key: string,
  actor: Actor,
) {
  const onHand = num(b.onHand).add(q),
    reserved = num(b.reserved).add(r);
  if (onHand.isNegative() || reserved.isNegative() || reserved.gt(onHand))
    throw new Error(
      "Insufficient available stock. Receive materials or finished goods before proceeding.",
    );
  await tx
    .update(s.balances)
    .set({ onHand: onHand.toFixed(4), reserved: reserved.toFixed(4) })
    .where(eq(s.balances.id, b.id));
  const [movement] = await tx
    .insert(s.movements)
    .values({
      balanceId: b.id,
      quantity: num(q).toFixed(4),
      reservedDelta: num(r).toFixed(4),
      reason,
      source,
      operationKey: key,
      createdBy: actor.id,
    })
    .returning();
  return movement;
}
function number(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
async function syncSale(tx: Tx, orderId: string) {
  const lines = await tx
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.orderId, orderId));
  const status = lines.every((l) => l.shipped === l.quantity)
    ? "Shipped"
    : lines.some((l) => l.shipped > 0)
      ? "Partially Shipped"
      : lines.every((l) => l.reserved === l.quantity)
        ? "Ready for Shipment"
        : "Awaiting Production";
  await tx.update(s.sales).set({ status }).where(eq(s.sales.id, orderId));
}
export async function execute(
  actor: Actor,
  action: BusinessAction,
  input: unknown,
  key: string,
) {
  z.enum(actions).parse(action);
  authorize(actor, resources[action]);
  z.uuid().parse(key);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ action, input }))
    .digest("hex");
  await db().transaction(async (tx) => {
    const [warehouse] = await tx
      .select()
      .from(s.warehouses)
      .orderBy(s.warehouses.id)
      .limit(1)
      .for("update");
    if (!warehouse)
      throw new Error("Run the seed script to create the primary warehouse.");
    const [prior] = await tx
      .select()
      .from(s.operations)
      .where(eq(s.operations.key, key));
    if (prior) {
      if (prior.fingerprint !== fingerprint || prior.actorId !== actor.id)
        throw new Error("Operation key already used for another request.");
      return;
    }
    await tx
      .insert(s.operations)
      .values({ key, fingerprint, actorId: actor.id });
    if (["inspectProcurement","recordSupplierIncident","recordProcurementExpense"].includes(action)) {
      await procurementAction(tx,action,input,{
        actorId:actor.id,
        reject:async (item, quantity, rollId)=>{
          const b=await balance(tx,warehouse.id,item.materialId,"material");
          if(b.rollTracked) {
            if(!rollId) throw new Error("Select the received fabric roll for rejected material.");
            const [roll]=await tx.select().from(s.fabricRolls).where(eq(s.fabricRolls.id,rollId));
            if(!roll || roll.balanceId!==b.id || roll.purchaseReceiptId!==item.receiptId || roll.purchaseOrderItemId!==item.purchaseItemId) throw new Error("The roll must belong to this receipt line.");
            let movementId="";
            await adjustRoll(tx,{rollId,delta:num(quantity).neg().toFixed(4),actorId:actor.id,operationKey:key,reason:"Supplier quality rejection",applyMovement:async (balance,delta)=>{
              const m=await move(tx,balance,delta,0,"Supplier quality rejection","supplier inspection",key+":rejection",actor); movementId=m.id;return m;
            }});
            return movementId;
          }
          if(rollId) throw new Error("This material is not roll tracked.");
          const m=await move(tx,b,num(quantity).neg(),0,"Supplier quality rejection","supplier inspection",key+":rejection",actor);return m.id;
        },
      });
    } else if (["createSafetyStandard","editSafetyStandard","archiveSafetyStandard","createCertification","editCertification","reviseCertification","approveCertification","revokeCertification"].includes(action)) {
      await complianceAction(tx,action,input,actor.id);
    } else if (["createRepair", "assignRepair", "repairStatus", "requireRepairMaterial", "consumeRepairMaterial", "recordRepairLabor"].includes(action)) {
      await repairAction(tx, action, input, {
        actorId: actor.id,
        consume: async (materialId, quantity, rollId) => {
          const b = await balance(tx, warehouse.id, materialId, "material");
          if (b.rollTracked) {
            if (!rollId) throw new Error("Select a fabric roll for roll-tracked material.");
            const [roll] = await tx.select().from(s.fabricRolls).where(eq(s.fabricRolls.id, rollId));
            if (!roll || roll.balanceId !== b.id) throw new Error("The selected roll does not belong to this material.");
            let movementId = "";
            await adjustRoll(tx, { rollId, delta: num(quantity).neg().toFixed(4), actorId: actor.id, operationKey: key, reason: "Repair material consumption", applyMovement: async (current, delta) => {
              const movement = await move(tx, current, delta, 0, "Repair material consumption", "repair", key + ":material", actor);
              movementId = movement.id;
              return movement;
            } });
            return movementId;
          }
          if (rollId) throw new Error("This material is not roll tracked.");
          const movement = await move(tx, b, num(quantity).neg(), 0, "Repair material consumption", "repair", key + ":material", actor);
          return movement.id;
        },
      });
    } else if (
      [
        "confirmLegacyShipmentDelivery",
        "createReturn",
        "approveReturn",
        "rejectReturn",
        "cancelReturn",
        "receiveReturn",
        "inspectReturn",
        "closeReturnIntake",
        "dispositionReturnQuarantine",
        "requestReturnSettlement",
        "approveReturnSettlement",
        "rejectReturnSettlement",
        "processReturnSettlement",
        "recordReturnRefund",
      ].includes(action)
    ) {
      await returnsAction(tx, action, input, {
        actorId: actor.id,
        balance: (variantId) => balance(tx, warehouse.id, variantId, "variant"),
        post: (b, q, reason, suffix) =>
          move(tx, b, q, 0, reason, "RMA", `${key}:${suffix}`, actor),
      });
    } else if (
      [
        "createDelivery",
        "editDelivery",
        "recordDeliveryPacking",
        "reopenDelivery",
        "dispatchDelivery",
        "cancelDelivery",
        "updateDeliveryStatus",
      ].includes(action)
    ) {
      await shippingAction(tx, action, input, {
        actorId: actor.id,
        key,
        warehouseId: warehouse.id,
        balance: (variantId) => balance(tx, warehouse.id, variantId, "variant"),
        post: (b, q, r, reason, suffix) =>
          move(tx, b, q, r, reason, "Delivery", `${key}:${suffix}`, actor),
        syncSale: (id) => syncSale(tx, id),
      });
    } else if (
      [
        "savePricingRule",
        "approvePricingRule",
        "rejectPricingRule",
        "retirePricingRule",
        "createQuotation",
        "editQuotation",
        "approveQuotation",
        "rejectQuotation",
        "convertQuotation",
      ].includes(action)
    ) {
      await pricingAction(tx, action, input, actor);
    } else if (
      [
        "saveSubcontractor",
        "createOutsourcing",
        "editOutsourcing",
        "activateOutsourcing",
        "cancelOutsourcing",
        "outsourcingProgress",
        "issueOutsourcingMaterial",
        "settleOutsourcingMaterial",
        "receiveOutsourcing",
        "recordOutsourcingCost",
        "closeOutsourcing",
      ].includes(action)
    ) {
      await outsourcingAction(tx, action, input, {
        actor,
        key,
        warehouseId: warehouse.id,
        balance: (itemId, kind) => balance(tx, warehouse.id, itemId, kind),
        post: (b, q, r, reason, suffix) =>
          move(tx, b, q, r, reason, "Outsourcing", `${key}:${suffix}`, actor),
      });
    } else if (
      [
        "saveRouting",
        "bindRouting",
        "startOperation",
        "finishOperation",
      ].includes(action)
    ) {
      await laborAction(tx, action, input, actor.id);
    } else if (
      ["createCutting", "completeCutting", "cancelCutting"].includes(action)
    ) {
      await cuttingAction(tx, action, input, actor.id);
    } else if (action === "adjust") {
      const v = z
        .object({
          itemId: z.uuid(),
          kind: z.enum(["material", "variant"]),
          delta: z
            .string()
            .regex(/^-?\d{1,12}(\.\d{1,4})?$/)
            .refine((v) => !num(v).isZero()),
          reason: z.string().min(5).max(500),
        })
        .parse(input);
      if (v.kind === "variant" && !num(v.delta).isInteger())
        throw new Error("Finished goods quantities must be whole units");
      const b = await balance(tx, warehouse.id, v.itemId, v.kind);
      if (v.kind === "material" && b.rollTracked)
        throw new Error(
          "This material uses roll tracking. Adjust an individually identified fabric roll instead.",
        );
      await move(tx, b, v.delta, 0, v.reason, "adjustment", key, actor);
    } else if (
      action === "activateRollTracking" ||
      action === "registerRolls"
    ) {
      const v = z
        .object({
          materialId: z.uuid(),
          rolls: z.array(rollInputSchema).max(1000),
          reason: z.string().trim().min(5).max(500).optional(),
        })
        .parse(input);
      const b = await balance(tx, warehouse.id, v.materialId, "material");
      if (action === "activateRollTracking") {
        await activateRollTracking(tx, {
          balance: b,
          rolls: v.rolls,
          actorId: actor.id,
          operationKey: key,
        });
      } else {
        if (!v.rolls.length)
          throw new Error("Register at least one fabric roll");
        if (!v.reason)
          throw new Error(
            "A receipt reason is required for registering new roll stock",
          );
        const received = v.rolls.reduce(
          (total, roll) => total.add(roll.receivedLength),
          num(0),
        );
        const movement = await move(
          tx,
          b,
          received,
          0,
          v.reason,
          "roll receipt",
          key,
          actor,
        );
        await receiveRolls(tx, {
          balance: b,
          rolls: v.rolls,
          quantity: received.toFixed(4),
          movementId: movement.id,
          actorId: actor.id,
          operationKey: key,
        });
      }
    } else if (action === "adjustRoll" || action === "damageRoll") {
      const common = z.object({
        rollId: z.uuid(),
        reason: z.string().trim().min(5).max(500),
      });
      const v = common.parse(input);
      const context = {
        rollId: v.rollId,
        reason: v.reason,
        actorId: actor.id,
        operationKey: key,
        applyMovement: (b: typeof s.balances.$inferSelect, delta: string) =>
          move(
            tx,
            b,
            delta,
            0,
            v.reason,
            `fabric roll ${v.rollId}`,
            key,
            actor,
          ),
      };
      if (action === "adjustRoll") {
        const { delta } = z
          .object({
            delta: z
              .string()
              .regex(/^-?\d{1,12}(\.\d{1,4})?$/)
              .refine((value) => !num(value).isZero()),
          })
          .parse(input);
        await adjustRoll(tx, { ...context, delta });
      } else {
        const { start, end } = z
          .object({
            start: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
            end: quantity,
          })
          .refine(
            (value) => num(value.end).gt(value.start),
            "Damaged section end must be greater than its start",
          )
          .parse(input);
        await damageRoll(tx, { ...context, start, end });
      }
    } else if (action === "bom") {
      const v = z
        .object({
          variantId: z.uuid(),
          laborCost: amount,
          specificationId: z.uuid().optional().or(z.literal("")),
          items: z.array(z.object({ materialId: z.uuid(), quantity })).min(1),
        })
        .parse(input);
      await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, v.variantId))
        .for("update");
      const existing = await tx
        .select()
        .from(s.boms)
        .where(eq(s.boms.variantId, v.variantId));
      const spec = v.specificationId
        ? await resolveApprovedSpecification(tx, v.variantId, v.specificationId)
        : null;
      const [bom] = await tx
        .insert(s.boms)
        .values({
          variantId: v.variantId,
          laborCost: v.laborCost,
          specificationId: spec?.id,
          version: Math.max(0, ...existing.map((b) => b.version)) + 1,
        })
        .returning();
      await tx
        .insert(s.bomItems)
        .values(v.items.map((i) => ({ ...i, bomId: bom.id })));
    } else if (action === "purchase" || action === "sale") {
      const v = orderSchema.parse(input);
      if (
        action === "sale" &&
        v.lines.some(
          (l) =>
            !num(l.quantity).isInteger() ||
            num(l.quantity).gt(1000000) ||
            num(l.discount).gt(100),
        )
      )
        throw new Error(
          "Sales require whole quantities up to 1,000,000 and discounts between 0 and 100",
        );
      const total = v.lines
        .reduce(
          (a, l) =>
            a.add(
              lineTotal(
                l.quantity,
                l.price,
                action === "sale" ? l.discount : 0,
              ),
            ),
          num(0),
        )
        .toFixed(2);
      if (action === "purchase") {
        const [order] = await tx
          .insert(s.purchases)
          .values({
            number: number("PO"),
            supplierId: v.partyId,
            currency: v.currency,
            expectedDate: v.date,
            total,
          })
          .returning();
        await tx.insert(s.purchaseItems).values(
          v.lines.map((l) => ({
            orderId: order.id,
            materialId: l.itemId,
            quantity: l.quantity,
            price: l.price,
          })),
        );
      } else {
        const [order] = await tx
          .insert(s.sales)
          .values({
            number: number("SO"),
            customerId: v.partyId,
            currency: v.currency,
            deliveryDate: v.date,
            total,
          })
          .returning();
        await tx.insert(s.saleItems).values(
          v.lines.map((l) => ({
            orderId: order.id,
            variantId: l.itemId,
            quantity: Number(l.quantity),
            price: l.price,
            discount: l.discount,
            pricingSnapshot: {
              source: "Manual",
              currency: v.currency,
              price: l.price,
              discount: l.discount,
              quantity: l.quantity,
            },
          })),
        );
      }
    } else if (action === "orderPurchase") {
      const v = idInput.parse(input);
      const [po] = await tx
        .select()
        .from(s.purchases)
        .where(eq(s.purchases.id, v.id));
      if (po?.status !== "Draft")
        throw new Error("Only draft purchase orders can be ordered");
      await tx
        .update(s.purchases)
        .set({ status: "Ordered", orderedAt:new Date() })
        .where(eq(s.purchases.id, v.id));
    } else if (action === "receive") {
      const v = z
        .object({
          id: z.uuid(),
          lines: z
            .array(
              z.object({
                id: z.uuid(),
                quantity,
                rolls: z.array(rollInputSchema).min(1).max(1000).optional(),
              }),
            )
            .min(1)
            .max(1000),
        })
        .parse(input);
      const [po] = await tx
        .select()
        .from(s.purchases)
        .where(eq(s.purchases.id, v.id));
      if (!po || !["Ordered", "Partially Received"].includes(po.status))
        throw new Error("Purchase must be ordered before receiving");
      const [receipt] = await tx
        .insert(s.receipts)
        .values({ orderId: po.id, operationKey: key })
        .returning();
      for (const l of v.lines) {
        const [line] = await tx
          .select()
          .from(s.purchaseItems)
          .where(
            and(
              eq(s.purchaseItems.id, l.id),
              eq(s.purchaseItems.orderId, v.id),
            ),
          );
        if (!line || num(line.received).add(l.quantity).gt(line.quantity))
          throw new Error("Receipt exceeds remaining ordered quantity");
        const b = await balance(tx, warehouse.id, line.materialId, "material");
        const movement = await move(
          tx,
          b,
          l.quantity,
          0,
          "Purchase receipt",
          po.number,
          `${key}:${l.id}`,
          actor,
        );
        await tx.insert(s.purchaseReceiptItems).values({
          receiptId:receipt.id,purchaseItemId:line.id,materialId:line.materialId,movementId:movement.id,
          quantity:l.quantity,unitPrice:po.orderedAt ? line.price : null,currency:po.currency,expectedDate:po.orderedAt ? po.expectedDate || null : null,orderedAt:po.orderedAt,provenance:po.orderedAt ? "Recorded" : "Legacy order",
        }).onConflictDoNothing();
        if (b.rollTracked)
          await receiveRolls(tx, {
            balance: b,
            rolls: l.rolls ?? [],
            quantity: l.quantity,
            movementId: movement.id,
            actorId: actor.id,
            operationKey: `${key}:${l.id}`,
            purchaseReceiptId: receipt.id,
            purchaseOrderItemId: line.id,
            supplierId: po.supplierId,
          });
        else if (l.rolls?.length)
          throw new Error(
            "Enable roll tracking before receiving fabric rolls for this material",
          );
        await tx
          .update(s.purchaseItems)
          .set({ received: num(line.received).add(l.quantity).toFixed(4) })
          .where(eq(s.purchaseItems.id, l.id));
      }
      const lines = await tx
        .select()
        .from(s.purchaseItems)
        .where(eq(s.purchaseItems.orderId, v.id));
      await tx
        .update(s.purchases)
        .set({
          status: lines.every((l) => num(l.received).eq(l.quantity))
            ? "Received"
            : "Partially Received",
        })
        .where(eq(s.purchases.id, v.id));
    } else if (action === "confirmSale") {
      const v = idInput.parse(input);
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (so?.status !== "Draft")
        throw new Error("Only draft sales orders can be confirmed");
      await approveSalePricing(tx, so, actor);
      await requireReplacementBranding(tx, so.id);
      await checkBrandingBeforeConfirmation(tx, so.id);
      await tx
        .update(s.sales)
        .set({ status: "Confirmed" })
        .where(eq(s.sales.id, v.id));
    } else if (action === "reserveSale") {
      const v = idInput.parse(input);
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (
        !so ||
        ["Draft", "Cancelled", "Shipped", "Completed"].includes(so.status)
      )
        throw new Error("Order is not open for reservation");
      const lines = await tx
        .select()
        .from(s.saleItems)
        .where(eq(s.saleItems.orderId, v.id))
        .orderBy(s.saleItems.id);
      for (const line of lines) {
        const b = await balance(tx, warehouse.id, line.variantId, "variant");
        const reserve = Decimal.min(
          num(b.onHand).minus(b.reserved),
          line.quantity - line.shipped - line.reserved,
        );
        if (reserve.gt(0)) {
          await move(
            tx,
            b,
            0,
            reserve,
            "Sales reservation",
            so.number,
            `${key}:${line.id}`,
            actor,
          );
          await tx
            .update(s.saleItems)
            .set({ reserved: line.reserved + reserve.toNumber() })
            .where(eq(s.saleItems.id, line.id));
        }
      }
      await syncSale(tx, so.id);
    } else if (action === "ship") {
      const v = z
        .object({
          id: z.uuid(),
          lines: z
            .array(
              z.object({
                id: z.uuid(),
                quantity: z.coerce.number().int().positive().max(1000000),
              }),
            )
            .min(1)
            .max(100),
        })
        .parse(input);
      if (new Set(v.lines.map((l) => l.id)).size !== v.lines.length)
        throw new Error("Each sales line must appear once per shipment");
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (!so || ["Draft", "Cancelled", "Completed"].includes(so.status))
        throw new Error("Order cannot be shipped");
      const [shipment] = await tx
        .insert(s.shipments)
        .values({ orderId: v.id, operationKey: key })
        .returning();
      for (const l of v.lines) {
        const [line] = await tx
          .select()
          .from(s.saleItems)
          .where(and(eq(s.saleItems.id, l.id), eq(s.saleItems.orderId, v.id)));
        if (!line || l.quantity > line.reserved)
          throw new Error("Shipment exceeds reserved quantity");
        if (l.quantity > line.reserved - (await deliveryCommitted(tx, line.id)))
          throw new Error(
            "Reserved goods are committed to an active picking list; dispatch that delivery instead",
          );
        await checkBrandedShipment(tx, line, l.quantity);
        await move(
          tx,
          await balance(tx, warehouse.id, line.variantId, "variant"),
          -l.quantity,
          -l.quantity,
          "Shipment",
          so.number,
          `${key}:${l.id}`,
          actor,
        );
        await tx
          .update(s.saleItems)
          .set({
            reserved: line.reserved - l.quantity,
            shipped: line.shipped + l.quantity,
          })
          .where(eq(s.saleItems.id, l.id));
        await tx.insert(s.shipmentItems).values({
          shipmentId: shipment.id,
          saleItemId: l.id,
          quantity: l.quantity,
        });
      }
      await syncSale(tx, v.id);
    } else if (action === "bindSpecification") {
      const v = z
        .object({ id: z.uuid(), specificationId: z.uuid() })
        .parse(input);
      const [order] = await tx
        .select()
        .from(s.manufacturing)
        .where(eq(s.manufacturing.id, v.id));
      if (
        !order ||
        order.specificationId ||
        ["Completed", "Cancelled"].includes(order.status)
      )
        throw new Error(
          "Only open legacy orders without a specification can be bound",
        );
      const spec = await resolveApprovedSpecification(
        tx,
        order.variantId,
        v.specificationId,
      );
      const [bom] = await tx
        .select()
        .from(s.boms)
        .where(eq(s.boms.id, order.bomId));
      if (bom.specificationId && bom.specificationId !== spec.id)
        throw new Error("BOM specification differs");
      await tx
        .update(s.manufacturing)
        .set({ specificationId: spec.id })
        .where(eq(s.manufacturing.id, v.id));
    } else if (action === "manufacture") {
      const v = z
        .object({
          bomId: z.uuid(),
          specificationId: z.uuid().optional().or(z.literal("")),
          quantity: z.coerce.number().int().positive().max(1000000),
          brandingVersionId: z.uuid().optional().or(z.literal("")),
          saleItemId: z.uuid().optional().or(z.literal("")),
          dueDate: z.iso.date().optional().or(z.literal("")),
          notes: z.string().max(2000).optional(),
        })
        .parse(input);
      const [bom] = await tx
        .select()
        .from(s.boms)
        .where(eq(s.boms.id, v.bomId));
      if (!bom) throw new Error("BOM not found");
      const branding = await resolveBrandingForManufacturing(
        tx,
        v.saleItemId || undefined,
        v.brandingVersionId || undefined,
      );
      const spec = await resolveApprovedSpecification(
        tx,
        bom.variantId,
        v.specificationId ||
          bom.specificationId ||
          branding?.specificationId ||
          undefined,
      );
      if (branding && branding.specificationId !== spec.id)
        throw new Error(
          "Engineering and approved branding specifications must match",
        );
      if (bom.specificationId && bom.specificationId !== spec.id)
        throw new Error("BOM and manufacturing specification must match");
      if (v.saleItemId) {
        const [l] = await tx
          .select()
          .from(s.saleItems)
          .where(eq(s.saleItems.id, v.saleItemId));
        if (!l || l.variantId !== bom.variantId)
          throw new Error("Sales line does not match this BOM variant");
        if (branding) {
          const [order] = await tx
            .select()
            .from(s.sales)
            .where(eq(s.sales.id, l.orderId));
          if (
            order.status === "Draft" ||
            ["Cancelled", "Shipped", "Completed"].includes(order.status)
          )
            throw new Error(
              "Confirm the branded sales order before manufacturing",
            );
          const existing = await tx
            .select({
              quantity: s.manufacturing.quantity,
              completed: s.manufacturing.completed,
              status: s.manufacturing.status,
            })
            .from(s.manufacturing)
            .where(
              and(
                eq(s.manufacturing.saleItemId, l.id),
                sql`${s.manufacturing.status}<>'Cancelled'`,
              ),
            );
          if (
            existing.reduce(
              (n, o) =>
                n + (o.status === "Completed" ? o.completed : o.quantity),
              0,
            ) +
              v.quantity >
            l.quantity
          )
            throw new Error(
              "Branded production exceeds the sales line quantity",
            );
        }
      }
      const [createdOrder] = await tx
        .insert(s.manufacturing)
        .values({
          number: number("MO"),
          variantId: bom.variantId,
          bomId: bom.id,
          specificationId: spec.id,
          brandingVersionId: branding?.id,
          warehouseId: warehouse.id,
          quantity: v.quantity,
          saleItemId: v.saleItemId || null,
          dueDate: v.dueDate,
          notes: v.notes,
        })
        .returning();
      await bindLatestRouting(tx, createdOrder);
    } else if (
      ["plan", "start", "record", "complete", "cancelProduction"].includes(
        action,
      )
    ) {
      const { id } = idInput.parse(input);
      const [mo] = await tx
        .select()
        .from(s.manufacturing)
        .where(eq(s.manufacturing.id, id));
      if (!mo) throw new Error("Production order not found");
      const external = await tx
        .select()
        .from(s.outsourcingOrders)
        .where(
          and(
            eq(s.outsourcingOrders.manufacturingOrderId, mo.id),
            sql`${s.outsourcingOrders.status}<>'Cancelled'`,
          ),
        );
      if (external.length)
        throw new Error(
          "This manufacturing order is managed through Outsourcing; use its custody and QC workflow",
        );
      if (
        ["plan", "start", "record", "complete"].includes(action) &&
        mo.status !== "Completed" &&
        !mo.specificationId
      )
        throw new Error(
          "Bind an approved technical specification to this legacy order before continuing",
        );
      if (action === "plan") {
        const v = z
          .object({
            rollAllocations: z
              .array(
                z.object({
                  materialId: z.uuid(),
                  rollId: z.uuid(),
                  quantity,
                }),
              )
              .max(1000)
              .optional(),
          })
          .parse(input);
        if (mo.status !== "Draft")
          throw new Error("Only draft production can be planned");
        const items = await tx
          .select()
          .from(s.bomItems)
          .where(eq(s.bomItems.bomId, mo.bomId));
        if (!items.length) throw new Error("BOM has no materials");
        if (
          v.rollAllocations?.some(
            (allocation) =>
              !items.some((item) => item.materialId === allocation.materialId),
          )
        )
          throw new Error(
            "Roll allocations must belong to this production order's BOM materials",
          );
        for (const item of items) {
          const needed = num(item.quantity).mul(mo.quantity);
          const b = await balance(
            tx,
            mo.warehouseId,
            item.materialId,
            "material",
          );
          const movement = await move(
            tx,
            b,
            0,
            needed,
            "Production reservation",
            mo.number,
            `${key}:${item.id}`,
            actor,
          );
          const [reservation] = await tx
            .insert(s.reservations)
            .values({
              orderId: id,
              balanceId: b.id,
              quantity: needed.toFixed(4),
            })
            .returning();
          if (b.rollTracked)
            await planRolls(tx, {
              balance: b,
              reservationId: reservation.id,
              orderId: id,
              quantity: needed.toFixed(4),
              allocations: v.rollAllocations
                ?.filter(
                  (allocation) => allocation.materialId === item.materialId,
                )
                .map(({ rollId, quantity }) => ({ rollId, quantity })),
              actorId: actor.id,
              operationKey: `${key}:${item.id}`,
              movementId: movement.id,
            });
          else if (
            v.rollAllocations?.some(
              (allocation) => allocation.materialId === item.materialId,
            )
          )
            throw new Error(
              "Roll allocations are only supported for roll-tracked materials",
            );
        }
        await tx
          .update(s.manufacturing)
          .set({ status: "Planned" })
          .where(eq(s.manufacturing.id, id));
      } else if (action === "start") {
        if (mo.status !== "Planned")
          throw new Error("Reserve materials before starting production");
        await tx
          .update(s.manufacturing)
          .set({ status: "In Progress" })
          .where(eq(s.manufacturing.id, id));
      } else if (action === "record") {
        await requireRoutingOutput(
          tx,
          mo,
          Number((input as Record<string, unknown>).completed),
        );
        const v = z
          .object({
            completed: z.coerce.number().int().nonnegative(),
            defective: z.coerce.number().int().nonnegative(),
            notes: z.string().max(2000).optional(),
          })
          .parse(input);
        if (
          mo.status !== "In Progress" ||
          v.completed + v.defective !== mo.quantity
        )
          throw new Error(
            "Account for all planned units before quality control",
          );
        await tx
          .update(s.manufacturing)
          .set({ ...v, status: "Quality Control" })
          .where(eq(s.manufacturing.id, id));
      } else if (action === "complete") {
        if (mo.status === "Completed") return;
        await requireRoutingOutput(
          tx,
          mo,
          Number((input as Record<string, unknown>).approved),
        );
        input = await cuttingCompletion(tx, mo.id, input);
        if (mo.status !== "Quality Control")
          throw new Error("Production must pass through quality control");
        const v = z
          .object({
            approved: z.coerce.number().int().nonnegative(),
            brandingCheck: z.enum(["Pass", "Fail"]).optional(),
            qualityResults: z
              .array(
                z.object({
                  check: z.string(),
                  result: z.enum(["Pass", "Fail"]),
                  notes: z.string().max(2000).default(""),
                }),
              )
              .max(100)
              .optional(),
            notes: z.string().max(2000).optional(),
            consumption: z
              .array(
                z.object({
                  reservationId: z.uuid(),
                  quantity: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
                }),
              )
              .optional(),
            rollConsumption: z
              .array(
                z.object({
                  reservationId: z.uuid(),
                  rollId: z.uuid(),
                  quantity: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
                }),
              )
              .max(1000)
              .optional(),
          })
          .parse(input);
        if (v.approved > mo.completed)
          throw new Error("Approved units exceed recorded completed units");
        if (
          mo.brandingVersionId &&
          (!v.brandingCheck || (v.approved > 0 && v.brandingCheck !== "Pass"))
        )
          throw new Error(
            "Verify branding against the fixed approved proof before accepting units",
          );
        const spec = await resolveApprovedSpecification(
          tx,
          mo.variantId,
          mo.specificationId!,
        );
        const checks = spec.document.qualityChecks;
        const qualityResults =
          v.qualityResults ??
          checks.map((check, i) => ({
            check,
            result: z
              .enum(["Pass", "Fail"])
              .parse((input as Record<string, unknown>)[`quality__${i}`]),
            notes: "",
          }));
        if (
          qualityResults.length !== checks.length ||
          new Set(qualityResults.map((r) => r.check)).size !== checks.length ||
          checks.some((c) => !qualityResults.some((r) => r.check === c)) ||
          (v.approved > 0 && qualityResults.some((r) => r.result !== "Pass"))
        )
          throw new Error(
            "Record every specification quality check; all checks must pass to accept units",
          );
        const reserved = await tx
          .select()
          .from(s.reservations)
          .where(eq(s.reservations.orderId, id));
        if (
          v.consumption &&
          (new Set(v.consumption.map((c) => c.reservationId)).size !==
            reserved.length ||
            v.consumption.length !== reserved.length ||
            v.consumption.some(
              (c) => !reserved.some((r) => r.id === c.reservationId),
            ))
        )
          throw new Error(
            "Consumption must account for every reserved material exactly once",
          );
        if (
          v.rollConsumption?.some(
            (entry) =>
              !reserved.some(
                (reservation) => reservation.id === entry.reservationId,
              ),
          )
        )
          throw new Error(
            "Roll consumption must belong to this production order's material reservations",
          );
        for (const r of reserved) {
          const [b] = await tx
            .select()
            .from(s.balances)
            .where(eq(s.balances.id, r.balanceId))
            .for("update");
          const consumed =
            v.consumption?.find((c) => c.reservationId === r.id)?.quantity ??
            r.quantity;
          if (num(consumed).gt(num(b.onHand).minus(b.reserved).add(r.quantity)))
            throw new Error("Actual consumption exceeds available materials");
          const movement = await move(
            tx,
            b,
            num(consumed).neg(),
            num(r.quantity).neg(),
            "Production consumption / release",
            mo.number,
            `${key}:${r.id}`,
            actor,
          );
          if (b.rollTracked)
            await consumeRolls(tx, {
              balance: b,
              reservationId: r.id,
              orderId: id,
              reservedQuantity: r.quantity,
              quantity: consumed,
              consumption: v.rollConsumption
                ?.filter((entry) => entry.reservationId === r.id)
                .map(({ rollId, quantity }) => ({ rollId, quantity })),
              actorId: actor.id,
              operationKey: `${key}:${r.id}`,
              movementId: movement.id,
            });
          else if (
            v.rollConsumption?.some((entry) => entry.reservationId === r.id)
          )
            throw new Error(
              "Roll consumption is only supported for roll-tracked materials",
            );
          await tx
            .update(s.reservations)
            .set({ consumed })
            .where(eq(s.reservations.id, r.id));
        }
        await tx.insert(s.inspections).values({
          orderId: id,
          approved: v.approved,
          rejected: mo.quantity - v.approved,
          notes: v.notes,
          inspectorId: actor.id,
          brandingVersionId: mo.brandingVersionId,
          brandingCheck: mo.brandingVersionId ? v.brandingCheck : null,
          specificationId: spec.id,
          specificationResults: qualityResults,
        });
        if (v.approved > 0)
          await move(
            tx,
            await balance(tx, mo.warehouseId, mo.variantId, "variant"),
            v.approved,
            0,
            "Quality-approved production",
            mo.number,
            `${key}:finished`,
            actor,
          );
        await tx
          .update(s.manufacturing)
          .set({
            status: "Completed",
            completed: v.approved,
            defective: mo.quantity - v.approved,
          })
          .where(eq(s.manufacturing.id, id));
      } else {
        if (!["Draft", "Planned"].includes(mo.status))
          throw new Error("Only draft or planned production can be cancelled");
        const cutting = await tx
          .select()
          .from(s.cuttingBatches)
          .where(eq(s.cuttingBatches.orderId, id));
        if (cutting.some((b) => b.status !== "Cancelled"))
          throw new Error(
            "Cancel planned cutting batches first; manufacturing with completed cutting cannot be cancelled",
          );
        const reserved = await tx
          .select()
          .from(s.reservations)
          .where(eq(s.reservations.orderId, id));
        for (const r of reserved) {
          const [b] = await tx
            .select()
            .from(s.balances)
            .where(eq(s.balances.id, r.balanceId))
            .for("update");
          const movement = await move(
            tx,
            b,
            0,
            num(r.quantity).neg(),
            "Cancelled production release",
            mo.number,
            `${key}:${r.id}`,
            actor,
          );
          if (b.rollTracked)
            await releaseRolls(tx, {
              balance: b,
              reservationId: r.id,
              orderId: id,
              quantity: r.quantity,
              actorId: actor.id,
              operationKey: `${key}:${r.id}`,
              movementId: movement.id,
            });
        }
        await tx
          .update(s.manufacturing)
          .set({ status: "Cancelled" })
          .where(eq(s.manufacturing.id, id));
      }
    } else if (action === "invoice") {
      const v = z
        .object({
          id: z.uuid(),
          dueDate: z.iso.date(),
          taxRate: amount.refine((v) => num(v).lte(100)),
        })
        .parse(input);
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (!so || !["Shipped", "Completed"].includes(so.status))
        throw new Error("Invoice only fully shipped orders");
      const total = num(so.total)
        .mul(num(1).add(num(v.taxRate).div(100)))
        .toDecimalPlaces(2)
        .toFixed(2);
      await tx.insert(s.invoices).values({
        number: number("INV"),
        orderId: v.id,
        dueDate: v.dueDate,
        subtotal: so.total,
        taxRate: v.taxRate,
        total,
        status: num(total).isZero() ? "Paid" : "Unpaid",
      });
      if (num(total).isZero()) {
        await tx
          .update(s.sales)
          .set({ status: "Completed" })
          .where(eq(s.sales.id, v.id));
      }
    } else if (action === "pay") {
      const v = z
        .object({
          id: z.uuid(),
          amount: amount.refine((v) => num(v).gt(0)),
          reference: z.string().min(1).max(200),
        })
        .parse(input);
      const [invoice] = await tx
        .select()
        .from(s.invoices)
        .where(eq(s.invoices.id, v.id))
        .for("update");
      if (!invoice) throw new Error("Invoice not found");
      const paid = num(invoice.paid).add(v.amount);
      const returnPosition = await invoiceReturnPosition(tx, invoice.id);
      if (num(v.amount).gt(returnPosition.due))
        throw new Error("Payment exceeds outstanding balance");
      await tx.insert(s.payments).values({
        invoiceId: v.id,
        amount: v.amount,
        reference: v.reference,
        operationKey: key,
      });
      await tx
        .update(s.invoices)
        .set({
          paid: paid.toFixed(2),
          status: num(v.amount).eq(returnPosition.due)
            ? "Paid"
            : "Partially Paid",
        })
        .where(eq(s.invoices.id, v.id));
      if (num(v.amount).eq(returnPosition.due))
        await tx
          .update(s.sales)
          .set({ status: "Completed" })
          .where(eq(s.sales.id, invoice.orderId));
    }
    await captureOperationDocuments(tx,action,input,key,actor.id);
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action,
      entityId: key,
      details: { operationKey: key },
    });
  });
}
