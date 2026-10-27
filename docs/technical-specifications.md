# Product engineering implementation

Plan: schema + immutable versions → engineering editor, attachments and printable sheets → BOM/production/QC integration → integrity/security regression tests → Neon migration and runtime validation.

Technical specifications reuse existing product and variant IDs. A version contains a structured garment document and covered variant records with fabric consumption, size-specific measurement overrides and manufacturing instructions. Six garment types are supported; two-piece sets use component names in construction, measurement points and seam locations.

Drafts are editable with optimistic revision checks. Submit freezes editing pending review. Administrators approve or reject; production managers can author, revise and submit. Approved versions and their attachments/variant contents are immutable at the PostgreSQL trigger layer as well as in services. Revisions create separate drafts and preserve historical versions.

New manufacturing orders require a matching approved version. Blank selection resolves the BOM's fixed specification or the latest approved version covering the variant; the resolved ID is persisted permanently. A BOM may optionally fix an approved specification. Variant fabric consumption is an engineering requirement, while material reservation quantities continue to come from the BOM; changing one does not silently rewrite the other.

Existing manufacturing orders retain historical data without inventing approvals. Open legacy orders missing a reference must explicitly bind an approved matching version before progressing. Finished legacy records are retained as legacy records.

Quality completion records every frozen acceptance criterion with Pass/Fail results. Positive approved output requires every criterion to pass. Operators can consult the linked technical sheet, effective size measurements, fabric details, instructions and drawings while inspecting.

Attachments are actual PostgreSQL-backed uploads, limited to 12 files of 2 MiB per version. PNG/JPEG/PDF signatures are checked; SVG/HTML and arbitrary remote URLs are not accepted. Read routes require authentication, writes require engineering permissions and same-origin requests. Approved attachments cannot be replaced. PDF attachments download separately; PNG/JPEG drawings print with the technical sheet. Printing uses the browser's Print / Save as PDF facility.

The additive migration does not backfill fake technical specifications. No existing product or BOM records are duplicated. Source validation uses Zod and decimal composition totals. Do not run browser tests against production business data; use a separate seeded development database.

Validation commands for the isolated browser database (POSIX shell):

```sh
npm test
npm run typecheck
npm run lint
npm run build
DATABASE_URL='' PGLITE_DATA_DIR=.local/specification-e2e npm run db:migrate
DATABASE_URL='' PGLITE_DATA_DIR=.local/specification-e2e npm run db:seed
DATABASE_URL='' PGLITE_DATA_DIR=.local/specification-e2e PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Stop the server on port 3000 before running browser tests. The test runner starts its own server. Browser tests refuse a nonempty `DATABASE_URL` and generate `.local/technical-sheet.pdf` to exercise printing. Use your installed Chromium path or omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` after installing Playwright browsers.
