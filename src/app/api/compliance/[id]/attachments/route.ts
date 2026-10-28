import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { uploadComplianceEvidence } from "@/services/compliance";
import { z } from "zod";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor();
  if (!actor)
    return Response.json({ message: "Sign in required" }, { status: 401 });
  if (!can(actor.role, "compliance.manage"))
    return Response.json({ message: "Permission denied" }, { status: 403 });
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const protocol = request.headers.get("x-forwarded-proto")
      ? `${request.headers.get("x-forwarded-proto")}:`
      : new URL(request.url).protocol;
    sameOrigin =
      ["http:", "https:"].includes(origin.protocol) &&
      origin.protocol === protocol &&
      origin.host ===
        (request.headers.get("host") ?? new URL(request.url).host);
  } catch {}
  if (!sameOrigin)
    return Response.json({ message: "Invalid origin" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 2200000)
    return Response.json(
      { message: "Maximum file size is 2 MiB" },
      { status: 413 },
    );
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 2097152)
      throw new Error("Upload one file up to 2 MiB.");
    await uploadComplianceEvidence(
      actor,
      id,
      {
        name: file.name,
        mime: file.type,
        data: Buffer.from(await file.arrayBuffer()),
      },
      String(form.get("kind") ?? ""),
      String(form.get("materialId") ?? ""),
      String(form.get("supplierId") ?? ""),
    );
    return Response.json({ message: "Evidence saved" });
  } catch (e) {
    return Response.json(
      {
        message:
          e instanceof Error && !("cause" in e) && !("query" in e)
            ? e.message
            : "Unable to upload evidence",
      },
      { status: 400 },
    );
  }
}
