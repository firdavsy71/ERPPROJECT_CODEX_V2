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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SpecDocument, VariantSpec } from "@/lib/specification";
import type { BrandingDocument, BrandingSnapshot } from "@/lib/branding";
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
    rollTracked: boolean("roll_tracked").notNull().default(false),
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
    specificationId: uuid("specification_id").references(
      () => specifications.id,
    ),
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
    brandingTotal: money("branding_total"),
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
    specificationId: uuid("specification_id").references(
      () => specifications.id,
    ),
    brandingVersionId: uuid("branding_version_id").references(
      () => brandingVersions.id,
    ),
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
  brandingVersionId: uuid("branding_version_id").references(
    () => brandingVersions.id,
  ),
  brandingCheck: text("branding_check"),
  specificationId: uuid("specification_id").references(() => specifications.id),
  specificationResults: jsonb("specification_results").$type<
    { check: string; result: "Pass" | "Fail"; notes: string }[]
  >(),
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
export const specifications = pgTable(
  "product_specifications",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    version: integer().notNull(),
    title: text().notNull(),
    changeNote: text("change_note").notNull(),
    status: text().notNull().default("Draft"),
    revision: integer().notNull().default(0),
    document: jsonb().$type<SpecDocument>().notNull(),
    productSnapshot: jsonb("product_snapshot")
      .$type<{ name: string; sku: string }>()
      .notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: time(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("product_spec_version").on(t.productId, t.version),
    check(
      "spec_status",
      sql`${t.status} in ('Draft','In Review','Approved','Rejected')`,
    ),
    check(
      "spec_approval_metadata",
      sql`(${t.status}='Approved') = (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
  ],
);
export const specificationVariants = pgTable(
  "specification_variants",
  {
    id: id(),
    specificationId: uuid("specification_id")
      .notNull()
      .references(() => specifications.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id),
    fabricConsumption: qty("fabric_consumption"),
    consumptionUnit: text("consumption_unit")
      .$type<VariantSpec["consumptionUnit"]>()
      .notNull(),
    instructions: text().notNull(),
    measurements: jsonb().$type<VariantSpec["measurements"]>().notNull(),
    snapshot: jsonb()
      .$type<{ sku: string; size: string; color: string }>()
      .notNull(),
  },
  (t) => [
    uniqueIndex("spec_variant").on(t.specificationId, t.variantId),
    check("spec_positive_consumption", sql`${t.fabricConsumption}>0`),
  ],
);
export const specificationAttachments = pgTable(
  "specification_attachments",
  {
    id: id(),
    specificationId: uuid("specification_id")
      .notNull()
      .references(() => specifications.id),
    name: text().notNull(),
    kind: text().notNull(),
    mime: text().notNull(),
    bytes: integer().notNull(),
    data: text().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    check("spec_attachment_size", sql`${t.bytes}>0 and ${t.bytes}<=2097152`),
    check(
      "spec_attachment_type",
      sql`${t.mime} in ('image/png','image/jpeg','application/pdf')`,
    ),
  ],
);
export const brandingRequests = pgTable("branding_requests", {
  id: id(),
  saleItemId: uuid("sale_item_id")
    .notNull()
    .unique()
    .references(() => saleItems.id),
  approvedVersionId: uuid("approved_version_id").references(
    (): AnyPgColumn => brandingVersions.id,
  ),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: time(),
});
export const brandingVersions = pgTable(
  "branding_versions",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => brandingRequests.id),
    version: integer().notNull(),
    title: text().notNull(),
    changeNote: text("change_note").notNull(),
    status: text().notNull().default("Draft"),
    revision: integer().notNull().default(0),
    specificationId: uuid("specification_id")
      .notNull()
      .references(() => specifications.id),
    document: jsonb().$type<BrandingDocument>().notNull(),
    snapshot: jsonb().$type<BrandingSnapshot>().notNull(),
    perUnit: money("per_unit"),
    setup: money("setup"),
    total: money("total"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    customerApprover: text("customer_approver"),
    approvalReference: text("approval_reference"),
    reviewNote: text("review_note"),
  },
  (t) => [
    uniqueIndex("branding_request_version").on(t.requestId, t.version),
    check(
      "branding_status",
      sql`${t.status} in ('Draft','In Review','Approved','Rejected')`,
    ),
    check(
      "branding_approval",
      sql`(${t.status}='Approved') = (${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.customerApprover} is not null and ${t.approvalReference} is not null)`,
    ),
    check(
      "branding_prices",
      sql`${t.perUnit}>=0 and ${t.setup}>=0 and ${t.total}>=0`,
    ),
  ],
);
export const brandingAssets = pgTable(
  "branding_assets",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => brandingRequests.id),
    provider: text().notNull().default("vercel-blob-private"),
    pathname: text().notNull().unique(),
    name: text().notNull(),
    mime: text().notNull(),
    bytes: integer().notNull(),
    sha256: text().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    check("branding_asset_size", sql`${t.bytes}>0 and ${t.bytes}<=2097152`),
    check(
      "branding_asset_mime",
      sql`${t.mime} in ('image/png','image/jpeg','application/pdf')`,
    ),
    check("branding_asset_provider", sql`${t.provider}='vercel-blob-private'`),
  ],
);
export const brandingFiles = pgTable(
  "branding_version_files",
  {
    id: id(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => brandingVersions.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => brandingAssets.id),
    purpose: text().notNull(),
    proofRevision: integer("proof_revision"),
    createdAt: time(),
  },
  (t) => [
    uniqueIndex("branding_file_link").on(t.versionId, t.assetId, t.purpose),
    check(
      "branding_file_purpose",
      sql`${t.purpose} in ('Logo','Design proof','Reference')`,
    ),
  ],
);

export type FabricSegment = { start: string; end: string };
export const subcontractors = pgTable(
  "subcontractors",
  {
    id: id(),
    supplierId: uuid("supplier_id")
      .notNull()
      .unique()
      .references(() => suppliers.id),
    specialties: text().notNull(),
    capacity: integer().notNull().default(0),
    notes: text().notNull().default(""),
    active: boolean().notNull().default(true),
    createdAt: time(),
  },
  (t) => [check("subcontractor_capacity", sql`${t.capacity}>=0`)],
);
export const outsourcingOrders = pgTable(
  "outsourcing_orders",
  {
    id: id(),
    number: text().notNull().unique(),
    manufacturingOrderId: uuid("manufacturing_order_id")
      .notNull()
      .references(() => manufacturing.id),
    subcontractorId: uuid("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id),
    status: text().notNull().default("Draft"),
    dueDate: text("due_date").notNull(),
    currency: text().notNull(),
    unitCost: money("unit_cost"),
    produced: integer().notNull().default(0),
    notes: text().notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    uniqueIndex("one_live_outsourcing_per_manufacturing")
      .on(t.manufacturingOrderId)
      .where(sql`${t.status}<>'Cancelled'`),
    check(
      "outsourcing_status",
      sql`${t.status} in ('Draft','Active','Completed','Cancelled') and ${t.produced}>=0 and ${t.unitCost}>=0`,
    ),
  ],
);
export const outsourcingCustody = pgTable(
  "outsourcing_custody",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => outsourcingOrders.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    rollId: uuid("roll_id").references(() => fabricRolls.id),
    quantity: qty("quantity"),
    consumed: qty("consumed"),
    returned: qty("returned"),
    segments: jsonb()
      .$type<{ start: string; end: string }[]>()
      .notNull()
      .default([]),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => movements.id),
    reference: text().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    uniqueIndex("outsourcing_issue_reference").on(t.orderId, t.reference),
    check(
      "custody_quantities",
      sql`${t.quantity}>0 and ${t.consumed}>=0 and ${t.returned}>=0 and ${t.consumed}+${t.returned}<=${t.quantity}`,
    ),
  ],
);
export const outsourcingMaterialEvents = pgTable(
  "outsourcing_material_events",
  {
    id: id(),
    custodyId: uuid("custody_id")
      .notNull()
      .references(() => outsourcingCustody.id),
    kind: text().notNull(),
    quantity: qty("quantity"),
    reference: text().notNull(),
    returnedRollId: uuid("returned_roll_id").references(() => fabricRolls.id),
    movementId: uuid("movement_id").references(() => movements.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    uniqueIndex("custody_document_reference").on(
      t.custodyId,
      t.kind,
      t.reference,
    ),
    check(
      "custody_event_kind",
      sql`${t.kind} in ('Consumed','Returned') and ${t.quantity}>0`,
    ),
  ],
);
export const outsourcingReceipts = pgTable(
  "outsourcing_receipts",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => outsourcingOrders.id),
    reference: text().notNull(),
    accepted: integer().notNull(),
    rejected: integer().notNull(),
    qualityResults: jsonb("quality_results")
      .$type<{ check: string; result: string }[]>()
      .notNull(),
    brandingCheck: text("branding_check"),
    notes: text().notNull(),
    movementId: uuid("movement_id").references(() => movements.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    uniqueIndex("outsourcing_receipt_reference").on(t.orderId, t.reference),
    check(
      "outsourcing_receipt_quantity",
      sql`${t.accepted}>=0 and ${t.rejected}>=0 and ${t.accepted}+${t.rejected}>0`,
    ),
  ],
);
export const outsourcingCosts = pgTable(
  "outsourcing_costs",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => outsourcingOrders.id),
    reference: text().notNull(),
    amount: money("amount"),
    notes: text().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    uniqueIndex("outsourcing_cost_reference").on(t.orderId, t.reference),
    check("outsourcing_cost_positive", sql`${t.amount}>0`),
  ],
);
export type RoutingStep = { name: string; minutes: string };
export const productionRoutings = pgTable(
  "production_routings",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    version: integer().notNull(),
    steps: jsonb().$type<RoutingStep[]>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [uniqueIndex("product_routing_version").on(t.productId, t.version)],
);
export const orderRoutings = pgTable("order_routings", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => manufacturing.id),
  routingId: uuid("routing_id")
    .notNull()
    .references(() => productionRoutings.id),
  steps: jsonb().$type<RoutingStep[]>().notNull(),
  createdAt: time(),
});
export const laborEntries = pgTable(
  "labor_entries",
  {
    id: id(),
    orderRoutingId: uuid("order_routing_id")
      .notNull()
      .references(() => orderRoutings.id),
    sequence: integer().notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    completed: integer().notNull().default(0),
    rejected: integer().notNull().default(0),
    notes: text().notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    check(
      "labor_quantities",
      sql`${t.sequence}>=0 and ${t.completed}>=0 and ${t.rejected}>=0 and (${t.endedAt} is null or ${t.endedAt}>=${t.startedAt})`,
    ),
    uniqueIndex("employee_one_active_operation")
      .on(t.employeeId)
      .where(sql`${t.endedAt} is null`),
    uniqueIndex("operation_one_active_session")
      .on(t.orderRoutingId, t.sequence)
      .where(sql`${t.endedAt} is null`),
  ],
);
export const cuttingBatches = pgTable(
  "cutting_batches",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => manufacturing.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => fabricRolls.id),
    specificationId: uuid("specification_id")
      .notNull()
      .references(() => specifications.id),
    size: text().notNull(),
    layout: text().notNull(),
    rateSource: text("rate_source").notNull(),
    quantity: integer().notNull(),
    planned: qty("planned"),
    status: text().notNull().default("Planned"),
    result: jsonb().$type<{
      issued: string;
      incorporated: string;
      waste: string;
      returned: string;
      piecesCut: number;
      rejectedPieces: number;
      consumed: string;
      variance: string;
      acceptedPieces: number;
      efficiencyPercent: string | null;
      wastePercent: string | null;
      cutPieces: { part: string; quantity: number; rejected: number }[];
    }>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    completedBy: uuid("completed_by").references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    check(
      "cutting_batch_valid",
      sql`${t.quantity}>0 and ${t.planned}>0 and ${t.status} in ('Planned','Completed','Cancelled') and (${t.status}='Completed')=(${t.result} is not null and ${t.completedBy} is not null)`,
    ),
  ],
);
export const fabricRolls = pgTable(
  "fabric_rolls",
  {
    id: id(),
    balanceId: uuid("balance_id")
      .notNull()
      .references(() => balances.id),
    rollNumber: text("roll_number").notNull().unique(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    purchaseReceiptId: uuid("purchase_receipt_id").references(
      () => receipts.id,
    ),
    purchaseOrderItemId: uuid("purchase_order_item_id").references(
      () => purchaseItems.id,
    ),
    supplierBatch: text("supplier_batch"),
    supplierLot: text("supplier_lot"),
    color: text().notNull(),
    composition: text().notNull(),
    widthCm: qty("width_cm"),
    receivedLength: qty("received_length"),
    physicalLength: qty("physical_length"),
    remainingLength: qty("remaining_length"),
    reservedLength: qty("reserved_length"),
    usableSegments: jsonb("usable_segments")
      .$type<FabricSegment[]>()
      .notNull()
      .default([]),
    storageLocation: text("storage_location").notNull(),
    notes: text(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    check(
      "fabric_roll_quantities",
      sql`${t.widthCm}>0 and ${t.receivedLength}>0 and ${t.physicalLength}>=${t.receivedLength} and ${t.remainingLength}>=0 and ${t.remainingLength}<=${t.physicalLength} and ${t.reservedLength}>=0 and ${t.reservedLength}<=${t.remainingLength}`,
    ),
    check(
      "fabric_roll_identity",
      sql`length(trim(${t.rollNumber}))>0 and length(trim(${t.color}))>0 and length(trim(${t.composition}))>0 and length(trim(${t.storageLocation}))>0`,
    ),
    check(
      "fabric_roll_receipt_pair",
      sql`(${t.purchaseReceiptId} is null)=(${t.purchaseOrderItemId} is null)`,
    ),
  ],
);
export const fabricRollReservations = pgTable(
  "fabric_roll_reservations",
  {
    id: id(),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => fabricRolls.id),
    manufacturingOrderId: uuid("manufacturing_order_id")
      .notNull()
      .references(() => manufacturing.id),
    materialReservationId: uuid("material_reservation_id")
      .notNull()
      .references(() => reservations.id),
    quantity: qty("quantity"),
    consumed: qty("consumed"),
    released: qty("released"),
    createdAt: time(),
  },
  (t) => [
    uniqueIndex("fabric_roll_material_reservation").on(
      t.rollId,
      t.materialReservationId,
    ),
    check(
      "fabric_roll_reservation_quantities",
      sql`${t.quantity}>0 and ${t.consumed}>=0 and ${t.released}>=0 and ${t.consumed}+${t.released}<=${t.quantity}`,
    ),
  ],
);
export const fabricRollMovements = pgTable(
  "fabric_roll_movements",
  {
    id: id(),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => fabricRolls.id),
    inventoryMovementId: uuid("inventory_movement_id").references(
      () => movements.id,
    ),
    manufacturingOrderId: uuid("manufacturing_order_id").references(
      () => manufacturing.id,
    ),
    materialReservationId: uuid("material_reservation_id").references(
      () => reservations.id,
    ),
    quantity: qty("quantity"),
    reservedDelta: qty("reserved_delta"),
    segments: jsonb().$type<FabricSegment[]>().notNull().default([]),
    reason: text().notNull(),
    source: text().notNull(),
    operationKey: text("operation_key").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    check(
      "fabric_roll_movement_nonempty",
      sql`${t.quantity}<>0 or ${t.reservedDelta}<>0`,
    ),
  ],
);
export const fabricDefects = pgTable(
  "fabric_defects",
  {
    id: id(),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => fabricRolls.id),
    movementId: uuid("movement_id")
      .notNull()
      .unique()
      .references(() => fabricRollMovements.id),
    startMeter: qty("start_meter"),
    endMeter: qty("end_meter"),
    description: text().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    check(
      "fabric_defect_range",
      sql`${t.startMeter}>=0 and ${t.endMeter}>${t.startMeter} and length(trim(${t.description}))>0`,
    ),
  ],
);
