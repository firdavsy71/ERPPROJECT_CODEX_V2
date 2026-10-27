import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const id = () => uuid("id").defaultRandom().primaryKey();
const time = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const money = (name: string) =>
  numeric(name, { precision: 18, scale: 2 }).notNull().default("0");
const qty = (name: string) =>
  numeric(name, { precision: 18, scale: 4 }).notNull().default("0");
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: time(),
  },
  (t) => [
    check(
      "valid_role",
      sql`${t.role} in ('admin','production','sales','inventory','viewer')`,
    ),
  ],
);
export const customers = pgTable("customers", {
  id: id(),
  name: text().notNull(),
  contact: text(),
  email: text(),
  phone: text(),
  address: text(),
  taxId: text("tax_id"),
  notes: text(),
  active: boolean().notNull().default(true),
  createdAt: time(),
});
export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text().notNull(),
  contact: text(),
  email: text(),
  phone: text(),
  address: text(),
  notes: text(),
  active: boolean().notNull().default(true),
  createdAt: time(),
});
export const employees = pgTable("employees", {
  id: id(),
  name: text().notNull(),
  position: text(),
  department: text(),
  email: text(),
  phone: text(),
  active: boolean().notNull().default(true),
  createdAt: time(),
});
export const categories = pgTable("product_categories", {
  id: id(),
  name: text().notNull().unique(),
});
export const products = pgTable("products", {
  id: id(),
  name: text().notNull(),
  sku: text().notNull().unique(),
  categoryId: uuid("category_id").references(() => categories.id),
  description: text(),
  imageUrl: text("image_url"),
  active: boolean().notNull().default(true),
  createdAt: time(),
});
export const variants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    sku: text().notNull().unique(),
    size: text().notNull(),
    color: text().notNull(),
    fabric: text(),
    cost: money("cost"),
    price: money("price"),
    createdAt: time(),
  },
  (t) => [check("nonnegative_prices", sql`${t.cost} >= 0 and ${t.price} >= 0`)],
);
export const materials = pgTable(
  "materials",
  {
    id: id(),
    name: text().notNull(),
    sku: text().notNull().unique(),
    category: text().notNull().default("Fabric"),
    unit: text().notNull(),
    price: money("price"),
    minimum: qty("minimum"),
    active: boolean().notNull().default(true),
    createdAt: time(),
  },
  (t) => [
    check("material_nonnegative", sql`${t.price} >= 0 and ${t.minimum} >= 0`),
  ],
);
export const warehouses = pgTable("warehouses", {
  id: id(),
  name: text().notNull().unique(),
});
export const balances = pgTable(
  "inventory_balances",
  {
    id: id(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    materialId: uuid("material_id").references(() => materials.id),
    variantId: uuid("variant_id").references(() => variants.id),
    onHand: qty("on_hand"),
    reserved: qty("reserved"),
  },
  (t) => [
    check(
      "one_stock_item",
      sql`(${t.materialId} is null) <> (${t.variantId} is null)`,
    ),
    check(
      "valid_balance",
      sql`${t.onHand} >= 0 and ${t.reserved} >= 0 and ${t.reserved} <= ${t.onHand}`,
    ),
    uniqueIndex("material_warehouse").on(t.warehouseId, t.materialId),
    uniqueIndex("variant_warehouse").on(t.warehouseId, t.variantId),
  ],
);
export const movements = pgTable("inventory_movements", {
  id: id(),
  balanceId: uuid("balance_id")
    .notNull()
    .references(() => balances.id),
  quantity: qty("quantity"),
  reservedDelta: qty("reserved_delta"),
  reason: text().notNull(),
  source: text().notNull(),
  operationKey: text("operation_key").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: time(),
});
export const boms = pgTable(
  "bom_versions",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id),
    version: integer().notNull(),
    laborCost: money("labor_cost"),
    createdAt: time(),
  },
  (t) => [uniqueIndex("bom_version").on(t.variantId, t.version)],
);
export const bomItems = pgTable(
  "bom_items",
  {
    id: id(),
    bomId: uuid("bom_id")
      .notNull()
      .references(() => boms.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    quantity: qty("quantity"),
  },
  (t) => [
    check("bom_positive", sql`${t.quantity} > 0`),
    uniqueIndex("bom_material").on(t.bomId, t.materialId),
  ],
);
export const sales = pgTable(
  "sales_orders",
  {
    id: id(),
    number: text().notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: text().notNull().default("Draft"),
    currency: text().notNull().default("UZS"),
    deliveryDate: text("delivery_date"),
    total: money("total"),
    createdAt: time(),
  },
  (t) => [
    check(
      "sales_status",
      sql`${t.status} in ('Draft','Confirmed','Awaiting Production','Ready for Shipment','Partially Shipped','Shipped','Completed','Cancelled')`,
    ),
  ],
);
export const saleItems = pgTable(
  "sales_order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => sales.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id),
    quantity: integer().notNull(),
    price: money("price"),
    discount: money("discount"),
    reserved: integer().notNull().default(0),
    shipped: integer().notNull().default(0),
  },
  (t) => [
    check(
      "valid_sales_line",
      sql`${t.quantity}>0 and ${t.price}>=0 and ${t.discount}>=0 and ${t.discount}<=100 and ${t.reserved}>=0 and ${t.shipped}>=0 and ${t.reserved}+${t.shipped}<=${t.quantity}`,
    ),
  ],
);
export const manufacturing = pgTable(
  "manufacturing_orders",
  {
    id: id(),
    number: text().notNull().unique(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id),
    bomId: uuid("bom_id")
      .notNull()
      .references(() => boms.id),
    saleItemId: uuid("sale_item_id").references(() => saleItems.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    quantity: integer().notNull(),
    completed: integer().notNull().default(0),
    defective: integer().notNull().default(0),
    status: text().notNull().default("Draft"),
    dueDate: text("due_date"),
    notes: text(),
    createdAt: time(),
  },
  (t) => [
    check(
      "production_status",
      sql`${t.status} in ('Draft','Planned','In Progress','Quality Control','Completed','Cancelled')`,
    ),
    check(
      "production_quantities",
      sql`${t.quantity}>0 and ${t.completed}>=0 and ${t.defective}>=0 and ${t.completed}+${t.defective}<=${t.quantity}`,
    ),
  ],
);
export const reservations = pgTable(
  "production_material_reservations",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => manufacturing.id),
    balanceId: uuid("balance_id")
      .notNull()
      .references(() => balances.id),
    quantity: qty("quantity"),
    consumed: qty("consumed"),
  },
  (t) => [uniqueIndex("production_balance").on(t.orderId, t.balanceId)],
);
export const inspections = pgTable("quality_inspections", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => manufacturing.id),
  approved: integer().notNull(),
  rejected: integer().notNull(),
  notes: text(),
  inspectorId: uuid("inspector_id")
    .notNull()
    .references(() => users.id),
  createdAt: time(),
});
export const purchases = pgTable("purchase_orders", {
  id: id(),
  number: text().notNull().unique(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  status: text().notNull().default("Draft"),
  currency: text().notNull().default("UZS"),
  expectedDate: text("expected_date"),
  total: money("total"),
  createdAt: time(),
});
export const purchaseItems = pgTable(
  "purchase_order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => purchases.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    quantity: qty("quantity"),
    received: qty("received"),
    price: money("price"),
  },
  (t) => [
    check(
      "valid_purchase_line",
      sql`${t.quantity}>0 and ${t.received}>=0 and ${t.received}<=${t.quantity} and ${t.price}>=0`,
    ),
  ],
);
export const receipts = pgTable("purchase_receipts", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => purchases.id),
  operationKey: text("operation_key").notNull().unique(),
  createdAt: time(),
});
export const shipments = pgTable("shipments", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => sales.id),
  operationKey: text("operation_key").notNull().unique(),
  createdAt: time(),
});
export const shipmentItems = pgTable("shipment_items", {
  id: id(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => shipments.id),
  saleItemId: uuid("sale_item_id")
    .notNull()
    .references(() => saleItems.id),
  quantity: integer().notNull(),
});
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text().notNull().unique(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => sales.id),
    dueDate: text("due_date").notNull(),
    subtotal: money("subtotal"),
    taxRate: money("tax_rate"),
    total: money("total"),
    paid: money("paid"),
    status: text().notNull().default("Unpaid"),
    createdAt: time(),
  },
  (t) => [
    check(
      "invoice_money",
      sql`${t.total}>=0 and ${t.paid}>=0 and ${t.paid}<=${t.total} and ${t.taxRate}>=0 and ${t.taxRate}<=100`,
    ),
  ],
);
export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: money("amount"),
    reference: text().notNull(),
    operationKey: text("operation_key").notNull().unique(),
    createdAt: time(),
  },
  (t) => [check("positive_payment", sql`${t.amount}>0`)],
);
export const settings = pgTable("company_settings", {
  id: integer().primaryKey().default(1),
  name: text().notNull().default("Workwear ERP"),
  currency: text().notNull().default("UZS"),
  timezone: text().notNull().default("Asia/Tashkent"),
  taxRate: money("tax_rate"),
  address: text(),
  email: text(),
  phone: text(),
});
export const audit = pgTable("audit_logs", {
  id: id(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  action: text().notNull(),
  entityId: text("entity_id").notNull(),
  details: jsonb(),
  createdAt: time(),
});
export const operations = pgTable("operations", {
  key: text().primaryKey(),
  fingerprint: text().notNull(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  createdAt: time(),
});
export const loginAttempts = pgTable("login_attempts", {
  key: text().primaryKey(),
  attempts: integer().notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
