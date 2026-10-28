import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { currentActor } from "@/auth";
import { currentLocale } from "@/i18n/server";
import {
  documentKinds,
  getDocument,
  type DocumentKind,
} from "@/services/documents";
import { BusinessDocument } from "@/components/business-document";
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const { kind, id } = await params;
  if (
    !documentKinds.includes(kind as DocumentKind) ||
    !z.uuid().safeParse(id).success
  )
    notFound();
  let result;
  try {
    result = await getDocument(actor, kind as DocumentKind, id);
  } catch {
    notFound();
  }
  if (!result) notFound();
  return (
    <BusinessDocument
      id={id}
      document={result.data}
      source={result.source}
      locale={await currentLocale()}
    />
  );
}
