# Workwear ERP

A working first implementation of the supplied manufacturing ERP specification. It includes persisted master data and a transactional purchasing → manufacturing → shipment → invoicing workflow. This repository is under active development; it is **not yet a complete production implementation of every requirement**.

## Start locally

Use Node.js 24 (Node 22 is also compatible with Next.js 16).

```sh
npm ci --cache /workspace/.npm-cache
npm run setup:local
npm run db:migrate
npm run db:seed
npm run dev
```

`setup:local` creates an ignored `.env.local` with a random authentication secret, a random administrator password, and a persistent PGlite database at `.local/postgres`. Read `ADMIN_EMAIL` and `ADMIN_PASSWORD` from that file to sign in. Existing configuration is preserved. No password is hardcoded or printed in logs.

PGlite runs actual PostgreSQL in-process; it is a local development option, **not Neon**. It persists across restarts but only one process should own its directory. Stop the app before running local migrations or seed commands. Never use local file storage on Vercel.

For an empty database without example data, use `npm run db:bootstrap` instead of `db:seed`. Bootstrap preserves existing administrator passwords. The development seed adds 10 products, 30 size variants, five materials, opening-balance ledger entries, a customer, a supplier and a versioned jacket BOM. Repeating it preserves stock transactions and avoids duplicate catalog records.

## Neon and Vercel

1. Create a Neon project and an isolated development database/branch.
2. Set `DATABASE_URL` to the PostgreSQL connection string from Neon, with TLS enabled (`sslmode=require`). Neon hostnames use Drizzle with the official Neon Serverless Pool over secure WebSockets, supporting interactive transactions. Standard PostgreSQL hostnames use `postgres.js` with prepared statements disabled. The Neon transport honors `HTTPS_PROXY` / `HTTP_PROXY` when configured, preserving TLS verification.
3. Set `AUTH_SECRET` to a cryptographically random secret, `AUTH_URL` to your application origin, and `ADMIN_EMAIL` / `ADMIN_PASSWORD` for bootstrap. Passwords must have at least 12 characters. Set secrets in your environment manager; do not commit them or paste them into chat.
4. Run `npm run db:migrate` and `npm run db:bootstrap` against the intended database. Migrations are checked into `drizzle/` and can be reapplied safely. Do not run migrations as part of every HTTP request.
5. Import the repository into Vercel, select the Next.js preset, configure `DATABASE_URL`, `AUTH_SECRET`, and `AUTH_URL` for the appropriate deployment environments, then build with `npm run build`. Use distinct development/preview and production databases.
6. Remove bootstrap credentials from runtime settings after creating your administrator. Configure network access to your exact Neon hostname if your execution environment restricts outbound traffic. Neon connections require secure WebSocket access on port 443; standard PostgreSQL connections require TCP access. The database driver needs the actual connection string, not an HTTPS proxy-secret placeholder.

For example records in a **development Neon branch only**, explicitly run `SEED_DEMO_DATA=1 npm run db:seed`. The seed refuses `NODE_ENV=production`. Production bootstrap never creates demo products or inventory.

Neon connectivity, schema migrations, administrator bootstrap and transaction rollback have been verified against the configured database. Public Vercel deployment remains unverified. Do not treat a local PGlite test as a deployment test.

## Architecture

- Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4.
- shadcn-compatible Button using Radix Slot and CVA, Lucide icons, TanStack Table, React Hook Form, Zod, Recharts.
- Auth.js credentials provider, bcrypt password hashing, signed JWT sessions expiring after eight hours. Active status and current roles are reloaded from the database on protected requests. Account-based login throttling limits attempts in a 15-minute window.
- `src/db/schema.ts`: normalized PostgreSQL entities, foreign keys, unique indexes, stock/money/status checks. `drizzle/`: versioned migrations.
- `src/services/operations.ts`: inventory, production and commercial workflows. All critical mutations lock the primary warehouse row in a database transaction, producing a deliberately conservative serialized MVP workflow. This favors correctness over high-volume throughput.
- `src/services/master.ts`: validated master-data edits, archival and user provisioning.
- `src/app/actions.ts`: authenticated Server Actions, safe responses and revalidation. Authorization is repeated at the service boundary.
- `src/services/queries.ts`: live database reads and aggregate metrics. Business data is not cached.
- Decimal.js handles money calculations; PostgreSQL `numeric` columns persist exact amounts. Currencies remain separate in reports.
- An operation key plus payload fingerprint makes repeated critical submissions idempotent. Inventory movements and audit records commit with business operations, or roll back together.

