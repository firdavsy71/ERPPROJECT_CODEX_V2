import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { readBrandingFile } from "@/services/branding";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!can(actor.role, "branding.read"))
    return new Response("Forbidden", { status: 403 });
  try {
    const { id, fileId } = await params;
    const { asset, bytes } = await readBrandingFile(actor, id, fileId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(asset.bytes),
        "Content-Disposition": `${asset.mime === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    const missing = e instanceof Error && e.message === "File not found";
    return new Response(
      missing
        ? "File not found"
        : "Private file could not be verified or retrieved",
      { status: missing ? 404 : 503 },
    );
  }
}
