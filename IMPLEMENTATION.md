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

- Foundation implemented: Next.js, 29 PostgreSQL tables, migrations, Auth.js, RBAC and application shell.
- Master-data and inventory baseline implemented, including movement ledger, adjustments and archival.
- Manufacturing and commercial vertical workflow implemented and tested at the service layer.
- Dashboard and CSV baseline implemented; broader analytics remain outstanding.
- Validation: 13 integration tests passing, type checking and production build passing; lint has no errors and one TanStack/React Compiler compatibility warning. Production dependency audit reports zero vulnerabilities.
- Both local browser tests pass: protected access and the complete UI workflow from customer/product creation through production, shipment, payment and live dashboard updates. Neon connectivity, migrations, administrator bootstrap and transaction rollback are verified through the official Neon WebSocket driver. Public hosting remains outstanding.

The remaining items in README are deliberately explicit; passing the implemented vertical workflow does not imply completion of the entire specification.
