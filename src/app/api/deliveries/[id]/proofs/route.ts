import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { uploadDeliveryProof } from "@/services/delivery-proof";
import { revalidatePath } from "next/cache";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor();
  if (!actor)
    return Response.json({ message: "Sign in required" }, { status: 401 });
  if (!can(actor.role, "shipping"))
    return Response.json({ message: "Permission denied" }, { status: 403 });
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const protocol = request.headers.get("x-forwarded-proto")
      ? `${request.headers.get("x-forwarded-proto")}:`
      : new URL(request.url).protocol;
    if (origin.host !== host || origin.protocol !== protocol)
      return Response.json({ message: "Invalid origin" }, { status: 403 });
  } catch {
    return Response.json({ message: "Invalid origin" }, { status: 403 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return Response.json(
      {
        message:
          "Private Vercel Blob storage must be configured for proof-of-delivery uploads",
      },
      { status: 503 },
    );
  if (Number(request.headers.get("content-length")) > 2200000)
    return Response.json(
      { message: "Maximum file size is 2 MiB" },
      { status: 413 },
    );
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2200000) {
        await reader.cancel();
        return Response.json(
          { message: "Maximum file size is 2 MiB" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 2097152)
      throw new Error("Choose a PNG, JPEG or PDF up to 2 MiB");
    const { id } = await params;
    await uploadDeliveryProof(
      actor,
      id,
      {
        name: file.name,
        mime: file.type,
        data: Buffer.from(await file.arrayBuffer()),
      },
      String(form.get("note") ?? ""),
    );
    revalidatePath(`/deliveries/${id}`);
    return Response.json({ message: "Private delivery proof uploaded" });
  } catch (e) {
    return Response.json(
      {
        message:
          e instanceof Error &&
          !("cause" in e) &&
          !("query" in e) &&
          !e.name.startsWith("Blob")
            ? e.message
            : "Private upload failed; check storage and retry",
      },
      { status: 400 },
    );
  }
}
