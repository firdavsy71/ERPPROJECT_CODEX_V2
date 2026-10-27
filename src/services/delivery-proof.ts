import { createHash, randomUUID } from "node:crypto";
import { put, get, del } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { authorize, type Actor } from "@/lib/permissions";
import { validateAttachment } from "@/services/specifications";
import type { BrandingStorage } from "@/services/branding-storage";
function token() {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error(
      "Connect a private Vercel Blob store and configure BLOB_READ_WRITE_TOKEN to store delivery proof",
    );
  return process.env.BLOB_READ_WRITE_TOKEN;
}
function path(pathname: string) {
  if (!/^delivery\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(pathname))
    throw new Error("Invalid delivery proof path");
}
export const deliveryStorage: BrandingStorage = {
  async put(pathname, bytes, mime) {
    path(pathname);
    await put(pathname, bytes, {
      token: token(),
      access: "private",
      allowOverwrite: false,
      addRandomSuffix: false,
      contentType: mime,
    });
  },
  async read(pathname) {
    path(pathname);
    const blob = await get(pathname, {
      token: token(),
      access: "private",
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200 || blob.blob.size > 2097152)
      throw new Error("Private proof file is unavailable");
    const reader = blob.stream.getReader();
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 2097152) {
        await reader.cancel();
        throw new Error("Proof exceeds size limit");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  },
  async remove(pathname) {
    path(pathname);
    await del(pathname, { token: token() });
  },
};
export async function uploadDeliveryProof(
  actor: Actor,
  id: string,
  file: { name: string; mime: string; data: Buffer },
  note: string,
  storage: BrandingStorage = deliveryStorage,
) {
  authorize(actor, "shipping");
  z.uuid().parse(id);
  validateAttachment(file);
  z.string().trim().min(3).max(2000).parse(note);
  const [d] = await db()
    .select()
    .from(s.deliveryOrders)
    .where(eq(s.deliveryOrders.id, id));
  if (!d?.shipmentId)
    throw new Error("Proof can be attached only to a dispatched shipment");
  const pathname = `delivery/${id}/${randomUUID()}`;
  await storage.put(pathname, file.data, file.mime);
  try {
    return await db().transaction(async (tx) => {
      await tx
        .select()
        .from(s.warehouses)
        .orderBy(s.warehouses.id)
        .limit(1)
        .for("update");
      const [current] = await tx
        .select()
        .from(s.deliveryOrders)
        .where(eq(s.deliveryOrders.id, id))
        .for("update");
      if (!current?.shipmentId) throw new Error("Shipment is not dispatched");
      const files = await tx
        .select()
        .from(s.deliveryProofs)
        .where(eq(s.deliveryProofs.deliveryId, id));
      if (files.length >= 12)
        throw new Error("Maximum 12 proof files per delivery");
      const sha256 = createHash("sha256").update(file.data).digest("hex");
      if (files.some((f) => f.sha256 === sha256))
        throw new Error("This proof file is already attached");
      const [row] = await tx
        .insert(s.deliveryProofs)
        .values({
          deliveryId: id,
          pathname,
          name: file.name,
          mime: file.mime,
          bytes: file.data.length,
          sha256,
          note,
          createdBy: actor.id,
        })
        .returning();
      await tx
        .insert(s.deliveryEvents)
        .values({
          deliveryId: id,
          status: current.status,
          notes: `Proof attached: ${file.name}. ${note}`,
          createdBy: actor.id,
        });
      await tx
        .insert(s.audit)
        .values({
          actorId: actor.id,
          action: "delivery-proof-upload",
          entityId: row.id,
          details: { deliveryId: id },
        });
      return row.id;
    });
  } catch (error) {
    try {
      await storage.remove(pathname);
    } catch {
      throw new Error(
        "Upload was not recorded; storage cleanup failed and requires administrator review",
      );
    }
    throw error;
  }
}
export async function readDeliveryProof(
  actor: Actor,
  id: string,
  fileId: string,
  storage: BrandingStorage = deliveryStorage,
) {
  authorize(actor, "shipping.read");
  z.uuid().parse(id);
  z.uuid().parse(fileId);
  const [file] = await db()
    .select()
    .from(s.deliveryProofs)
    .where(
      and(eq(s.deliveryProofs.id, fileId), eq(s.deliveryProofs.deliveryId, id)),
    );
  if (!file) throw new Error("File not found");
  const bytes = await storage.read(file.pathname);
  if (
    bytes.length !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error("Stored proof failed integrity verification");
  return { file, bytes };
}
