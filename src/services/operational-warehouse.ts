import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** Shared lock order for operational writes and approved branding revisions. */
export async function lockOperationalWarehouse(tx: Tx) {
  const [company] = await tx
    .select({ primaryWarehouseId: s.settings.primaryWarehouseId })
    .from(s.settings)
    .limit(1)
    .for("share");
  if (!company?.primaryWarehouseId) {
    const existing = await tx.select({ id: s.warehouses.id }).from(s.warehouses).limit(2);
    if (existing.length > 1)
      throw new Error("Configure the primary operational warehouse in company settings before posting operations.");
  }
  const [warehouse] = await tx
    .select()
    .from(s.warehouses)
    .where(company?.primaryWarehouseId ? eq(s.warehouses.id, company.primaryWarehouseId) : undefined)
    .orderBy(s.warehouses.id)
    .limit(1)
    .for("update");
  if (!warehouse)
    throw new Error("Run the seed script to create the primary warehouse.");
  return warehouse;
}
