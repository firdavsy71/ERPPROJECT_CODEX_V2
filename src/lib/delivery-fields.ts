import type { Field } from "@/lib/modules";
export const deliveryFields: Field[] = [
  {
    name: "address",
    label: "Delivery address",
    type: "textarea",
    required: true,
  },
  { name: "carrier", label: "Carrier / delivery provider", required: true },
  { name: "vehicle", label: "Vehicle registration / details" },
  { name: "driver", label: "Driver / contact details" },
  { name: "tracking", label: "Carrier tracking reference" },
  { name: "notes", label: "Delivery instructions", type: "textarea" },
];
