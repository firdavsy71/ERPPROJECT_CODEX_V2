# Report filter contract

CSV exports accept optional `from=YYYY-MM-DD`, `to=YYYY-MM-DD` and `warehouseId=<UUID>` parameters. Authentication and report authorization precede filter validation and warehouse lookup.

Transaction reports (sales, manufacturing, purchases, invoices and movements) use the persisted record creation timestamp, converted to the configured company business timezone. Both calendar boundaries are inclusive. A one-sided period is supported; reversed, malformed and impossible dates return400. These dates do not mean invoice due date, shipment date or manufacturing completion date.

Warehouse filtering is supported only for movements, current inventory and materials. Movement filtering uses the movement's actual balance/warehouse; current inventory uses balance warehouse. Material catalog filtering includes materials with a balance record in the chosen warehouse, even if current quantity is zero. It does not invent a historic stock snapshot. Unknown warehouses return404; unsupported report/warehouse combinations return400.

Current stock/catalog reports reject date filters rather than implying historical availability. Use the movement report for a dated journal. Response headers expose `X-Report-Time-Zone` and `X-Report-Basis` (`created-at` or `current-state`). Monetary values and currencies remain preserved; filters do not convert currencies or recalculate original transaction values.

Existing no-filter URLs continue exporting full data, including the complete movement journal. Shared on-screen date/warehouse filter controls require separate integration in the reports workspace; this change adds the validated API contract, not a claim of historical stock reporting or universal pagination.
