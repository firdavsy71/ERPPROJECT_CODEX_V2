export type Role = "admin" | "production" | "sales" | "inventory" | "viewer";
export type Actor = { id: string; role: Role };
const permissions: Record<Role, string[]> = {
  admin: ["*"],
  production: [
    "manufacturing",
    "boms",
    "specifications",
    "branding.read",
    "returns.read",
    "returns.inspect",
  ],
  sales: [
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
