import { currentActor } from "@/auth";
import { currentLocale } from "@/i18n/server";
import {
  documentKinds,
  getDocument,
  type DocumentKind,
} from "@/services/documents";
import { renderDocumentPdf } from "@/services/document-pdf";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { kind, id } = await params;
  if (
    !documentKinds.includes(kind as DocumentKind) ||
    !z.uuid().safeParse(id).success
  )
    return new Response("Not found", { status: 404 });
  try {
    const result = await getDocument(actor, kind as DocumentKind, id);
    if (!result) return new Response("Not found", { status: 404 });
    const refs = result.data.attachments ?? [];
    const attachments =
      kind === "technical-specification" && refs.length
        ? await db()
            .select()
            .from(s.specificationAttachments)
            .where(
              and(
                eq(s.specificationAttachments.specificationId, id),
                inArray(
                  s.specificationAttachments.id,
                  refs.map((x) => x.id),
                ),
              ),
            )
        : [];
    const bytes = await renderDocumentPdf(
      result.data,
      result.source,
      await currentLocale(),
      attachments.map((a) => ({
        name: a.name,
        mime: a.mime,
        data: Buffer.from(a.data, "base64"),
      })),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${kind}-${id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("permission"))
      return new Response("Forbidden", { status: 403 });
    return new Response("Unable to generate document", { status: 500 });
  }
}
