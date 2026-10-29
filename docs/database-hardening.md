# Database hardening and migration execution

## Implemented migration serialization

The runner loads the existing Drizzle journal through `readMigrationFiles`, then
executes migration metadata creation, last-applied lookup, pending DDL and journal
inserts in one database transaction. PostgreSQL acquires
`pg_advisory_xact_lock(1163022413, 1)` before any metadata access. A 60-second
transaction-local lock timeout fails a blocked runner without applying changes.
The transaction releases its lock automatically on commit, rollback or connection
loss. This works with transaction-pooled Neon URLs because the transaction pins
the backend connection for the complete critical section.

A session lock acquired through a pool, followed by the standard Drizzle migrator,
would not be sufficient: the migration history is read outside the migrator's
internal transaction, and a transaction pool can assign a different PostgreSQL
session between queries. The new runner uses public Drizzle transaction/SQL APIs
and retains the established `drizzle.__drizzle_migrations` schema/table/hash/time
format. Applied migration files are not rewritten. PostgreSQL DDL and history
updates roll back together. PGlite explicitly skips advisory locking, which it
does not implement; local test concurrency is not proof of PostgreSQL locking.

Validation executed: three tests for real PGlite migration idempotency, atomic
DDL/history rollback, and a simulated two-runner lock/history race. The simulation
checks that the second runner reads history after the first commits; it is not a
live PostgreSQL/Neon concurrency test. TypeScript and scoped ESLint passed.
Before production rollout, run two migration processes against the isolated Neon
test branch and verify each migration is applied only once, and that rollback
releases the lock for the waiting runner. This agent performed no production writes.

## Proposed centralized integrity migration

Lead owns schema and migration changes. Add the following only after the new
hold columns are finalized and a read-only preflight reports zero violations:

1. Bounds on balances: `held >= 0` and `reserved + held <= on_hand` alongside
   existing nonnegative bounds. Hold deltas belong in the existing movement
   journal, not an unrelated inventory counter.
2. A validator taking one balance UUID compares `on_hand` with the sum of journal
   `quantity`, `reserved` with `reserved_delta`, and `held` with `held_delta`.
   Treat missing sums as zero and raise an integrity exception on mismatch.
3. DEFERRABLE INITIALLY DEFERRED constraint triggers call that validator on balance
   INSERT/UPDATE and movement INSERT, allowing balance and journal to be posted in
   either order inside one transaction. Existing movement UPDATE/DELETE guards
   remain. A direct balance-only write must fail at transaction commit.
4. Production reservation `quantity >= 0`, `consumed >= 0`; quality inspection
   `approved >= 0`, `rejected >= 0`. Do not assume consumed is bounded by planned
   quantity: existing explicitly recorded excess consumption can be legitimate.
5. Reconciliation FK indexes should be chosen after examining actual query plans:
   movement balance ID, sales-line order ID, MO sales-line ID and production
   reservation balance ID are candidates. Avoid redundant index generation.

The preflight query for the three projection fields is structurally:

```sql
SELECT b.id
FROM inventory_balances b
LEFT JOIN (
  SELECT balance_id, sum(quantity) AS on_hand,
         sum(reserved_delta) AS reserved, sum(held_delta) AS held
  FROM inventory_movements GROUP BY balance_id
) m ON m.balance_id=b.id
WHERE b.on_hand<>coalesce(m.on_hand,0)
   OR b.reserved<>coalesce(m.reserved,0)
   OR b.held<>coalesce(m.held,0);
```

This query is a proposal for the hold-enabled schema, not SQL to run against the
older schema. Historical inconsistencies must be reported for explicit resolution,
never silently reset or backfilled from guessed operational events. Test deferred
checks at commit (not merely mid-transaction), balanced postings, multi-line
rollback, partial QC acceptance/rejection, extra actual consumption, cancellation,
outsourcing custody, returns and concurrent same-balance posting.
