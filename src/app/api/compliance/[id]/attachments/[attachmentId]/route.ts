import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { readComplianceEvidence } from "@/services/compliance";
import { z } from "zod";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!can(actor.role, "compliance.read"))
    return new Response("Forbidden", { status: 403 });
  const { id, attachmentId } = await params;
  if (
    !z.uuid().safeParse(id).success ||
    !z.uuid().safeParse(attachmentId).success
  )
    return new Response("Not found", { status: 404 });
  try {
    const file = await readComplianceEvidence(actor, id, attachmentId);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Document unavailable", { status: 500 });
  }
}
