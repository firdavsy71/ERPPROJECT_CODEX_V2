import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { readDeliveryProof } from "@/services/delivery-proof";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!can(actor.role, "shipping.read"))
    return new Response("Forbidden", { status: 403 });
  try {
    const { id, fileId } = await params;
    const { file, bytes } = await readDeliveryProof(actor, id, fileId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.bytes),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return new Response("Proof unavailable", {
      status: e instanceof Error && e.message === "File not found" ? 404 : 503,
    });
  }
}
