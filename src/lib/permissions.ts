export type Role = "admin" | "production" | "sales" | "inventory" | "viewer";
export type Actor = { id: string; role: Role };
const permissions: Record<Role, string[]> = {
  admin: ["*"],
  production: ["manufacturing", "boms"],
  sales: ["customers", "sales", "invoices"],
  inventory: ["materials", "purchases", "suppliers", "inventory"],
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
