# Warehouse transfer integration design

Current status: tested transition/allocation helpers only. No live route, stock posting action, schema or migration is introduced by this implementation. Existing stock stays authoritative. Stage6 depends on the incoming-quality hold implementation and centralized database review.

## Implemented helper contract

`planTransferDispatch` validates distinct warehouses, unique source balances, positive4-decimal quantities and unreserved stock excluding the existing balance's quality hold. Finished garments require whole units. Roll-tracked balances are explicitly rejected until the traceability adapter is complete.

`assertTransferAction` permits dispatch/cancel only for Draft, and receipt only for Dispatched/Partially Received. `planTransferReceipt` calculates cumulative partial receipts exactly, normalizes receipt references and rejects duplicates or excess receipts. These pure helpers do not provide persistence, locking, RBAC or idempotency by themselves.

## Central schema proposal

- `stock_transfers`: UUID, stable number, source/destination warehouse FKs, immutable dispatched terms, Draft/Dispatched/Partially Received/Received/Cancelled status, creator and timestamps. Source differs from destination.
- `stock_transfer_items`: transfer FK, source balance FK, fixed item identity/quantity, cumulative received projection. Quantity positive; received between0 and dispatched quantity. Item unique per transfer/source balance.
- `stock_transfer_receipts`: item FK, positive quantity, receipt reference, unique operation key, actor/timestamp and destination movement FK. Normalize document reference and use uniqueness scoped to transfer+reference+line.
- Roll dispatch allocation: source roll FK, exact original sections, quantity and immutable origin metadata. Destination receipt must retain original source link plus sections and create a linked child roll for partial receipts, avoiding duplicate global roll numbers. Roll movement records link each source debit and destination credit to the transfer line.

In-transit quantity is derived from dispatched item quantity minus received quantity and explicitly resolved shortages. It is not an additional available warehouse balance. No generic mutable “transit stock” counter is needed.

## Posting adapter requirements

Expose create/edit/cancel/dispatch/receive actions through existing transactional `execute` wrapper and Inventory RBAC. Lock the transfer and both warehouse rows in UUID order before any stock/roll locks; coordinate common operational lock order first to avoid deadlock with existing primary warehouse serialization. Fetch source/destination balances under row lock inside the same transaction, then call planning helpers.

Dispatch appends one source debit per line, preserving reserved/held quantities. Receipt appends the destination credit only for physically received amounts. Both retain immutable transfer documents and movement IDs, and preserve existing actor/fingerprint operation-key retries. Independent receipt requests with the same document reference must be rejected by DB uniqueness, not only an application lookup. A draft does not reserve stock: availability is checked under lock at physical dispatch.

Once goods leave, cancellation never restores stock. Deficit resolution requires a separately authorized, append-only evidence document and clears in-transit custody without increasing destination stock. Physical return uses a reverse transfer. Never let a generic adjustment silently clear outstanding transfer custody. Reconciliation must compare transfer allocations and both ledgers; source losses must not be posted again as warehouse losses.

## Acceptance still required for live rollout

Real PostgreSQL tests: duplicate dispatch keys, competing transfers consuming the same source stock, concurrent partial receipts, duplicate receipt document references, full rollback on invalid multi-line receipt, migration chain, variant stock and roll section reconciliation, quality-held stock rejection, shortage evidence and reverse transfer. UI: draft/edit, physical dispatch confirmation, outstanding/received quantities, partial receipt, immutable history, server permission failures and mobile accessibility. No production mutation is authorized by these helpers.
