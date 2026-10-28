import type { Field } from "@/lib/modules";
export function certificationFields(
  products: { id: string; name: string }[],
  standards: { id: string; reference: string; title: string }[],
  specs: { id: string; productId: string; title: string; version: number }[],
): Field[] {
  return [
    {
      name: "productId",
      label: "Product",
      type: "select",
      required: true,
      options: products.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      name: "specificationId",
      label: "Technical specification version (optional)",
      type: "select",
      options: specs.map((s) => ({
        value: s.id,
        label: `${products.find((p) => p.id === s.productId)?.name} · ${s.title} · v${s.version}`,
      })),
    },
    {
      name: "standardId",
      label: "Safety standard",
      type: "select",
      required: true,
      options: standards.map((s) => ({
        value: s.id,
        label: `${s.reference} · ${s.title}`,
      })),
    },
    { name: "certificateNumber", label: "Certificate number", required: true },
    { name: "issuer", label: "Issuing organization", required: true },
    { name: "issueDate", label: "Issue date", type: "date", required: true },
    {
      name: "expiryDate",
      label: "Expiration date",
      type: "date",
      required: true,
    },
    {
      name: "scope",
      label: "Certified scope / limitations",
      type: "textarea",
      required: true,
    },
  ];
}
