import {
  saveSpecification,
  transitionSpecification,
} from "../src/services/specifications";
import type { Actor } from "../src/lib/permissions";
import type { SpecDocument } from "../src/lib/specification";
export function validDocument(): SpecDocument {
  return {
    garmentType: "Jacket",
    description: "Industrial jacket",
    construction: "Two front panels; lined pockets",
    manufacturingInstructions: "Cut, assemble, stitch and inspect.",
    fabrics: [
      {
        name: "Polycotton",
        weightGsm: "240",
        weave: "Twill",
        finish: "Preshrunk",
        composition: [
          { fiber: "Polyester", percent: "65" },
          { fiber: "Cotton", percent: "35" },
        ],
      },
    ],
    measurements: [
      {
        point: "Chest half width",
        size: "L",
        target: "60",
        tolerance: "0.5",
        unit: "cm",
      },
    ],
    seams: [
      {
        location: "Side seam",
        stitchType: "301",
        seamType: "Superimposed",
        stitchesPerCm: "4",
        thread: "Polyester 40",
        allowanceMm: "10",
      },
    ],
    reflectiveTape: [
      {
        location: "Chest",
        widthMm: "50",
        placement: "100 mm below armhole",
        standard: "Per customer requirement",
      },
    ],
    accessories: [
      {
        type: "Zipper",
        description: "Metal #5",
        quantity: "1",
        placement: "Center front",
      },
    ],
    qualityChecks: ["Visual finish"],
  };
}
export async function approvedSpec(
  actor: Actor,
  productId: string,
  variantId: string,
) {
  const id = await saveSpecification(actor, {
    productId,
    title: "Jacket technical sheet",
    changeNote: "Initial issue",
    document: validDocument(),
    variants: [
      {
        variantId,
        fabricConsumption: "2.5",
        consumptionUnit: "Meters",
        instructions: "",
        measurements: [],
      },
    ],
  });
  await transitionSpecification(actor, id, "submit", "");
  await transitionSpecification(
    actor,
    id,
    "approve",
    "Approved for production",
  );
  return id;
}
