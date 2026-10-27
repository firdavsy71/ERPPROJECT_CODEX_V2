import type { Field } from "@/lib/modules";

export const rollFields: Field[] = [
  { name: "rollNumber", label: "Unique roll number", required: true },
  { name: "supplierBatch", label: "Supplier batch" },
  { name: "supplierLot", label: "Supplier lot" },
  { name: "color", label: "Color", required: true },
  { name: "composition", label: "Composition (for example 65% polyester / 35% cotton)", required: true },
  { name: "widthCm", label: "Width (cm)", type: "number", required: true },
  { name: "receivedLength", label: "Usable length (m)", type: "number", required: true },
  { name: "storageLocation", label: "Storage location", required: true },
  { name: "notes", label: "Notes", type: "textarea" },
];
