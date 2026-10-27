import { z } from "zod";
import Decimal from "decimal.js";
import { amount } from "./validation";
const text = z.string().trim().max(5000);
const positive = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/)
  .refine((v) => new Decimal(v).gt(0));
export const brandingTechniques = [
  "Embroidery",
  "Screen printing",
  "Heat transfer",
] as const;
export const brandingLocations = [
  "Left chest",
  "Right chest",
  "Back",
  "Left sleeve",
  "Right sleeve",
  "Other",
] as const;
export const brandingDocumentSchema = z
  .object({
    customerInstructions: text,
    productionInstructions: text,
    fabricColor: text,
    fabricColorStandard: text,
    fabricSurcharge: amount,
    reflectiveSurcharge: amount,
    reflectiveTape: z
      .array(
        z.object({
          location: text.min(1),
          widthMm: positive,
          color: text.min(1),
          configuration: text.min(1),
        }),
      )
      .max(30),
    placements: z
      .array(
        z.object({
          technique: z.enum(brandingTechniques),
          location: z.enum(brandingLocations),
          logoAssetId: z.uuid().or(z.literal("")),
          widthMm: positive,
          heightMm: positive,
          colors: text.min(1),
          thread: text,
          applicationInstructions: text.min(1),
          positionInstructions: text.min(1),
          unitPrice: amount,
          setupPrice: amount,
        }),
      )
      .max(30),
  })
  .superRefine((v, c) => {
    v.placements.forEach((p, i) => {
      if (p.technique === "Embroidery" && !p.thread)
        c.addIssue({
          code: "custom",
          path: ["placements", i, "thread"],
          message: "Specify embroidery thread",
        });
    });
    if (v.fabricColor && !v.fabricColorStandard)
      c.addIssue({
        code: "custom",
        path: ["fabricColorStandard"],
        message: "Specify a color standard / reference for custom fabric",
      });
  });
export const brandingInput = z.object({
  saleItemId: z.uuid(),
  specificationId: z.uuid(),
  title: text.min(1),
  changeNote: text.min(1),
  document: brandingDocumentSchema,
  revision: z.number().int().nonnegative().optional(),
});
export type BrandingDocument = z.infer<typeof brandingDocumentSchema>;
export type BrandingSnapshot = {
  customerId: string;
  customer: string;
  orderId: string;
  order: string;
  productId: string;
  product: string;
  variantId: string;
  sku: string;
  size: string;
  color: string;
  quantity: number;
  currency: string;
};
export const blankBranding: BrandingDocument = {
  customerInstructions: "",
  productionInstructions: "",
  fabricColor: "",
  fabricColorStandard: "",
  fabricSurcharge: "0",
  reflectiveSurcharge: "0",
  reflectiveTape: [],
  placements: [],
};
export function customizationPrice(doc: BrandingDocument, quantity: number) {
  z.number().int().positive().max(1000000).parse(quantity);
  const perUnit = doc.placements.reduce(
    (a, p) => a.add(p.unitPrice),
    new Decimal(doc.fabricSurcharge).add(doc.reflectiveSurcharge),
  );
  const setup = doc.placements.reduce(
    (a, p) => a.add(p.setupPrice),
    new Decimal(0),
  );
  return {
    perUnit: perUnit.toFixed(2),
    setup: setup.toFixed(2),
    total: perUnit.mul(quantity).add(setup).toFixed(2),
  };
}
