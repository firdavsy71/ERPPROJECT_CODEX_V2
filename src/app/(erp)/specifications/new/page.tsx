import { redirect } from "next/navigation";
import { db } from "@/db";
import { products, variants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { SpecificationEditor } from "@/components/specification-editor";
export default async function NewSpecification({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "specifications")) redirect("/specifications");
  const [p, v] = await Promise.all([
    db()
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.active, true)),
    db().select().from(variants),
  ]);
  const params = await searchParams;
  return (
    <>
      <h1>New technical specification</h1>
      <SpecificationEditor
        products={p}
        variants={v}
        productId={params.productId}
      />
    </>
  );
}
