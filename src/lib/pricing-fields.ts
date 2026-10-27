import type { Field } from "@/lib/modules";
export const priceRuleFields: Field[] = [
  { name: "name", label: "Contract number / price list name", required: true },
  {
    name: "kind",
    label: "Rule priority",
    type: "select",
    options: ["Contract", "Customer", "Volume", "Standard"].map((v) => ({
      value: v,
      label: v,
    })),
    required: true,
  },
  {
    name: "currency",
    label: "Currency",
    type: "select",
    options: ["UZS", "USD"].map((v) => ({ value: v, label: v })),
    required: true,
  },
  {
    name: "startDate",
    label: "Starts on (inclusive)",
    type: "date",
    required: true,
  },
  {
    name: "endDate",
    label: "Expires on (inclusive)",
    type: "date",
    required: true,
  },
  {
    name: "minimum",
    label: "Minimum order quantity",
    type: "number",
    default: "1",
    required: true,
  },
];
export const tierFields: Field[] = [
  {
    name: "minQty",
    label: "From quantity (inclusive)",
    type: "number",
    required: true,
  },
  {
    name: "mode",
    label: "Fixed price or exclusive discount",
    type: "select",
    options: [
      { value: "Price", label: "Fixed unit price" },
      { value: "Discount", label: "Percent off standard price" },
    ],
    required: true,
  },
  {
    name: "value",
    label: "Unit price / discount percent",
    type: "number",
    required: true,
  },
];
