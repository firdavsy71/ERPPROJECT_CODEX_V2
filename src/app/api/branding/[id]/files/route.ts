import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { uploadBrandingFile } from "@/services/branding";
import { brandingStorageConfigured } from "@/services/branding-storage";
import { z } from "zod";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor();
  if (!actor)
    return Response.json({ message: "Sign in required" }, { status: 401 });
  if (!can(actor.role, "branding"))
    return Response.json({ message: "Permission denied" }, { status: 403 });
  let originValid = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const protocol = request.headers.get("x-forwarded-proto")
      ? `${request.headers.get("x-forwarded-proto")}:`
      : new URL(request.url).protocol;
    originValid =
      origin.protocol === protocol &&
      origin.host ===
        (request.headers.get("host") ?? new URL(request.url).host);
  } catch {}
  if (!originValid)
    return Response.json({ message: "Invalid origin" }, { status: 403 });
  if (!brandingStorageConfigured())
    return Response.json(
      {
        message:
          "Connect a private Vercel Blob store and set BLOB_READ_WRITE_TOKEN to enable secure uploads.",
      },
      { status: 503 },
    );
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
      return Response.json(
        { message: "Select a PNG, JPEG or PDF file up to 2 MiB" },
        { status: 400 },
      );
    await uploadBrandingFile(
      actor,
      id,
      {
        name: file.name,
        mime: file.type,
        data: Buffer.from(await file.arrayBuffer()),
      },
      String(form.get("purpose")),
      z.coerce.number().int().nonnegative().parse(form.get("revision")),
    );
    return Response.json({ message: "Private file uploaded" });
  } catch (e) {
    return Response.json(
      {
        message:
          e instanceof z.ZodError
            ? "Invalid file metadata"
            : e instanceof Error &&
                !("cause" in e) &&
                !("query" in e) &&
                !e.name.startsWith("Blob")
              ? e.message
              : "Private upload failed. Check the storage configuration and retry.",
      },
      { status: 400 },
    );
  }
}
