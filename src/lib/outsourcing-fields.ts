import type { Field } from "@/lib/modules";
export const profileFields: Field[] = [
  { name: "specialties", label: "Workshop specialties", required: true },
  {
    name: "capacity",
    label: "Capacity (garments per month)",
    type: "number",
    required: true,
  },
  { name: "notes", label: "Contact / workshop instructions", type: "textarea" },
  {
    name: "active",
    label: "Profile status",
    type: "select",
    options: [
      { value: "true", label: "Active" },
      { value: "false", label: "Archived" },
    ],
    default: "true",
    required: true,
  },
];
export const outsourcingTerms: Field[] = [
  {
    name: "dueDate",
    label: "Expected final return date",
    type: "date",
    required: true,
  },
  {
    name: "currency",
    label: "Currency",
    type: "select",
    options: [
      { value: "UZS", label: "UZS" },
      { value: "USD", label: "USD" },
    ],
    required: true,
  },
  {
    name: "unitCost",
    label: "Agreed cost per assigned garment",
    type: "number",
    required: true,
  },
  {
    name: "notes",
    label: "Production and delivery instructions",
    type: "textarea",
  },
];
