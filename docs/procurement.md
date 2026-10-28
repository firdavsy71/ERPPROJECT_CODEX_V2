# Supplier performance and procurement costs

Each new purchase receipt captures its purchase line, warehouse movement,
quantity, supplier unit price, order currency, promised delivery date and order
placement timestamp. Original order prices and receipt evidence are immutable
after placement. Partial receipts are measured separately. On-time delivery is
the fraction of receipts with a known expected date received on or before that
date in the company timezone; unknown due dates are excluded. Lead time is the
calendar-day difference between placement and receipt in the same timezone;
unknown placement dates are excluded.

The migration recovers older receipt quantities only where a purchase line and
its stock movement match exactly. Old unit prices, due dates and placement
times cannot be proven from immutable snapshots, so these are shown as unknown.
The same applies to newly received goods from orders placed before this module:
their purchase terms were not protected when the order was placed.
No landed costs can be added to those recovered receipts until evidence-backed
historical pricing is supported; no values are invented.

Existing purchase receipts immediately add goods to available inventory.
Inspections can record accepted and rejected portions incrementally. Rejected
goods are deducted from available inventory in the same transaction; a
rejection fails if the material is already reserved or consumed. For
roll-tracked fabric, the operator must select the affected roll from the same
receipt line. The ledger and roll records are updated together. A rejection
automatically creates a supplier quality incident; additional incidents can be
recorded separately. This is not a pre-receipt quarantine workflow.

Freight, customs, handling and other expenses are entered against a receipt in
its purchase currency. Each expense is allocated among the receipt lines in
proportion to each line's received quantity multiplied by its original unit
price, rounded to cents per line. Cumulative rounding guarantees allocations add
up exactly to the expense. Expenses require a positive known supplier value and
a unique external reference. Different currencies are never converted or added
together. Historical costs and allocations are immutable.

The landed-cost report is gross receipt cost: supplier value plus allocated
expenses, including material later rejected. It does not modify original
supplier prices, inventory valuation, or accounting entries, and is not a
realized cost-of-goods ledger. The per-unit figure divides that gross total by
the quantity received. Quality rates use inspected quantities only and are
reported separately by supplier and material to avoid adding incompatible
units. Lead-time, price and quality comparisons should be made only for
comparable units and currencies.
