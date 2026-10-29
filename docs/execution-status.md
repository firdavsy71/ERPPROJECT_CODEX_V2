# ERP improvement execution — 29 October 2026

The approved implementation plan covers authentication diagnostics, isolated Neon/storage verification, incoming material inspection holds, database integrity, partial invoices/returns, multiwarehouse transfers, localization/UI and reporting/performance.

| Stage | Owner | Status / gate |
| --- | --- | --- |
| 1 Authentication and secrets | sessions_storage | Implementing safe diagnostics and recovery tests. Password rotation and deployed Vercel log investigation require unavailable management access. |
| 2 Isolated Neon / private Blob | Lead + sessions_storage | Blocked externally: no Neon/Vercel management connector or API credential; local Blob token absent. No synthetic production writes. |
| 3 Incoming quality holds | incoming_quality_hold | Implementing integrated stock/roll holds and inspection/disposition workflow. Central migrations follow schema review. |
| 4 Database integrity | database_safety + Lead | Implementing transactional migration serialization; ledger hardening follows held-stock model. |
| 5 Partial invoicing / RMA | invoice_expansion | Dependency analysis and exact allocation regression; activation requires coordinated invoice schema, returns, documents and UI migration. |
| 6 Multiwarehouse transfers | warehouse_transfers | Dependency analysis and lifecycle validation; activation follows quality-hold and stock posting integration. |
| 7 Localization / UI | localization_reports + Lead | Incremental structured labels and report controls; no claim all specialist screens translated. |
| 8 Reports / read performance | localization_reports | Implementing validated date/warehouse report filters and authorization regressions. |

Production schema changes are centralized. Each stage must pass targeted regressions, typecheck, lint and production build before publication; stock/financial changes also require full integration suite. Applied migration history is not rewritten. The full plan is not complete until all remaining gates are executed and recorded.

## Verified implementation result

- Stages1/3/4: safe authentication diagnostics and explicit auth-unavailable response; new receipt/roll quality holds, partial acceptance, rejected-material disposition; immutable disposition evidence; database-deferred journal/balance equality including held quantities and roll totals; migration-runner transaction/advisory serialization. Implemented and tested locally, not deployed.
- Stage8: validated business-date and warehouse CSV filters with report-workspace controls. Current stock reports deliberately reject historical date ranges. Broad scoped read-model/server-pagination work remains.
- Stage5/6: tested cumulative invoice allocation and transfer transition/quantity helpers only. No multiple-invoice schema, transfer posting endpoint or live UI is activated. These are preparation, not completed modules.
- Full suite149/149 across25 files; after final SQL disposition guard, procurement8/8 rerun passed. Typecheck/build passed; lint0 errors with existing TanStack warning. Browser procurement/recovery and primary workflow3/3 passed on isolated local PGlite. New local migration runner applied chain successfully.
- Runtime read-only database SELECT1 succeeded. Configured database is Neon with TLS required. Blob token, Vercel management credential and Neon API credential unavailable; no isolated Neon branch, secret rotation, live Blob verification or deployed-auth root-cause verification performed.
- Central migrations0023–0025 are unexecuted on production. Existing production records were not modified. Apply them only after the isolated Neon validation gate and coordinated code rollout; old application receipt snapshot fallback marks legacy non-held receipts explicitly.

Next executable gate: provide protected management access or an isolated Neon test-branch connection in secure environment configuration, run the complete migrated Neon business scenario and concurrent migration check, then deploy this batch. Remaining plan: activate coordinated partial invoicing/RMA/documents, transfer schema/posting/roll trace UI, full localization and scoped report reads. Secrets must not be sent in chat.