## Available workflows

Master data: create/edit/archive products, materials, customers, suppliers and employees; create product size/color/fabric variants; create/deactivate users; configure company, currency, timezone and default tax rate. Historical transactions retain foreign keys.

Purchasing: create a multi-line purchase order, place it, open its detail page and receive one or more partial quantities. Receipt quantities cannot exceed the order; repeat submissions do not double stock.

Manufacturing: create an immutable BOM version with multiple material lines; create a manufacturing order; check and reserve materials; start; record completed/defective units; inspect quality and record actual consumption for each reserved material; approve and complete. Approved products enter finished inventory, consumption leaves raw stock, and unused reservations are released. Draft/planned production can be cancelled with reservations released.

Sales: create a multi-variant order with line discounts; confirm; reserve available finished inventory; manufacture missing stock; reserve newly produced stock; ship partially or fully; generate an invoice once fully shipped; record partial/full payments. Only reserved goods can ship, and payments cannot exceed the outstanding amount. The final payment completes the sales order.

Inventory: view both raw and finished balances, available/reserved amounts and the latest 100 movements; adjustments require a reason and cannot take available stock negative. Warehousing currently uses one primary warehouse.

Dashboard: database-derived open sales, active/completed production, low-stock count, invoiced revenue by currency, outstanding balances and monthly invoiced revenue. Invoiced revenue is **not cash receipts**. Sample metrics are never hardcoded.

Reports: CSV exports of orders, production, materials, balances, purchasing, invoices and the latest 100 movements, including CSV formula-injection protection. Tables support client-side search, sorting and pagination.

## Roles

| Role               | Write access                                           |
| ------------------ | ------------------------------------------------------ |
| Administrator      | All modules, users, settings                           |
| Production manager | BOM and manufacturing                                  |
| Sales manager      | Customers, sales, invoices, payments                   |
| Inventory manager  | Materials, inventory, purchasing, suppliers, shipments |
| Viewer             | Read-only operational access                           |

Current roles share operational read access. Employee and user data need narrower read policies before use with sensitive personnel information. Credential hashes are never sent to the browser. Deactivated users lose access on their next protected request.

## Tests and validation

Current validation: 13 integration tests and 2 browser tests pass; production build and TypeScript pass; lint has zero errors and one TanStack/React Compiler compatibility warning; production dependency audit reports zero vulnerabilities. Installation with the lockfile, repeat migrations and repeat bootstrap were also exercised. The browser workflow verifies that persisted transactions update the dashboard, not merely that pages render.

```sh
npm run typecheck
npm run lint
npm test
npm run build
# Requires a seeded local development database and configured admin credentials:
npx playwright install chromium
npm run test:e2e
# Or use an already installed browser:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Integration tests use isolated in-memory PostgreSQL through PGlite, applying the real migrations. They test the complete service workflow, decimal calculations, shortage rollback, cancellation releases, actual consumption, repeat operations, server-side write permissions, database constraints, immutable BOM versions, multiple variants, and receipt rollback. Browser tests run against the production server and use the UI; they add clearly named E2E records to the development database. Never point browser tests at production.

## Remaining specification scope

The following are not yet delivered: quotations; draft-order editing/cancellation; automatic make-to-order generation and automatic reallocation after production; image uploads; variant editing/archival UI; multiple warehouses; granular read permissions and editable role definitions; user reactivation/password-reset/session management UI; full invoice line snapshots and polished printable commercial documents; server-side pagination; date-range report filters and all twelve analytical reports; configurable numbering schemes; complete dashboard widgets/analytics; full localization and consistent configured-timezone aggregation. Current reports export rows rather than a complete accounting/general-ledger system.

Master-data IDs and internal item references appear in raw CSV exports. Movement exports currently contain the latest 100 entries, not an unlimited history. The seed only provisions the administrator; create other roles in Settings. Browser tests do not yet cover every field, role or purchase receipt form. Real Neon concurrency, backup/restore, deployment, accessibility auditing and broader security review remain release gates.
