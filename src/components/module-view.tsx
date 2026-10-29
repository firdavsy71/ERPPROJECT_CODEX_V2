import Link from "next/link";
import { ReportFilters } from "./report-filters";
import { db } from "@/db";
import { specifications, specificationVariants } from "@/db/schema";
import { brandingVersions } from "@/db/schema";
import { SalesBrandingLinks } from "./branding-links";
import { ManufacturingBranding } from "./manufacturing-branding";
import { ManufacturingRolls } from "./manufacturing-rolls";
import { eq } from "drizzle-orm";
import {
  ArrowLeft,
  ArrowUpRight,
  Package,
  Factory,
  ShoppingBag,
  AlertTriangle,
} from "lucide-react";
import Decimal from "decimal.js";
import { ActionForm } from "./forms";
import { DataTable, type Row } from "./data-table";
import { ArchiveButton } from "./archive-button";
import { CompanyLogoManager } from "./company-logo-manager";
import { RevenueChart } from "./revenue-chart";
import { masterFields, type Field } from "@/lib/modules";
import { can, canReadModule, canExportReport, type Actor } from "@/lib/permissions";
import { formatMoney as baseFormatMoney } from "@/lib/utils";
import { currentLocale } from "@/i18n/server";
import { messages } from "@/i18n/messages";
import { businessDate, formatDateOnly, formatTimestamp } from "@/i18n/format";
import { type Data, overview } from "@/services/queries";
import type { MasterModule } from "@/services/master";
const descriptions: Record<string, string> = {
  dashboard: "A clear view of your business, from order to delivery.",
  products: "Every product, size and color. One connected catalog.",
  materials: "Keep the right materials ready for your next production run.",
  manufacturing:
    "Turn materials into quality workwear, with every step accounted for.",
  sales: "From customer request to a successful delivery.",
  boms: "The right recipe for every product. Versioned and traceable.",
  inventory: "Quality-approved products, ready for their next destination.",
  purchases: "Keep your supply chain moving, one delivery at a time.",
  invoices: "Stay on top of what is billed, paid and outstanding.",
  reports: "A traceable view of your operational activity.",
};
const field = (
  name: string,
  label: string,
  type: Field["type"] = "text",
  options?: { value: string; label: string }[],
  defaultValue?: string,
): Field => ({
  name,
  label,
  type,
  options,
  required: true,
  default: defaultValue,
});
const columns = (...pairs: string[]) =>
  pairs.map((p) => {
    const [key, label] = p.split("|");
    return { key, label: label ?? key };
  });
