export type Field = {
  name: string;
  label: string;
  type?:
    "text" | "email" | "number" | "date" | "textarea" | "select" | "password";
  options?: { value: string; label: string }[];
  required?: boolean;
  default?: string;
};
export const nav = [
  ["dashboard", "Overview"],
  ["sales", "Sales orders"],
  ["customers", "Customers"],
  ["products", "Products"],
  ["manufacturing", "Manufacturing"],
  ["boms", "Bill of materials"],
  ["materials", "Raw materials"],
  ["inventory", "Finished inventory"],
  ["purchases", "Purchasing"],
  ["suppliers", "Suppliers"],
  ["invoices", "Invoices"],
  ["reports", "Reports"],
  ["employees", "Employees"],
  ["settings", "Settings"],
  ["specifications", "Technical specifications"],
  ["branding", "Custom branding"],
  ["fabric-rolls", "Fabric rolls"],
  ["cutting", "Cutting room"],
  ["production-operations", "Operations & labor"],
  ["outsourcing", "Outsourced manufacturing"],
  ["subcontractors", "Subcontractors"],
  ["pricing", "B2B pricing & contracts"],
  ["quotations", "Quotations"],
] as const;
export const masterFields: Record<string, Field[]> = {
  products: [
    { name: "name", label: "Product name", required: true },
    { name: "sku", label: "Product SKU", required: true },
    { name: "description", label: "Description", type: "textarea" },
  ],
  variants: [
    { name: "productId", label: "Product", type: "select", required: true },
    { name: "sku", label: "Variant SKU", required: true },
    { name: "size", label: "Size", required: true },
    { name: "color", label: "Color", required: true },
    { name: "fabric", label: "Fabric" },
    {
      name: "cost",
      label: "Manufacturing cost",
      type: "number",
      default: "0",
      required: true,
    },
    { name: "price", label: "Selling price", type: "number", required: true },
  ],
  materials: [
    { name: "name", label: "Material name", required: true },
    { name: "sku", label: "SKU", required: true },
    { name: "category", label: "Category", default: "Fabric", required: true },
    {
      name: "unit",
      label: "Unit",
      type: "select",
      options: ["Meters", "Pieces", "Kilograms", "Rolls", "Packs"].map((v) => ({
        value: v,
        label: v,
      })),
      required: true,
    },
    {
      name: "price",
      label: "Unit purchase price",
      type: "number",
      required: true,
    },
    {
      name: "minimum",
      label: "Minimum stock",
      type: "number",
      default: "0",
      required: true,
    },
  ],
  customers: [
    { name: "name", label: "Company name", required: true },
    { name: "contact", label: "Contact person" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone" },
    { name: "address", label: "Address" },
    { name: "taxId", label: "Tax ID" },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  suppliers: [
    { name: "name", label: "Supplier name", required: true },
    { name: "contact", label: "Contact person" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone" },
    { name: "address", label: "Address" },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  employees: [
    { name: "name", label: "Full name", required: true },
    { name: "position", label: "Position" },
    { name: "department", label: "Department" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone" },
  ],
  users: [
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    {
      name: "password",
      label: "Initial password (12+ characters)",
      type: "password",
      required: true,
    },
    {
      name: "role",
      label: "Role",
      type: "select",
      required: true,
      options: ["admin", "production", "sales", "inventory", "viewer"].map(
        (v) => ({ value: v, label: v }),
      ),
    },
  ],
  settings: [
    { name: "name", label: "Company name", required: true },
    {
      name: "currency",
      label: "Currency",
      type: "select",
      options: ["UZS", "USD"].map((v) => ({ value: v, label: v })),
      required: true,
    },
    {
      name: "timezone",
      label: "Timezone",
      default: "Asia/Tashkent",
      required: true,
    },
    {
      name: "taxRate",
      label: "Default tax %",
      type: "number",
      default: "0",
      required: true,
    },
    { name: "address", label: "Address" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone" },
  ],
};
