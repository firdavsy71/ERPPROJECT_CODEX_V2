import { z } from "zod";
import Decimal from "decimal.js";
const text = z.string().trim().max(5000);
const positive = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/)
  .refine((v) => new Decimal(v).gt(0), "Must be positive");
const nonnegative = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/);
export const garmentTypes = [
  "Jacket",
  "Trousers",
  "Coverall",
  "Vest",
  "Winter uniform",
  "Two-piece set",
] as const;
export const measurementSchema = z.object({
  point: text.min(1),
  size: text.min(1),
  target: positive,
  tolerance: nonnegative,
  unit: z.enum(["cm", "mm"]),
});
export const documentSchema = z
  .object({
    garmentType: z.enum(garmentTypes),
    description: text,
    construction: text,
    manufacturingInstructions: text,
    fabrics: z
      .array(
        z
          .object({
            name: text.min(1),
            weightGsm: positive,
            weave: text,
            finish: text,
            composition: z
              .array(
                z.object({
                  fiber: text.min(1),
                  percent: positive.refine((v) => new Decimal(v).lte(100)),
                }),
              )
              .min(1)
              .max(20),
          })
          .superRefine((f, c) => {
            if (
              !f.composition
                .reduce((n, v) => n.add(v.percent), new Decimal(0))
                .eq(100)
            )
              c.addIssue({
                code: "custom",
                message: "Composition must total 100%",
              });
          }),
      )
      .max(30),
    measurements: z.array(measurementSchema).max(500),
    seams: z
      .array(
        z.object({
          location: text.min(1),
          stitchType: text.min(1),
          seamType: text.min(1),
          stitchesPerCm: positive,
          thread: text.min(1),
          allowanceMm: nonnegative,
        }),
      )
      .max(100),
    reflectiveTape: z
      .array(
        z.object({
          location: text.min(1),
          widthMm: positive,
          placement: text.min(1),
          standard: text,
        }),
      )
      .max(100),
    accessories: z
      .array(
        z.object({
          type: z.enum([
            "Zipper",
            "Button",
            "Thread",
            "Velcro",
            "Elastic",
            "Label",
            "Other",
          ]),
          description: text.min(1),
          quantity: positive,
          placement: text.min(1),
        }),
      )
      .max(100),
    qualityChecks: z.array(text.min(1)).max(100),
  })
  .superRefine((d, c) => {
    if (
      new Set(d.qualityChecks.map((v) => v.toLowerCase())).size !==
      d.qualityChecks.length
    )
      c.addIssue({
        code: "custom",
        path: ["qualityChecks"],
        message: "Quality criteria must be unique",
      });
    const keys = d.measurements.map(
      (m) => m.point.toLowerCase() + "|" + m.size.toLowerCase(),
    );
    if (new Set(keys).size !== keys.length)
      c.addIssue({
        code: "custom",
        path: ["measurements"],
        message: "Each measurement point / size must be unique",
      });
  });
export const variantSpecSchema = z
  .object({
    variantId: z.uuid(),
    fabricConsumption: positive,
    consumptionUnit: z.enum(["Meters", "Kilograms", "Pieces"]),
    instructions: text,
    measurements: z.array(measurementSchema).max(100),
  })
  .superRefine((v, c) => {
    const keys = v.measurements.map(
      (m) => m.point.toLowerCase() + "|" + m.size.toLowerCase(),
    );
    if (new Set(keys).size !== keys.length)
      c.addIssue({
        code: "custom",
        path: ["measurements"],
        message: "Variant measurements must be unique",
      });
  });
export const specificationInput = z.object({
  productId: z.uuid(),
  title: text.min(1),
  changeNote: text.min(1),
  document: documentSchema,
  variants: z.array(variantSpecSchema).max(100),
  revision: z.number().int().nonnegative().optional(),
});
export type SpecDocument = z.infer<typeof documentSchema>;
export type VariantSpec = z.infer<typeof variantSpecSchema>;
export const blankDocument: SpecDocument = {
  garmentType: "Jacket",
  description: "",
  construction: "",
  manufacturingInstructions: "",
  fabrics: [],
  measurements: [],
  seams: [],
  reflectiveTape: [],
  accessories: [],
  qualityChecks: [],
};
export function effectiveMeasurements(
  doc: SpecDocument,
  variant: {
    measurements: z.infer<typeof measurementSchema>[];
    snapshot: { size: string };
  },
) {
  return variant.measurements.length
    ? variant.measurements
    : doc.measurements.filter((m) => m.size === variant.snapshot.size);
}
