import { notFound, redirect } from "next/navigation";
import { z } from "zod";
export default async function InvoicePrint({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  redirect(`/documents/invoice/${id}`);
}