export async function ModuleView({
  module,
  d,
  actor,
  recordId,
}: {
  module: string;
  d: Data;
  actor: Actor;
  recordId?: string;
}) {
  const locale = await currentLocale();
  const dictionary = messages[locale];
  const title = dictionary.nav[module as keyof typeof dictionary.nav] ?? module;
  const formatMoney = (value: string | number, currency?: string) =>
    baseFormatMoney(value, currency, locale);
  const approvedSpecifications = await db()
    .select({
      id: specifications.id,
      title: specifications.title,
      version: specifications.version,
      document: specifications.document,
      variantId: specificationVariants.variantId,
    })
    .from(specifications)
    .innerJoin(
      specificationVariants,
      eq(specifications.id, specificationVariants.specificationId),
    )
    .where(eq(specifications.status, "Approved"));
  const specOptions = Array.from(
    new Map(
      approvedSpecifications.map((s) => [
        s.id,
        { value: s.id, label: `${s.title} · v${s.version}` },
      ]),
    ).values(),
  );
  const brandingOptions =
    module === "manufacturing" && can(actor.role, "branding.read")
      ? (
          await db()
            .select()
            .from(brandingVersions)
            .where(eq(brandingVersions.status, "Approved"))
            .limit(500)
        ).map((v) => ({
          value: v.id,
          label: `${v.snapshot.order} · ${v.snapshot.sku} · ${v.title} v${v.version}`,
        }))
      : [];
  const editable = can(actor.role, module);
  const currency = d.settings[0]?.currency ?? "UZS";
  const variantLabel = (id: string) => {
    const v = d.variants.find((v) => v.id === id);
    return v
      ? `${d.products.find((p) => p.id === v.productId)?.name} / ${v.size} / ${v.color}`
      : id;
  };
  const opts = {
    products: d.products
      .filter((x) => x.active)
      .map((x) => ({ value: x.id, label: x.name })),
    variants: d.variants.map((x) => ({
      value: x.id,
      label: `${x.sku} · ${variantLabel(x.id)}`,
    })),
    materials: d.materials
      .filter((x) => x.active)
      .map((x) => ({ value: x.id, label: `${x.name} (${x.unit})` })),
    customers: d.customers
      .filter((x) => x.active)
      .map((x) => ({ value: x.id, label: x.name })),
    suppliers: d.suppliers
      .filter((x) => x.active)
      .map((x) => ({ value: x.id, label: x.name })),
    boms: d.boms.map((x) => ({
      value: x.id,
      label: `${variantLabel(x.variantId)} · v${x.version}`,
    })),
  };
  const enrichedFields = (m: string) =>
    (masterFields[m] ?? []).map((f) =>
      f.name === "productId" ? { ...f, options: opts.products } : f,
    );
  const orderFields = (purchase = false) => [
    field(
      "partyId",
      purchase ? "Supplier" : "Customer",
      "select",
      purchase ? opts.suppliers : opts.customers,
    ),
    field(
      "currency",
      "Currency",
      "select",
      [
        { value: "UZS", label: "UZS" },
        { value: "USD", label: "USD" },
      ],
      currency,
    ),
    { name: "date", label: "Expected delivery", type: "date" } as Field,
  ];
  const orderLines = (purchase = false) => ({
    name: "lines",
    label: "Order lines",
    fields: [
      field(
        "itemId",
        purchase ? "Material" : "Product variant",
        "select",
        purchase ? opts.materials : opts.variants,
      ),
      field("quantity", "Quantity", "number"),
      field("price", "Unit price", "number"),
      ...(!purchase
        ? [field("discount", "Discount %", "number", undefined, "0")]
        : []),
    ],
  });
  let rows: Row[] = [];
  let cols = columns("name|Name");
  let create: React.ReactNode = null;
  let extra: React.ReactNode = null;
  let detail: React.ReactNode = null;
  if (module in masterFields && module !== "settings") {
    const records =
      d[
        module as
          "products" | "materials" | "customers" | "suppliers" | "employees"
      ];
    rows = records.map((x) => ({
      ...x,
      createdAt: undefined,
      status: x.active ? "Active" : "Archived",
    }));
    cols =
      module === "products"
        ? columns("name|Product", "sku|SKU", "status|Status")
        : module === "materials"
          ? columns(
              "name|Material",
              "sku|SKU",
              "unit|Unit",
              "price|Unit cost",
              "minimum|Min. stock",
              "status|Status",
            )
          : columns("name|Name", "email|Email", "phone|Phone", "status|Status");
    if (editable)
      create = (
        <ActionForm
          label={`Add ${module === "employees" ? "employee" : module.slice(0, -1)}`}
          master={module as MasterModule}
          fields={enrichedFields(module)}
        />
      );
    if (recordId) {
      const r = records.find((x) => x.id === recordId);
      if (r) {
        const defaults = Object.fromEntries(
          Object.entries(r).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>;
        detail = (
          <>
            <h2>{r.name}</h2>
            {module === "customers" && can(actor.role, "pricing") && (
              <p>
                <Link href={`/pricing?customerId=${r.id}`}>
                  Customer price lists and contracts
                </Link>{" "}
                ·{" "}
                <Link href={`/quotations?customerId=${r.id}`}>
                  Customer quotations
                </Link>
              </p>
            )}
            {module === "customers" && can(actor.role, "returns.read") && (
              <p>
                <Link href="/returns">Return authorizations and exchanges</Link>
              </p>
            )}
            {module === "suppliers" && can(actor.role, "purchases") && (
              <p><Link href={`/supplier-performance?supplierId=${r.id}`}>Supplier performance, quality and costs</Link></p>
            )}
            <div className="actions">
              {editable && (
                <>
                  <ActionForm
                    label="Edit record"
                    master={module as MasterModule}
                    fields={enrichedFields(module)}
                    id={r.id}
                    defaults={defaults}
                    secondary
                  />
                  <ArchiveButton module={module} id={r.id} />
                </>
              )}
            </div>
            <dl className="record-grid">
              {Object.entries(r)
                .filter(([k]) => !["id", "createdAt", "categoryId"].includes(k))
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k === "active" ? "Status" : k === "imageUrl" ? "Image reference" : (masterFields[module]?.find(f => f.name === k)?.label ?? k.replace(/([A-Z])/g, " $1"))}</dt>
                    <dd>{typeof v === "boolean" ? (v ? "Active" : "Archived") : String(v ?? "—")}</dd>
                  </div>
                ))}
            </dl>
            {module === "materials" && <section><div className="section-heading"><div><p className="eyebrow">STORAGE / AVAILABILITY</p><h3>Stock by warehouse</h3></div></div><DataTable rows={d.balances.filter(balance => balance.materialId === r.id).map(balance=>({id:balance.id,warehouse:d.warehouses.find(w=>w.id===balance.warehouseId)?.name,onHand:balance.onHand,reserved:balance.reserved,held:balance.held,available:new Decimal(balance.onHand).minus(balance.reserved).minus(balance.held).toFixed(4)}))} columns={columns("warehouse|Warehouse","onHand|On hand","reserved|Reserved","held|Incoming QC hold","available|Available")} /><h3>Material movements</h3><p className="muted">Latest journal entries in the current workspace view.</p><DataTable rows={d.movements.filter(movement=>d.balances.some(balance=>balance.id===movement.balanceId && balance.materialId===r.id)).map(movement=>({...movement,createdAt:movement.createdAt.toISOString()}))} columns={columns("createdAt|Date","reason|Operation","source|Source","quantity|Stock change","reservedDelta|Reserved change","heldDelta|QC hold change")} /></section>}
            {module === "products" && (
              <>
                {can(actor.role, "compliance.read") && (
                  <Link
                    className="btn btn-outline"
                    href={`/compliance?productId=${r.id}`}
                  >
                    Certificates and compliance evidence
                  </Link>
                )}
                <Link
                  className="btn btn-outline"
                  href={`/specifications?productId=${r.id}`}
                >
                  Technical specifications & version history
                </Link>
                {can(actor.role, "branding.read") && (
                  <Link
                    className="btn btn-outline"
                    href={`/branding?productId=${r.id}`}
                  >
                    Customer branding designs
                  </Link>
                )}
                <div className="section-heading">
                  <h3>Size & color variants</h3>
                  {editable && (
                    <ActionForm
                      label="Add variant"
                      master="variants"
                      fields={enrichedFields("variants")}
                      defaults={{ productId: r.id }}
                    />
                  )}
                </div>
                <DataTable
                  rows={d.variants
                    .filter((v) => v.productId === r.id)
                    .map((v) => ({ ...v, createdAt: undefined }))}
                  columns={columns(
                    "sku|SKU",
                    "size|Size",
                    "color|Color",
                    "fabric|Fabric",
                    "cost|Cost",
                    "price|Price",
                  )}
                />
              </>
            )}
            {module === "customers" && (
              <>
                <h3>Order history</h3>
                <DataTable
                  rows={d.sales
                    .filter((o) => o.customerId === r.id)
                    .map((o) => ({ ...o, createdAt: undefined }))}
                  columns={columns(
                    "number|Order",
                    "status|Status",
                    "currency|Currency",
                    "total|Total",
                  )}
                  href="sales"
                />
              </>
            )}
          </>
        );
      }
    }
  }
  if (module === "sales") {
    rows = d.sales.map((o) => ({
      ...o,
      createdAt: undefined,
      customer: d.customers.find((c) => c.id === o.customerId)?.name,
    }));
    cols = columns(
      "number|Order",
      "customer|Customer",
      "status|Status",
      "deliveryDate|Delivery",
      "currency|Currency",
      "total|Total",
    );
    if (editable)
      create = (
        <ActionForm
          label="New sales order"
          action="sale"
          fields={orderFields()}
          lines={orderLines()}
        />
      );
    const r = d.sales.find((o) => o.id === recordId);
    if (r) {
      const lines = d.saleItems.filter((l) => l.orderId === r.id);
      if (can(actor.role, "shipping.read"))
        create = (
          <Link
            className="btn btn-outline"
            href={`/deliveries?orderId=${r.id}`}
          >
            Picking lists, shipments and delivery history
          </Link>
        );
      if (r.quotationId && can(actor.role, "quotations"))
        create = (
          <div className="actions">
            {create}
            <Link
              className="btn btn-outline"
              href={`/quotations/${r.quotationId}`}
            >
              Agreed quotation and pricing snapshot
            </Link>
          </div>
        );
      if (can(actor.role, "returns.read"))
        create = (
          <div className="actions">
            {create}
            <Link className="btn btn-outline" href={`/returns?orderId=${r.id}`}>
              Returns, exchanges and credit requests
            </Link>
          </div>
        );
      if (can(actor.role, "branding.read"))
        extra = (
          <SalesBrandingLinks
            lines={lines.map((l) => ({
              id: l.id,
              label: variantLabel(l.variantId),
              total: formatMoney(l.brandingTotal, r.currency),
            }))}
            editable={editable && r.status === "Draft"}
          />
        );
      detail = (
        <>
          {can(actor.role,"sales") && <p><Link href={`/documents/sales-order/${r.id}`}>Printable sales order / PDF</Link></p>}
          <h2>
            {r.number} <span className="badge">{r.status}</span>
          </h2>
          <p>
            {d.customers.find((c) => c.id === r.customerId)?.name} ·{" "}
            {formatMoney(r.total, r.currency)}
          </p>
          <dl className="workspace-meta"><div><dt>Ordered units</dt><dd>{lines.reduce((sum,line)=>sum+line.quantity,0)}</dd></div><div><dt>Reserved units</dt><dd>{lines.reduce((sum,line)=>sum+line.reserved,0)}</dd></div><div><dt>Shipped units</dt><dd>{lines.reduce((sum,line)=>sum+line.shipped,0)}</dd></div><div><dt>Expected delivery</dt><dd>{r.deliveryDate ? formatDateOnly(r.deliveryDate,locale) : "Not specified"}</dd></div></dl>
          <progress className="order-progress" aria-label="Shipped units against ordered quantity" value={lines.reduce((sum,line)=>sum+line.shipped,0)} max={lines.reduce((sum,line)=>sum+line.quantity,0) || 1} />
          <div className="actions">
            {editable && r.status === "Draft" && (
              <ActionForm
                label="Confirm order"
                action="confirmSale"
                id={r.id}
                secondary
              />
            )}
            {can(actor.role, "inventory") &&
              !["Draft", "Completed", "Cancelled", "Shipped"].includes(
                r.status,
              ) && (
                <>
                  <ActionForm
                    label="Reserve available stock"
                    action="reserveSale"
                    id={r.id}
                  />
                  <ActionForm
                    label="Record shipment"
                    action="ship"
                    id={r.id}
                    lines={{
                      name: "lines",
                      label: "Shipment quantities",
                      fields: [
                        field(
                          "id",
                          "Sales line",
                          "select",
                          lines.map((l) => ({
                            value: l.id,
                            label: `${variantLabel(l.variantId)} · ${l.reserved} reserved`,
                          })),
                        ),
                        field("quantity", "Quantity", "number"),
                      ],
                    }}
                    secondary
                  />
                </>
              )}
            {editable && r.status === "Shipped" && (
              <ActionForm
                label="Generate invoice"
                action="invoice"
                id={r.id}
                fields={[
                  field("dueDate", "Due date", "date"),
                  field(
                    "taxRate",
                    "Tax rate %",
                    "number",
                    undefined,
                    d.settings[0]?.taxRate ?? "0",
                  ),
                ]}
              />
            )}
          </div>
          <DataTable
            rows={lines.map((l) => ({
              ...l,
              pricingSnapshot: undefined,
              product: variantLabel(l.variantId),
            }))}
            columns={columns(
              "product|Product variant",
              "quantity|Ordered",
              "price|Unit price",
              "discount|Discount %",
              "brandingTotal|Customization charge",
              "reserved|Reserved",
              "shipped|Shipped",
            )}
          />
        </>
      );
    }
  }
  if (module === "purchases") {
    rows = d.purchases.map((o) => ({
      ...o,
      createdAt: undefined,
      orderedAt: undefined,
      supplier: d.suppliers.find((c) => c.id === o.supplierId)?.name,
    }));
    cols = columns(
      "number|Purchase order",
      "supplier|Supplier",
      "status|Status",
      "expectedDate|Expected",
      "currency|Currency",
      "total|Total",
    );
    if (editable)
      create = (
        <ActionForm
          label="New purchase order"
          action="purchase"
          fields={orderFields(true)}
          lines={orderLines(true)}
        />
      );
    const r = d.purchases.find((o) => o.id === recordId);
    if (r) {
      const lines = d.purchaseItems.filter((l) => l.orderId === r.id);
      detail = (
        <>
          {can(actor.role,"purchases") && <p><Link href={`/documents/purchase-order/${r.id}`}>Printable purchase order / PDF</Link></p>}
          <h2>
            {r.number} <span className="badge">{r.status}</span>
          </h2>
          <p>{formatMoney(r.total, r.currency)}</p>
          {can(actor.role,"purchases") && <p><Link href={`/supplier-performance?orderId=${r.id}`}>Receipt quality and landed costs</Link></p>}
          <div className="actions">
            {editable && r.status === "Draft" && (
              <ActionForm
                label="Place order"
                action="orderPurchase"
                id={r.id}
              />
            )}{" "}
            {editable &&
              ["Ordered", "Partially Received"].includes(r.status) &&
              lines.some(
                (line) =>
                  !d.balances.some(
                    (balance) =>
                      balance.materialId === line.materialId &&
                      balance.rollTracked,
                  ),
              ) && (
                <ActionForm
                  label="Receive materials"
                  action="receive"
                  id={r.id}
                  lines={{
                    name: "lines",
                    label: "Receipt lines",
                    fields: [
                      field(
                        "id",
                        "Purchase line",
                        "select",
                        lines
                          .filter(
                            (line) =>
                              !d.balances.some(
                                (balance) =>
                                  balance.materialId === line.materialId &&
                                  balance.rollTracked,
                              ),
                          )
                          .map((l) => ({
                            value: l.id,
                            label: `${d.materials.find((m) => m.id === l.materialId)?.name} · ${new Decimal(l.quantity).minus(l.received)} remaining`,
                          })),
                      ),
                      field("quantity", "Received quantity", "number"),
                    ],
                  }}
                />
              )}
            {editable &&
              ["Ordered", "Partially Received"].includes(r.status) &&
              lines.some((line) =>
                d.balances.some(
                  (balance) =>
                    balance.materialId === line.materialId &&
                    balance.rollTracked,
                ),
              ) && (
                <Link
                  className="btn btn-outline"
                  href={`/fabric-rolls/receive/${r.id}`}
                >
                  Receive identified fabric rolls
                </Link>
              )}
          </div>
          <DataTable
            rows={lines.map((l) => ({
              ...l,
              material: d.materials.find((m) => m.id === l.materialId)?.name,
            }))}
            columns={columns(
              "material|Material",
              "quantity|Ordered",
              "received|Received",
              "price|Unit price",
            )}
          />
        </>
      );
    }
  }
  if (module === "boms") {
    rows = d.boms.map((b) => ({
      ...b,
      createdAt: undefined,
      product: variantLabel(b.variantId),
      materials: d.bomItems.filter((i) => i.bomId === b.id).length,
      cost: d.bomItems
        .filter((i) => i.bomId === b.id)
        .reduce(
          (a, i) =>
            a.add(
              new Decimal(i.quantity).mul(
                d.materials.find((m) => m.id === i.materialId)?.price ?? 0,
              ),
            ),
          new Decimal(b.laborCost),
        )
        .toFixed(2),
    }));
    cols = columns(
      "product|Product variant",
      "version|Version",
      "materials|Materials",
      "laborCost|Labor cost",
      "cost|Estimated cost",
    );
    if (editable)
      create = (
        <ActionForm
          label="New BOM version"
          action="bom"
          fields={[
            field("variantId", "Variant", "select", opts.variants),
            field("laborCost", "Labor cost", "number", undefined, "0"),
            {
              name: "specificationId",
              label: "Approved technical specification (optional)",
              type: "select",
              options: specOptions,
            },
          ]}
          lines={{
            name: "items",
            label: "Materials per unit",
            fields: [
              field("materialId", "Material", "select", opts.materials),
              field("quantity", "Consumption per unit", "number"),
            ],
          }}
        />
      );
    const r = d.boms.find((b) => b.id === recordId);
    if (r?.specificationId)
      extra = (
        <Link
          className="text-link"
          href={`/specifications/${r.specificationId}`}
        >
          Open approved technical specification
        </Link>
      );
    if (r)
      detail = (
        <>
          <h2>
            {variantLabel(r.variantId)} · v{r.version}
          </h2>
          <p className="muted">
            This version is immutable. Create a new version to change the
            recipe.
          </p>
          <DataTable
            rows={d.bomItems
              .filter((i) => i.bomId === r.id)
              .map((i) => ({
                ...i,
                material: d.materials.find((m) => m.id === i.materialId)?.name,
                unit: d.materials.find((m) => m.id === i.materialId)?.unit,
              }))}
            columns={columns(
              "material|Material",
              "quantity|Per unit",
              "unit|Unit",
            )}
          />
        </>
      );
  }
  if (module === "manufacturing") {
    rows = d.manufacturing.map((m) => ({
      ...m,
      createdAt: undefined,
      product: variantLabel(m.variantId),
    }));
    cols = columns(
      "number|Manufacturing order",
      "product|Product",
      "quantity|Planned",
      "completed|Approved",
      "status|Status",
      "dueDate|Due date",
    );
    if (editable)
      create = (
        <ActionForm
          label="New production order"
          action="manufacture"
          fields={[
            field("bomId", "BOM version", "select", opts.boms),
            {
              name: "brandingVersionId",
              label:
                "Approved branding version (blank = current approved for linked sales line)",
              type: "select",
              options: brandingOptions,
            },
            {
              name: "specificationId",
              label:
                "Approved specification (blank = BOM version or latest approved)",
              type: "select",
              options: specOptions,
            },
            field("quantity", "Planned quantity", "number"),
            {
              name: "saleItemId",
              label: "Linked sales line (optional)",
              type: "select",
              options: d.saleItems.map((l) => ({
                value: l.id,
                label: `${d.sales.find((o) => o.id === l.orderId)?.number} · ${variantLabel(l.variantId)}`,
              })),
            },
            { name: "dueDate", label: "Due date", type: "date" },
            { name: "notes", label: "Notes", type: "textarea" },
          ]}
        />
      );
    const r = d.manufacturing.find((m) => m.id === recordId);
    if (r?.brandingVersionId && can(actor.role, "branding.read"))
      extra = (
        <ManufacturingBranding
          id={r.brandingVersionId}
          actor={actor}
          quantity={r.quantity}
          orderId={r.id}
        />
      );
    if (r) {
      const hasTrackedMaterials = d.bomItems.some(
        (item) =>
          item.bomId === r.bomId &&
          d.balances.some(
            (balance) =>
              balance.materialId === item.materialId &&
              balance.warehouseId === r.warehouseId &&
              balance.rollTracked,
          ),
      );
      detail = (
        <>
          {can(actor.role,"manufacturing") && <p><Link href={`/documents/manufacturing-order/${r.id}`}>Manufacturing order / PDF</Link> · <Link href={`/documents/material-requirements/${r.id}`}>Material requirements / PDF</Link></p>}
          <h2>
            {r.number} <span className="badge">{r.status}</span>
          </h2>
          <p>
            {variantLabel(r.variantId)} · {r.quantity} planned units
          </p>
          <ol className="workflow-stages" aria-label="Production workflow">
            {["Draft", "Planned", "In Progress", "Quality Control", "Completed"].map((stage, index, stages) => {
              const current = stages.indexOf(r.status);
              return <li key={stage} data-state={index < current ? "complete" : index === current ? "current" : "upcoming"} aria-current={stage === r.status ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{stage}</li>;
            })}
          </ol>
          <dl className="workspace-meta">
            <div><dt>Planned quantity</dt><dd>{r.quantity}</dd></div>
            <div><dt>Accepted output</dt><dd>{r.completed}</dd></div>
            <div><dt>Remaining to accepted plan</dt><dd>{Math.max(0, r.quantity - r.completed)}</dd></div>
            <div><dt>Warehouse</dt><dd>{d.warehouses.find(w => w.id === r.warehouseId)?.name ?? "Assigned at planning"}</dd></div>
          </dl>
          <progress className="order-progress" aria-label="Accepted output against planned quantity" value={r.completed} max={r.quantity || 1} />
          <p>
            <Link href="/cutting">
              Cutting batches, layouts and fabric actuals
            </Link>
          </p>
          <p>
            <Link href={`/production-operations/${r.id}`}>
              Operation routing, employees and labor sessions
            </Link>
          </p>
          <p>
            <Link href="/outsourcing">
              Subcontractor production, custody and inspected deliveries
            </Link>
          </p>
          {r.specificationId ? (
            <Link
              className="btn btn-outline"
              href={`/specifications/${r.specificationId}?variantId=${r.variantId}`}
            >
              Technical sheet & QC criteria · fixed approved version
            </Link>
          ) : (
            <div className="actions">
              <p className="error">
                Legacy order: an approved technical specification must be bound
                before further production.
              </p>
              {editable && !["Completed", "Cancelled"].includes(r.status) && (
                <ActionForm
                  label="Bind approved specification"
                  action="bindSpecification"
                  id={r.id}
                  fields={[
                    field(
                      "specificationId",
                      "Approved specification",
                      "select",
                      approvedSpecifications
                        .filter((s) => s.variantId === r.variantId)
                        .map((s) => ({
                          value: s.id,
                          label: `${s.title} · v${s.version}`,
                        })),
                    ),
                  ]}
                />
              )}
            </div>
          )}
          <div className="actions">
            {editable && (
              <>
                {r.status === "Draft" && !hasTrackedMaterials && (
                  <ActionForm
                    label="Check & reserve materials"
                    action="plan"
                    id={r.id}
                  />
                )}{" "}
                {r.status === "Planned" && (
                  <ActionForm
                    label="Start production"
                    action="start"
                    id={r.id}
                  />
                )}{" "}
                {r.status === "In Progress" && (
                  <ActionForm
                    label="Record output"
                    action="record"
                    id={r.id}
                    fields={[
                      field("completed", "Completed units", "number"),
                      field(
                        "defective",
                        "Defective units",
                        "number",
                        undefined,
                        "0",
                      ),
                      {
                        name: "notes",
                        label: "Production notes",
                        type: "textarea",
                      },
                    ]}
                  />
                )}{" "}
                {r.status === "Quality Control" && !hasTrackedMaterials && (
                  <ActionForm
                    label="Approve quality & complete"
                    action="complete"
                    id={r.id}
                    fields={[
                      ...(r.brandingVersionId
                        ? [
                            field(
                              "brandingCheck",
                              "Branding matches fixed approved proof",
                              "select",
                              [
                                { value: "Pass", label: "Pass" },
                                { value: "Fail", label: "Fail" },
                              ],
                            ),
                          ]
                        : []),
                      ...(
                        approvedSpecifications.find(
                          (s) => s.id === r.specificationId,
                        )?.document.qualityChecks ?? []
                      ).map((check, i) =>
                        field(`quality__${i}`, `QC: ${check}`, "select", [
                          { value: "Pass", label: "Pass" },
                          { value: "Fail", label: "Fail" },
                        ]),
                      ),
                      field(
                        "approved",
                        "Quality-approved units",
                        "number",
                        undefined,
                        String(r.completed),
                      ),
                      {
                        name: "notes",
                        label: "Inspection notes",
                        type: "textarea",
                      },
                    ]}
                    lines={{
                      name: "consumption",
                      label:
                        "Actual material consumption (including rejected units)",
                      fields: [
                        field(
                          "reservationId",
                          "Reserved material",
                          "select",
                          d.reservations
                            .filter((x) => x.orderId === r.id)
                            .map((x) => ({
                              value: x.id,
                              label: `${d.materials.find((m) => m.id === d.balances.find((b) => b.id === x.balanceId)?.materialId)?.name} · ${x.quantity} reserved`,
                            })),
                        ),
                        field("quantity", "Actual consumed", "number"),
                      ],
                    }}
                  />
                )}
                {["Draft", "Planned"].includes(r.status) && (
                  <ActionForm
                    label="Cancel & release"
                    action="cancelProduction"
                    id={r.id}
                    secondary
                  />
                )}
              </>
            )}
          </div>
          <ManufacturingRolls
            order={r}
            data={d}
            editable={editable}
            qualityChecks={
              approvedSpecifications.find(
                (specification) => specification.id === r.specificationId,
              )?.document.qualityChecks ?? []
            }
          />
          <h3>Material requirements</h3>
          <DataTable
            rows={d.bomItems
              .filter((i) => i.bomId === r.bomId)
              .map((i) => {
                const b = d.balances.find((b) => b.materialId === i.materialId && b.warehouseId === (r.warehouseId ?? d.settings[0]?.primaryWarehouseId));
                const allocation = d.reservations.find(reservation => reservation.orderId === r.id && reservation.balanceId === b?.id);
                const needed = new Decimal(i.quantity).mul(r.quantity);
                const available = new Decimal(b?.onHand ?? 0).minus(
                  b?.reserved ?? 0,
                ).minus(b?.held ?? 0);
                return {
                  id: i.id,
                  material: d.materials.find((m) => m.id === i.materialId)
                    ?.name,
                  required: needed.toFixed(4),
                  reserved: allocation?.quantity ?? "0.0000",
                  consumed: allocation?.consumed ?? "0.0000",
                  available: available.toFixed(4),
                  shortage: Decimal.max(0, needed.minus(available)).toFixed(4),
                };
              })}
            columns={columns(
              "material|Material",
              "required|Required",
              "reserved|Order allocation",
              "consumed|Consumed",
              "available|Unreserved",
              "shortage|Unreserved shortage",
            )}
          />
        </>
      );
    }
  }
  if (module === "inventory") {
    rows = d.balances.map((b) => ({
      ...b,
      item: b.variantId
        ? variantLabel(b.variantId)
        : d.materials.find((m) => m.id === b.materialId)?.name,
      kind: b.variantId ? "Finished goods" : "Raw material",
      available: new Decimal(b.onHand).minus(b.reserved).minus(b.held).toFixed(4),
    }));
    cols = columns(
      "item|Stock item",
      "kind|Type",
      "onHand|On hand",
      "reserved|Reserved",
      "held|Incoming QC hold",
      "available|Available",
    );
    if (editable)
      create = (
        <ActionForm
          label="Adjust stock"
          action="adjust"
          fields={[
            field("kind", "Stock type", "select", [
              { value: "material", label: "Raw material" },
              { value: "variant", label: "Finished goods" },
            ]),
            field("itemId", "Stock item", "select", [
              ...opts.materials,
              ...opts.variants,
            ]),
            field("delta", "Quantity change (negative to deduct)"),
            field("reason", "Adjustment reason"),
          ]}
        />
      );
    extra = (
      <>
        <section className="panel inventory-matrix">
          <div className="section-heading"><div><p className="eyebrow">FINISHED GOODS / AVAILABLE TO RESERVE</p><h2>Size & color availability</h2><p className="muted">Available = on hand − reserved. Warehouses are displayed separately.</p></div></div>
          {d.warehouses.map(warehouse => d.products.filter(product => d.variants.some(variant => variant.productId === product.id && d.balances.some(balance => balance.variantId === variant.id && balance.warehouseId === warehouse.id))).map(product => {
            const variants = d.variants.filter(variant => variant.productId === product.id);
            const sizes = [...new Set(variants.map(variant => variant.size))];
            const colors = [...new Set(variants.map(variant => variant.color))];
            return <div key={`${warehouse.id}-${product.id}`}><h3>{product.name} <span className="muted">/ {warehouse.name}</span></h3><div className="table-scroll"><table><caption className="sr-only">{product.name} available units in {warehouse.name}</caption><thead><tr><th scope="col">Size</th>{colors.map(color => <th scope="col" key={color}>{color}</th>)}</tr></thead><tbody>{sizes.map(size => <tr key={size}><th scope="row">{size}</th>{colors.map(color => {
              const variant = variants.find(variant => variant.size === size && variant.color === color);
              const balance = d.balances.find(balance => balance.variantId === variant?.id && balance.warehouseId === warehouse.id);
              return <td key={color} className="numeric">{variant ? new Decimal(balance?.onHand ?? 0).minus(balance?.reserved ?? 0).toFixed(0) : "—"}</td>;
            })}</tr>)}</tbody></table></div></div>;
          }))}
          {!d.balances.some(balance => balance.variantId) && <p className="muted">Accepted finished goods will appear here after quality control.</p>}
        </section>
        <div className="section-heading">
          <h2>Movement ledger</h2>
          <span className="muted">Latest 100 entries</span>
        </div>
        <DataTable
          rows={d.movements.map((m) => ({
            ...m,
            createdAt: m.createdAt.toISOString().slice(0, 16).replace("T", " "),
          }))}
          columns={columns(
            "createdAt|Date (UTC)",
            "reason|Operation",
            "source|Source",
            "quantity|Stock change",
            "reservedDelta|Reserved change",
          )}
        />
      </>
    );
  }
  if (module === "invoices") {
    const returnPosition = (i: (typeof d.invoices)[number]) => {
      const credited = d.returnCredits
          .filter((c) => c.invoiceId === i.id)
          .reduce((n, c) => n.add(c.amount), new Decimal(0)),
        refunded = d.returnRefunds
          .filter((c) => c.invoiceId === i.id)
          .reduce((n, c) => n.add(c.amount), new Decimal(0)),
        adjusted = new Decimal(i.total).minus(credited),
        netPaid = new Decimal(i.paid).minus(refunded);
      return {
        credited: credited.toFixed(2),
        refunded: refunded.toFixed(2),
        adjusted: adjusted.toFixed(2),
        due: Decimal.max(adjusted.minus(netPaid), 0).toFixed(2),
        creditBalance: Decimal.max(netPaid.minus(adjusted), 0).toFixed(2),
      };
    };
    rows = d.invoices.map((i) => ({
      ...i,
      createdAt: undefined,
      order: d.sales.find((o) => o.id === i.orderId)?.number,
      currency: d.sales.find((o) => o.id === i.orderId)?.currency,
      total: formatMoney(
        i.total,
        d.sales.find((o) => o.id === i.orderId)?.currency ?? currency,
      ),
      dueDate: formatDateOnly(i.dueDate, locale),
      outstanding: formatMoney(
        returnPosition(i).due,
        d.sales.find((o) => o.id === i.orderId)?.currency ?? currency,
      ),
      status:
        i.status !== "Paid" &&
        i.dueDate <
          businessDate(new Date(), d.settings[0]?.timezone ?? "Asia/Tashkent")
          ? "Overdue"
          : i.status,
    }));
    cols = columns(
      "number|Invoice",
      "order|Order",
      "dueDate|Due date",
      "currency|Currency",
      "total|Total",
      "outstanding|Outstanding",
      "status|Status",
    );
    const r = d.invoices.find((i) => i.id === recordId);
    if (r)
      detail = (
        <>
          <h2>{r.number}</h2>
          <p>
            {d.settings[0]?.name} · {dictionary.invoice.dueDate}{" "}
            {formatDateOnly(r.dueDate, locale)}
          </p>
          {can(actor.role, "returns.read") && (
            <p>
              <Link href={`/returns?invoiceId=${r.id}`}>
                Return requests, credit notes and refunds
              </Link>
            </p>
          )}
          <p>
            <Link className="btn btn-outline" href={`/invoices/${r.id}/print`}>
              {dictionary.common.print}
            </Link>
          </p>
          <p>
            {dictionary.invoice.credit}:{" "}
            {locale === "en"
              ? returnPosition(r).credited
              : formatMoney(
                  returnPosition(r).credited,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}{" "}
            · {dictionary.invoice.refunds}:{" "}
            {locale === "en"
              ? returnPosition(r).refunded
              : formatMoney(
                  returnPosition(r).refunded,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}{" "}
            · {dictionary.invoice.adjusted}:{" "}
            {locale === "en"
              ? returnPosition(r).adjusted
              : formatMoney(
                  returnPosition(r).adjusted,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}{" "}
            · {dictionary.invoice.due}:{" "}
            {locale === "en"
              ? returnPosition(r).due
              : formatMoney(
                  returnPosition(r).due,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}{" "}
            ·{dictionary.invoice.balance}:{" "}
            {locale === "en"
              ? returnPosition(r).creditBalance
              : formatMoney(
                  returnPosition(r).creditBalance,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}
          </p>
          <dl className="record-grid">
            <div>
              <dt>{dictionary.invoice.subtotal}</dt>
              <dd>
                {formatMoney(
                  r.subtotal,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}
              </dd>
            </div>
            <div>
              <dt>{dictionary.forms.taxRate}</dt>
              <dd>{r.taxRate}%</dd>
            </div>
            <div>
              <dt>{dictionary.invoice.total}</dt>
              <dd>
                {formatMoney(
                  r.total,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}
              </dd>
            </div>
            <div>
              <dt>{dictionary.invoice.payments}</dt>
              <dd>
                {formatMoney(
                  r.paid,
                  d.sales.find((o) => o.id === r.orderId)?.currency ?? currency,
                )}
              </dd>
            </div>
          </dl>
          {editable && new Decimal(returnPosition(r).due).gt(0) && (
            <ActionForm
              label="Record payment"
              action="pay"
              id={r.id}
              fields={[
                field("amount", "Payment amount", "number"),
                field("reference", "Payment reference"),
              ]}
            />
          )}
          <h3>{dictionary.invoice.creditHistory}</h3>
          <DataTable
            rows={d.returnCredits
              .filter((c) => c.invoiceId === r.id)
              .map((c) => ({
                ...c,
                createdAt: formatTimestamp(
                  c.createdAt,
                  locale,
                  d.settings[0]?.timezone ?? "Asia/Tashkent",
                ),
              }))}
            columns={columns(
              "number|Credit note",
              "quantity|Units credited",
              "amount|Gross credit",
              "createdAt|Issued (UTC)",
            )}
          />
          <h3>{dictionary.invoice.refundHistory}</h3>
          <DataTable
            rows={d.returnRefunds
              .filter((c) => c.invoiceId === r.id)
              .map((c) => ({
                ...c,
                createdAt: formatTimestamp(
                  c.createdAt,
                  locale,
                  d.settings[0]?.timezone ?? "Asia/Tashkent",
                ),
              }))}
            columns={columns(
              "reference|Payment reference",
              "amount|Amount",
              "notes|Notes",
              "createdAt|Recorded (UTC)",
            )}
          />
          <h3>{dictionary.invoice.history}</h3>
          <DataTable
            rows={d.payments
              .filter((p) => p.invoiceId === r.id)
              .map((p) => ({
                ...p,
                createdAt: formatTimestamp(
                  p.createdAt,
                  locale,
                  d.settings[0]?.timezone ?? "Asia/Tashkent",
                ),
              }))}
            columns={columns(
              "reference|Reference",
              "amount|Amount",
              "createdAt|Date",
            )}
          />
        </>
      );
  }
  if (module === "settings") {
    extra = (
      <>
        <section className="detail-card">
          <h2>{dictionary.common.settings}</h2>
          <p>
            {d.settings[0]?.name} · {currency} · {d.settings[0]?.timezone}
          </p>
          {editable && (
            <ActionForm
              label="Edit settings"
              master="settings"
              fields={masterFields.settings.map(f=>f.name==="primaryWarehouseId"?{...f,options:d.warehouses.map(w=>({value:w.id,label:w.name}))}:f)}
              defaults={
                Object.fromEntries(
                  Object.entries(d.settings[0] ?? {}).filter(
                    ([, v]) => typeof v === "string",
                  ),
                ) as Record<string, string>
              }
            />
          )}
          {editable && <CompanyLogoManager />}
        </section>
        {editable && (
          <>
            <div className="section-heading">
              <h2>Workspace users</h2>
              <ActionForm
                label="Add user"
                master="users"
                fields={masterFields.users}
              />
            </div>
            <DataTable
              rows={d.users}
              columns={columns(
                "name|Name",
                "email|Email",
                "role|Role",
                "active|Active",
              )}
              href="users"
            />
          </>
        )}
      </>
    );
  }
  if (module === "users" && actor.role === "admin") {
    const r = d.users.find((u) => u.id === recordId);
    if (r)
      detail = (
        <>
          <h2>{r.name}</h2>
          <p>
            {r.email} · {r.role}
          </p>
          <ArchiveButton module="users" id={r.id} />
        </>
      );
  }
  if (module === "reports")
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">INSIGHTS / LIVE DATA</p>
            <h1>{dictionary.reports.title}</h1>
            <p className="muted">
              Export persisted records for review. Currency values remain
              separated.
            </p>
          </div>
        </div>
        <ReportFilters reports={["sales","manufacturing","materials","inventory","purchases","invoices","movements"].filter(m=>canExportReport(actor.role,m)).map(m=>({value:m,label:dictionary.nav[m as keyof typeof dictionary.nav] ?? m}))} warehouses={d.warehouses} />
        <div className="report-grid">
          {[
            "sales",
            "manufacturing",
            "materials",
            "inventory",
            "purchases",
            "invoices",
            "movements",
          ].filter(m=>canExportReport(actor.role,m)).map((m) => (
            <Link
              className="report-card"
              href={`/api/reports?report=${m}`}
              key={m}
            >
              <span className="report-icon">
                <ArrowUpRight size={20} />
              </span>
              <h2>{dictionary.nav[m as keyof typeof dictionary.nav] ?? m}</h2>
              <p>{dictionary.reports.export}</p>
              <span className="text-link">{dictionary.reports.export} ↗</span>
            </Link>
          ))}
        </div>
      </>
    );
  if (module === "dashboard") {
    const o = await overview();
    const k = o.kpis;
    const cards = [
      {
        label: "Open sales orders",
        value: String(k?.pending ?? 0),
        icon: ShoppingBag,
        hint: "Orders awaiting fulfillment",
      },
      {
        label: "Active production",
        value: String(k?.active ?? 0),
        icon: Factory,
        hint: "Across the production floor",
      },
      {
        label: "Completed production",
        value: String(k?.completed ?? 0),
        icon: Package,
        hint: "Quality-approved orders",
      },
      {
        label: "Low-stock materials",
        value: String(k?.low ?? 0),
        icon: AlertTriangle,
        hint: "Items below minimum stock",
      },
    ];
    const dashboardDate = formatDateOnly(businessDate(new Date(), d.settings[0]?.timezone ?? "Asia/Tashkent"), locale);
    const dashboardHero = <header className="dashboard-hero page-heading"><div><p className="eyebrow">WORKWEAR / OPERATING OVERVIEW</p><h1>{dictionary.nav.dashboard}<span className="title-dot">.</span></h1><p className="muted">{descriptions.dashboard}</p></div><div><time className="dashboard-date">{dashboardDate}</time><div className="actions">{canReadModule(actor.role,"sales") && <Link className="btn btn-primary" href="/sales">View sales orders <ArrowUpRight size={16} /></Link>}{canReadModule(actor.role,"manufacturing") && <Link className="btn btn-outline" href="/manufacturing">Production queue <ArrowUpRight size={16} /></Link>}</div></div></header>;
    if(!can(actor.role,"invoices")) return <>{dashboardHero}<div className="kpi-grid dashboard-metrics">{cards.map(c=><section className="kpi" key={c.label}><span>{c.label}</span><strong>{c.value}</strong><small>{c.hint}</small></section>)}</div>{canReadModule(actor.role,"manufacturing") && <section className="panel dashboard-queue"><div className="section-heading"><div><p className="eyebrow">PRODUCTION / OPEN WORK</p><h2>On the floor</h2></div><Link href="/manufacturing" className="text-link">All production orders ↗</Link></div><DataTable rows={d.manufacturing.filter(m => !["Completed","Cancelled"].includes(m.status)).slice(-6).reverse().map(m=>({id:m.id,number:m.number,product:variantLabel(m.variantId),quantity:m.quantity,completed:m.completed,status:m.status}))} columns={columns("number|Order","product|Product","quantity|Planned","completed|Accepted","status|Status")} href="manufacturing" /></section>}</>;
    return (
      <>
        {dashboardHero}
        <div className="welcome-strip">
          <span className="live-dot" />
          <strong>One connected workflow.</strong>
          <span>
            Inventory, production and sales — connected in one workspace.
          </span>
          <span className="strip-tag">SALES → PRODUCTION → DELIVERY</span>
        </div>
        <div className="kpi-grid dashboard-metrics">
          {cards.map((c) => (
            <section className="kpi" key={c.label}>
              <div>
                <span>{c.label}</span>
                <c.icon size={18} />
              </div>
              <strong>{c.value}</strong>
              <small>{c.hint}</small>
            </section>
          ))}
        </div>
        <div className="dashboard-split">
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Revenue overview</h2>
                <p className="muted">Invoiced revenue · monthly · {currency}</p>
              </div>
              <span className="badge">Live records</span>
            </div>
            <RevenueChart
              data={o.trends
                .filter((r) => r.currency === currency)
                .map((r) => ({
                  month: String(r.month),
                  revenue: Number(r.revenue),
                }))}
            />
          </section>
          <section className="panel financial-panel">
            <p className="eyebrow">FINANCIAL SNAPSHOT</p>
            <h2>Know where you stand.</h2>
            {o.revenue.length ? (
              o.revenue.map((r) => (
                <div className="financial-row" key={String(r.currency)}>
                  <span>Total invoiced · {String(r.currency)}</span>
                  <strong>
                    {formatMoney(String(r.total), String(r.currency))}
                  </strong>
                  <small>
                    Outstanding{" "}
                    {formatMoney(String(r.outstanding), String(r.currency))}
                  </small>
                </div>
              ))
            ) : (
              <p className="muted">
                No invoices yet. Complete a shipment and generate your first
                invoice.
              </p>
            )}
            <Link className="text-link" href="/invoices">
              Manage invoices <ArrowUpRight size={15} />
            </Link>
          </section>
        </div>
        <div className="section-heading">
          <div>
            <h2>Recent sales orders</h2>
            <p className="muted">
              The latest activity across your customer orders.
            </p>
          </div>
          <Link className="text-link" href="/sales">
            View all orders <ArrowUpRight size={15} />
          </Link>
        </div>
        <DataTable
          rows={d.sales
            .slice(-6)
            .reverse()
            .map((o) => ({
              id: o.id,
              number: o.number,
              customer: d.customers.find((c) => c.id === o.customerId)?.name,
              status: o.status,
              total: formatMoney(o.total, o.currency),
              delivery: o.deliveryDate,
            }))}
          columns={columns(
            "number|Order",
            "customer|Customer",
            "status|Status",
            "delivery|Delivery",
            "total|Total",
          )}
          href="sales"
        />
        <div className="dashboard-bottom">
          {canReadModule(actor.role,"manufacturing") && <Link href="/manufacturing">
            <Factory size={22} />
            <div>
              <strong>On the production floor</strong>
              <p>Track work orders from planning to quality approval.</p>
            </div>
            <ArrowUpRight size={18} />
          </Link>}
          {canReadModule(actor.role,"inventory") && <Link href="/inventory">
            <BoxesIcon />
            <div>
              <strong>Every unit accounted for</strong>
              <p>Explore stock, reservations and movement history.</p>
            </div>
            <ArrowUpRight size={18} />
          </Link>}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE / {title.toUpperCase()}</p>
          <h1>
            {title}
            <span className="title-dot">.</span>
          </h1>
          <p className="muted">
            {descriptions[module] ??
              "Your business records, organized and connected."}
          </p>
        </div>
        <div className="actions">{create}</div>
      </div>
      {!recordId && rows.length > 0 && <dl className="workspace-meta workspace-summary"><div><dt>Records in this workspace</dt><dd>{rows.length}</dd></div>{["sales","manufacturing","purchases","invoices"].includes(module) && <div><dt>Requiring completion</dt><dd>{rows.filter(row=>row.status && !["Completed","Paid","Received","Cancelled","Archived","Shipped"].includes(String(row.status))).length}</dd></div>}<div><dt>Workspace</dt><dd>{title}</dd></div></dl>}
      {recordId ? (
        <>
          <Link
            href={`/${module === "users" ? "settings" : module}`}
            className="back-link"
          >
            <ArrowLeft size={15} /> Back to {title.toLowerCase()}
          </Link>
          <section className="detail-card">
            {detail ?? <p>Record not found.</p>}
          </section>
        </>
      ) : (
        module !== "settings" && (
          <DataTable
            rows={rows}
            columns={cols}
            href={module === "inventory" ? undefined : module}
          />
        )
      )}{" "}
      {extra}
    </>
  );
}
function BoxesIcon() {
  return <Package size={22} />;
}
