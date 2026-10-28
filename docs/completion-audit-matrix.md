# ERP completion audit — 28 October 2026

Three independent read-only audits completed before implementation: database architect, business logic, frontend/security. No verified P0 was found. Existing uncommitted implementations were preserved. P0 means blocked core operation or critical security/data loss; P1 means material integrity/access defect; P2 is a functional or scalability gap; P3 is polish or expansion.

| Module | Existing functionality | Missing functionality / bugs | Priority | Dependencies | Recommended fix | Required tests |
| --- | --- | --- | --- | --- | --- | --- |
| Database inventory | Atomic posting, reservations, reconciliation, roll guards | Untracked journal rows mutable via SQL | P1 | Central migration | Immutable journal trigger; corrections append | Material/variant update/delete rejection, normal posting |
| Payments | Decimal partial payments, invoice lock, operation keys | Same bank reference can post twice with new key | P1 | Invoice lock, migration | Normalize comparison, reject invoice/reference duplicate | Same-key retry, duplicate new key, valid partial receipts |
| Returns security | Physical receive/inspection, financial settlements | Operational roles receive financial amounts and bank references | P1 | Existing invoice permissions | Gate financial queries and serialized props | Production/inventory operational-only; sales/admin finance |
| Products/BOM/purchasing/sales | Existing catalog and transactional documents | New documents accept archived entities | P1 | Master active flags | Validate new-document parties/items; retain historical fulfillment | Archived rejection and atomic rollback |
| Manufacturing | Frozen specification/BOM, material reservations, QC output | Stale draft may plan against fulfilled sale | P2 | Linked sales state | Recheck terminal state on plan | Fulfilled linked sale rejects planning |
| Inventory hardening | Service-maintained balance/journal equality | General deferred equality guard absent | P2 | Runtime DB permission/constraint design | Design deferred checks after data preflight | Balanced transaction succeeds; direct drift rejected |
| Purchasing QC | Receipt snapshots and subsequent inspection | Received stock usable before incoming QC | P2 | Existing stock truth, reservations | Design inspection hold without second stock source | Partial accept/reject excludes uninspected stock |
| Invoices/returns | Full-order invoice and delivered-item RMA | Partial invoices unavailable | P2 | Invoice lines/tax/snapshots | Coordinated partial invoicing | Partial credit/tax rounding and RMA eligibility |
| Database operations | Ordered migrations and Neon transaction pool | No advisory migration serialization; selected FK indexes/checks absent | P2 | Central migration runner | Session-safe runner lock, evidence-based indexes/checks | Concurrent runners; invalid quantities; query plans |
| Frontend | Real forms, tables, role-aware navigation | Unnamed dialog/error association; mobile logout hidden | P2 | Shared form/shell ownership | Accessible names/errors; visible mobile signout | Keyboard/dialog and narrow viewport tests |
| Localization/reports | RU/UZ/EN infrastructure, documents, currencies | Some labels/statuses untranslated; broad generic read models | P3/P2 | Dictionaries and scoped queries | Localize labels; minimize authorized reads | Locale tables, unauthorized data never serialized |
| Multiwarehouse | Configured primary operational warehouse | Transfers and routing absent | P3 | Inventory allocation design | Separate coordinated transfer feature | Transfer ledger/reservation reconciliation |

## Implementation ownership

- Business worker: operations.ts and core-validation.test.ts; payment validation, active-record validation, terminal planning.
- Security worker: returns detail page and return-page-access.test.ts; financial read boundary.
- Database worker: ledger-integrity.test.ts only; journal immutability regression.
- Lead: migration generation/application, common integration, matrix and final verification. Workers cannot apply production migrations.

## Verification scope

The existing service workflow exercises catalog/BOM, purchasing/receipt, demand, material reservations, production/QC, finished inventory, shipment, invoice and payment in isolated PostgreSQL-compatible PGlite databases. This does not prove Neon persistence or hosted deployment. Neon requires a separately executed verification; results must be stated explicitly. Production seed/reset operations are prohibited.

## Executed results

- Baseline complete suite:118/118 passed across16 files. After fixes:8/8 new regressions passed; business worker additionally reran21 existing core workflow tests with3 new tests,24/24 passed.
- Final typecheck, lint and production build passed. Lint retains one existing TanStack incompatible-library warning.
- Primary browser suite:2/2 passed on isolated migrated/seeded PGlite at /tmp/erp-audit-20261028-v2, including authentication and persisted sales/production/shipping/invoice/payment UI workflow.
- Additive migrations0021 and0022 applied successfully to configured Neon.0021 extends historical identity protection;0022 makes all inventory movements immutable and rejects new duplicate normalized payment references per invoice. Existing history is retained; historical duplicates are not deleted or rewritten.
- Neon read-only reconciliation before and after migration:all ten checks zero violations. The complete synthetic business workflow was not written into the shared Neon business database. A dedicated isolated Neon test branch is still required to verify every workflow operation against Neon without polluting business records.
- No deployment verification or publication performed in this batch. Existing dirty changes remain preserved.

## Implemented first batch

Payment duplicate guard, archived-record checks for new core documents, terminal linked-sales planning guard, financial return read isolation, and database journal immutability are implemented. Root reviewed worker ownership boundaries and ran integrated verification. No verified P0 remained from these three audits; P1 fixes were prioritized.

Next batch: isolated Neon branch workflow verification; incoming-QC hold design; partial invoicing/RMA coordination; mobile sign-out and form accessibility; scoped reads and selected database constraints/indexes. Deferred balance-ledger equality and migration-runner serialization require dedicated database concurrency tests.
