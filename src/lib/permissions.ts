export type Role = "admin" | "production" | "sales" | "inventory" | "viewer";
export type Actor = { id: string; role: Role };
const permissions: Record<Role, string[]> = {
  admin: ["*"],
  production: [
    "compliance.read",
    "repairs.read",
    "repairs.work",
    "manufacturing",
    "boms",
    "specifications",
    "branding.read",
    "returns.read",
    "returns.inspect",
  ],
  sales: [
    "compliance.read",
    "repairs.read",
    "repairs.create",
    "returns.read",
    "returns.sales",
    "shipping.read",
    "pricing",
    "quotations",
    "customers",
    "sales",
    "invoices",
    "branding",
    "branding.read",
    "branding.approve",
  ],
  inventory: [
    "procurement.cost",
    "compliance.read",
    "repairs.read",
    "repairs.work",
    "returns.read",
    "returns.receive",
    "returns.inspect",
    "shipping",
    "shipping.read",
    "materials",
    "purchases",
    "suppliers",
    "inventory",
    "branding.read",
  ],
  viewer: [],
};
export function can(role: Role, resource: string) {
  return (
    permissions[role]?.includes("*") ||
    permissions[role]?.includes(resource) ||
    false
  );
}
export function authorize(actor: Actor, resource: string) {
  if (!can(actor.role, resource))
    throw new Error("You do not have permission for this operation.");
}
export function canReadModule(role: Role, module: string) {
  if (module === "dashboard") return true;
  if (module === "specifications") return canReadModule(role, "products");
  if (module === "fabric-rolls") return canReadModule(role, "inventory");
  if (module === "cutting" || module === "production-operations") return can(role, "manufacturing");
  if (module === "outsourcing") return can(role, "manufacturing") || can(role, "inventory");
  if (module === "subcontractors") return can(role, "manufacturing") || can(role, "suppliers");
  const specialized: Record<string, string> = {
    branding: "branding.read", deliveries: "shipping.read", returns: "returns.read",
    repairs: "repairs.read", compliance: "compliance.read", "supplier-performance": "purchases",
  };
  if (specialized[module]) return can(role, specialized[module]);
  if (module === "reports")
    return [
      "sales",
      "manufacturing",
      "materials",
      "inventory",
      "purchases",
      "invoices",
      "movements",
    ].some((m) => canExportReport(role, m));
  if (module === "users" || module === "settings") return can(role, "settings");
  if (can(role, module)) return true;
  const readOnly: Partial<Record<Role, string[]>> = {
    production: ["products", "materials", "inventory", "employees"],
    sales: ["products"],
    inventory: ["products"],
  };
  return readOnly[role]?.includes(module) ?? false;
}
export function canExportReport(role: Role, report: string) {
  const resource: Record<string, string> = {
    sales: "sales",
    manufacturing: "manufacturing",
    materials: "materials",
    inventory: "inventory",
    purchases: "purchases",
    invoices: "invoices",
    movements: "inventory",
  };
  return !!resource[report] && can(role, resource[report]);
}
