import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { db } from "@/db";
import * as s from "@/db/schema";
import { createHash } from "node:crypto";
import sharp from "sharp";
function validOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const protocol = request.headers.get("x-forwarded-proto")
      ? `${request.headers.get("x-forwarded-proto")}:`
      : new URL(request.url).protocol;
    return (
      ["http:", "https:"].includes(origin.protocol) &&
      origin.protocol === protocol &&
      origin.host === (request.headers.get("host") ?? new URL(request.url).host)
    );
  } catch {
    return false;
  }
}
export async function POST(request: Request) {
  const actor = await currentActor();
  if (!actor)
    return Response.json({ message: "Sign in required" }, { status: 401 });
  if (!can(actor.role, "settings") || !validOrigin(request))
    return Response.json({ message: "Permission denied" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 700000)
    return Response.json(
      { message: "Maximum logo size is 512 KiB" },
      { status: 413 },
    );
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size === 0 ||
      file.size > 524288
    )
      throw new Error("Choose a PNG or JPEG logo up to 512 KiB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (
      !(file.type === "image/png" && png) &&
      !(file.type === "image/jpeg" && jpeg)
    )
      throw new Error("Invalid image data.");
    const data = await sharp(bytes, { limitInputPixels: 4000000 })
      .rotate()
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    if (data.length > 524288)
      throw new Error("Processed image exceeds 512 KiB.");
    await db().transaction(async (tx) => {
      const values = {
        name: file.name.slice(0, 200),
        mime: "image/png",
        data: data.toString("base64"),
        sha256: createHash("sha256").update(data).digest("hex"),
        updatedBy: actor.id,
        updatedAt: new Date(),
      };
      await tx
        .insert(s.companyLogo)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: s.companyLogo.id, set: values });
      await tx
        .insert(s.audit)
        .values({ actorId: actor.id, action: "company.logo", entityId: "1" });
    });
    return Response.json({ message: "Company logo saved." });
  } catch {
    return Response.json(
      {
        message:
          "Unable to process logo; use a valid PNG or JPEG up to 512 KiB.",
      },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  const actor = await currentActor();
  if (!actor)
    return Response.json({ message: "Sign in required" }, { status: 401 });
  if (!can(actor.role, "settings") || !validOrigin(request))
    return Response.json({ message: "Permission denied" }, { status: 403 });
  await db().transaction(async (tx) => {
    await tx.delete(s.companyLogo);
    await tx
      .insert(s.audit)
      .values({
        actorId: actor.id,
        action: "company.logo.remove",
        entityId: "1",
      });
  });
  return Response.json({
    message: "Company logo removed from future documents.",
  });
}
