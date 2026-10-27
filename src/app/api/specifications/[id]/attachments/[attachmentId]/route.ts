import { currentActor } from "@/auth";
import { db } from "@/db";
import { specificationAttachments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  if (!(await currentActor()))
    return new Response("Unauthorized", { status: 401 });
  const { id, attachmentId } = await params;
  if (
    !z.uuid().safeParse(id).success ||
    !z.uuid().safeParse(attachmentId).success
  )
    return new Response("Not found", { status: 404 });
  const [file] = await db()
    .select()
    .from(specificationAttachments)
    .where(
      and(
        eq(specificationAttachments.id, attachmentId),
        eq(specificationAttachments.specificationId, id),
      ),
    );
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(file.data, "base64")), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `${file.mime === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
