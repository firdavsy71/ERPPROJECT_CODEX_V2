import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import {
  brandingEditorChoices,
  latestBrandingForLine,
} from "@/services/branding-queries";
import { BrandingEditor } from "@/components/branding-editor";
import { z } from "zod";
export default async function NewBranding({
  searchParams,
}: {
  searchParams: Promise<{ saleItemId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "branding")) redirect("/branding");
  const { saleItemId } = await searchParams;
  const preferred =
    saleItemId && z.uuid().safeParse(saleItemId).success
      ? saleItemId
      : undefined;
  if (preferred) {
    const existing = await latestBrandingForLine(preferred);
    if (existing) redirect(`/branding/${existing}`);
  }
  const choices = await brandingEditorChoices(preferred);
  return (
    <>
      <h1>New customer branding request</h1>
      <p className="muted">
        Start from a draft sales order. Select an approved product engineering
        specification, save the draft, then upload logos and prepare a proof.
      </p>
      {!choices.lines.length && (
        <p>
          <Link className="text-link" href="/sales">
            Create a draft sales order first
          </Link>
        </p>
      )}
      {!choices.specs.length && (
        <p>
          <Link className="text-link" href="/specifications">
            Create and approve the product technical specification first
          </Link>
        </p>
      )}
      <BrandingEditor {...choices} preferred={preferred} />
    </>
  );
}
