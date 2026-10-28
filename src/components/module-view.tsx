import Link from "next/link";
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
import { RevenueChart } from "./revenue-chart";
import { masterFields, type Field } from "@/lib/modules";
import { can, type Actor } from "@/lib/permissions";
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
                .filter(([k]) => !["id", "createdAt"].includes(k))
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{String(v ?? "—")}</dd>
                  </div>
                ))}
            </dl>
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
          <h2>
            {r.number} <span className="badge">{r.status}</span>
          </h2>
          <p>
            {d.customers.find((c) => c.id === r.customerId)?.name} ·{" "}
            {formatMoney(r.total, r.currency)}
          </p>
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
          <h2>
            {r.number} <span className="badge">{r.status}</span>
          </h2>
          <p>{formatMoney(r.total, r.currency)}</p>
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
          <h2>
            {r.number} <span className="badge">{r.status}</span>
          </h2>
          <p>
            {variantLabel(r.variantId)} · {r.quantity} planned units
          </p>
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
                const b = d.balances.find((b) => b.materialId === i.materialId);
                const needed = new Decimal(i.quantity).mul(r.quantity);
                const available = new Decimal(b?.onHand ?? 0).minus(
                  b?.reserved ?? 0,
                );
                return {
                  id: i.id,
                  material: d.materials.find((m) => m.id === i.materialId)
                    ?.name,
                  required: needed.toFixed(4),
                  available: available.toFixed(4),
                  shortage: Decimal.max(0, needed.minus(available)).toFixed(4),
                };
              })}
            columns={columns(
              "material|Material",
              "required|Required",
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
      available: new Decimal(b.onHand).minus(b.reserved).toFixed(4),
    }));
    cols = columns(
      "item|Stock item",
      "kind|Type",
      "onHand|On hand",
      "reserved|Reserved",
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
              fields={masterFields.settings}
              defaults={
                Object.fromEntries(
                  Object.entries(d.settings[0] ?? {}).filter(
                    ([, v]) => typeof v === "string",
                  ),
                ) as Record<string, string>
              }
            />
          )}
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
        <div className="report-grid">
          {[
            "sales",
            "manufacturing",
            "materials",
            "inventory",
            "purchases",
            "invoices",
            "movements",
          ].map((m) => (
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
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR OPERATIONS, AT A GLANCE</p>
            <h1>
              Business overview<span className="title-dot">.</span>
            </h1>
            <p className="muted">{descriptions.dashboard}</p>
          </div>
          <Link className="btn btn-primary" href="/sales">
            View sales orders <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="welcome-strip">
          <span className="live-dot" />
          <strong>Everything in sync.</strong>
          <span>
            Inventory, production and sales — connected in one workspace.
          </span>
          <span className="strip-tag">OPERATIONS LIVE</span>
        </div>
        <div className="kpi-grid">
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
          <Link href="/manufacturing">
            <Factory size={22} />
            <div>
              <strong>On the production floor</strong>
              <p>Track work orders from planning to quality approval.</p>
            </div>
            <ArrowUpRight size={18} />
          </Link>
          <Link href="/inventory">
            <BoxesIcon />
            <div>
              <strong>Every unit accounted for</strong>
              <p>Explore stock, reservations and movement history.</p>
            </div>
            <ArrowUpRight size={18} />
          </Link>
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
