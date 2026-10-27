# Workwear ERP implementation

The supplied specification is the target. Initial implementation prioritizes a persisted vertical workflow with server-side permissions and transactional stock accounting.

1. Foundation: Next.js, TypeScript, Drizzle/PostgreSQL, migrations, Auth.js, RBAC, responsive shell.
2. Master data: products/variants, customers, suppliers, employees, materials, warehouse.
3. Inventory: movement ledger, reservations, guarded adjustments.
4. Manufacturing: immutable BOM, reservation, start, quality approval, idempotent completion.
5. Commercial: sales, purchasing/receipts, shipment, invoices/payments.
6. Reporting: database-backed dashboard, reports, CSV.
7. Validation: integration tests, security tests, lint, types and production build.

See README for tested capabilities and remaining scope. No claim of production readiness is made until Neon deployment and the full acceptance suite are verified.

## Current progress

- Foundation implemented: Next.js, 36 PostgreSQL tables, migrations, Auth.js, RBAC and application shell.
- Master-data and inventory baseline implemented, including movement ledger, adjustments and archival.
- Manufacturing and commercial vertical workflow implemented and tested at the service layer.
- Dashboard and CSV baseline implemented; broader analytics remain outstanding.
- Validation: 39 integration tests and 4 browser tests passing, type checking and production build passing; lint has no errors and one TanStack/React Compiler compatibility warning.
- Both local browser tests pass: protected access and the complete UI workflow from customer/product creation through production, shipment, payment and live dashboard updates. Neon connectivity, migrations, administrator bootstrap and transaction rollback are verified through the official Neon WebSocket driver. Public hosting remains outstanding.

The remaining items in README are deliberately explicit; passing the implemented vertical workflow does not imply completion of the entire specification.

Product engineering: structured specifications, six garment families, variant overrides, immutable approvals, real attachments, printable sheets and BOM/manufacturing/QC references are implemented. Regression suites cover version locking, roles, composition, concurrency, uploads, fixed production references, QC acceptance and browser printing. Implementation details and safe test commands: docs/technical-specifications.md.

Custom branding: sales-line design versions, decoration/color/tape requirements, decimal pricing, recorded customer approval, private Vercel Blob assets and metadata, immutable production references, QC and branded shipment checks are implemented. Tests cover approval/rejection/revisions, price freeze, immutable files, checksums and rollback; browser tests cover draft/revision and storage-unconfigured handling. Live file-provider verification awaits the private store/token. See docs/custom-branding.md.
