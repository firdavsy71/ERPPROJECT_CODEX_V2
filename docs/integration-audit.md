# Cross-module integration audit — 28 October 2026

## Executed checks

The PostgreSQL integration suite uses isolated PGlite PostgreSQL databases,
applies the complete migration chain and invokes the same transactional
services as the application. The customer-demand regression starts with a sales
order, attempts production planning before confirmation, confirms the order,
detects a material shortage with rollback, places a purchase, receives and
inspects material, reserves production materials, records output, approves QC,
reserves finished goods, packs and dispatches a managed shipment, confirms
delivery, invoices and records payment. It reconciles the journal, reservations,
receipts, shipments and payments at completion. Retries of receipt and dispatch
are tested with the same idempotency key.

The existing browser workflow was also executed against an isolated seeded
database: sign-in, catalog/specification/BOM, customer order, production,
QC, finished-goods reservation, shipment, invoice, payment and dashboard.

The production Neon audit is read-only. Before the new migrations it reported
200 foreign keys, 64 check constraints and zero unvalidated constraints.
Ten reconciliation checks found zero violations. This is a point-in-time result
for the records present, not a load test or proof of every future operation.

## Integration coverage

| Integration | Executed regression coverage |
| --- | --- |
| Products, BOM, technical specifications | Matching variants/specifications, immutable versions; referenced variant identity and material units |
| BOM, manufacturing, raw materials | Shortage rollback, material reservation, actual consumption/release, cancellation |
| Purchasing, inventory, supplier QC | Partial receipts, complete rollback of invalid multi-line receipt, receipt snapshots, rejection stock movements |
| Roll tracking, manufacturing, cutting | Roll/balance reconciliation, partial consumption, reserved fabric protection, cutting waste and actuals |
| Production, QC, finished inventory | Fixed approved specification checks; accepted output only; duplicate completion protection |
| Inventory, sales, shipping | Reservations, partial shipment, no overshipping, picking commitments, dispatch exactly once |
| Shipping, invoices, payments | Fully dispatched invoice eligibility, preserved amounts, partial payments, overpayment rejection |
| Returns, inventory, commercial balances | Delivered-quantity limits, receipt before inspection, restock versus quarantine, credit/refund limits and exchanges |
| Branding and engineering | Approval/revision preservation, fixed production instructions, branding QC before shipment |
| Outsourcing | Issued material custody distinct from consumption, partial deliveries, accepted goods movements |
| Repairs | Customer-owned goods excluded from sellable stock, material consumption, roll traceability |
| Documents | Approval-time snapshots, immutable issued data, document/PDF permissions |
| Dashboard, CSV | Outstanding after credits/refunds, warehouse aggregation, fulfillment count, authorized exports, complete movement export |

## Verified fixes

1. Generic pages and CSV exports previously checked sign-in without checking
   the relevant module's read permissions. Central read/export rules now protect
   those entry points, sidebar links and report cards. Operational users receive
   an operational dashboard without financial totals or customer-order details.
2. Movement CSV exports previously reused a list limited to 100 rows. They now
   export the full journal; a 105-movement API regression verifies this.
3. Invoice exports now include the original order currency and order number.
4. Low-stock counts previously counted warehouse rows independently. They now
   compare each material's total available company stock with its minimum once.
5. Fully shipped orders awaiting payment no longer count as awaiting fulfillment.
6. A linked unbranded draft sales order could reserve production materials.
   Draft manufacturing plans remain possible, but material reservation requires
   a confirmed sales order.
7. Referenced material units and variant product/size/color could be changed,
   reinterpreting historical transactions. PostgreSQL now prevents those identity
   changes while permitting ordinary descriptive/price maintenance.
8. The operational warehouse used to be whichever UUID sorted first. Company
   settings now pin it explicitly; migration preserves the previously selected
   warehouse. Ambiguous unconfigured multi-warehouse posting fails with an
   actionable error. Switching it with outstanding reservations is prohibited.
9. Dashboard and shared report reads now use a repeatable-read, read-only
   PostgreSQL transaction, rather than combining independently committed reads.

No second quantity store was introduced. Inventory balances and document
counters remain projections of the existing movement ledger and transaction
records. The new consistency checker only reports differences; it never changes
stock.

## Operational limits and remaining work

- Existing invoicing supports fully dispatched orders, not partial invoices.
  Returns requiring an invoice therefore cannot cover uninvoiced partial orders.
- Purchasing immediately makes received goods available; incoming QC is a
  subsequent step. Rejections fail if goods have already been reserved or used.
- Core operations use the configured operational warehouse. This does not
  implement transfers or full multi-warehouse order routing.
- General balances are maintained by the transactional posting service. The
  checker detects direct-SQL drift; not every untracked stock projection has a
  database-level deferred ledger equality constraint. Direct database writes
  must follow the posting workflow.
- Operational modules have dedicated views; the central dashboard/CSV report
  catalog does not yet aggregate every specialist module into shared KPIs.
- Legacy snapshots and recovered supplier prices remain explicitly unavailable
  where original evidence was not persisted.
- Distributed multi-worker contention and throughput were not load-tested.
  Core writes serialize on the operational warehouse row.
- Hosted Vercel deployment is not verified by these checks.

Run `npx tsx scripts/check-consistency.ts` for a read-only reconciliation report.
Exit status is nonzero when a check detects violations. It prints aggregate
counts only; it does not print credentials or business identities.
