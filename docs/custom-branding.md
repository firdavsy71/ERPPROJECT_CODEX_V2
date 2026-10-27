# Customer branding workflow

Implementation plan: private provider adapter + normalized metadata → draft/revision/approval and exact pricing → Sales / engineering / manufacturing / QC links → automated tests → Neon migration and deployed UI checks. Live provider verification requires a connected private Vercel Blob store.

## Set up private storage

Use **Vercel Blob, Private access**. In Vercel, open the `erpproject-codex-v2` project → Storage, create/connect a private Blob store, and provide its `BLOB_READ_WRITE_TOKEN` for Production (and isolated Preview environments if needed). Redeploy after adding the binding. Never use a public store, a `NEXT_PUBLIC_` token, a token committed to Git, or a chat message to transfer credentials.

The application sends PNG/JPEG/PDF files through authenticated server upload routes into private Blob objects. Maximum size is 2 MiB per file, with at most 12 linked files per design version. File signatures and names are validated. SVG, arbitrary remote URLs and executable attachments are not accepted. Database rows hold provider name, a random immutable object key, original name, MIME, byte count, SHA-256, uploader and timestamp. File content is not stored in Neon and no local filesystem/public URL fallback exists.

Administrators can use **Custom branding → Check private storage**. This creates one small temporary private object, reads it through authenticated provider access, checks its hash, confirms anonymous access is refused, and deletes that exact test object. No customer or order records are created by the check. It does not disclose the token or object URL.

To verify from the cloud execution machine, bind the same token through secure environment settings and allow the Vercel Blob API and the exact private store hostname. The actual token must be available to the SDK; HTTPS proxy-secret placeholders are not a replacement for provider authentication. A binding on Vercel does not automatically appear in the cloud machine. Do not print token values while diagnosing setup.

## Sales and design

1. Create a draft sales order with existing product variants. Complete and approve the relevant product engineering specification.
2. On the order detail page, use **Request customer branding** for a sales line, or open **Custom branding → New branding request**.
3. Save a draft, upload company logo files with purpose **Logo**, then edit the design. Select embroidery, screen printing or heat transfer, chest/back/sleeve/other location, exact dimensions and datum offsets, colors, embroidery thread, and application instructions. Heat-transfer instructions should include temperature, duration, pressure and peel requirements from the actual transfer supplier.
4. Specify custom fabric color and its Pantone/RAL/customer reference, and any custom reflective tape locations, widths, color/grade and placement requirements. These are order-specific requirements, not edits to the shared product catalog.
5. Save pricing and instructions, then upload a **Design proof** for that exact draft revision. Reference files can also be attached. Any later draft save invalidates older proofs; a new proof is required. Copying a version retains original logos/references but deliberately does not copy the proof.
6. Submit for review. A Sales Manager or Administrator records the customer's approver and explicit approval reference (email, signed proof or ticket), then approves, or rejects with a reason. This is an employee-recorded external approval, not a customer portal or electronic signature service.
7. Confirm the order after all requested branding designs have approved versions.

Draft edits use optimistic revisions. Review freezes edits; approved versions, their links and asset metadata are protected by PostgreSQL triggers. Changes require a separate version. Rejected versions can also be copied into new drafts. Version history and audit events retain prior customer approvals.

## Pricing

All money uses Decimal.js and PostgreSQL `numeric`, in the sales order's currency.

`branding total = order-line quantity × (sum of decoration unit prices + fabric surcharge + reflective surcharge) + sum of one-time setup prices`

Approval applies the computed branding charge to the draft sales line exactly once and recalculates the order total from merchandise lines plus branding charges. Existing merchandise discounts do not discount the separate decoration service. Invoices use the resulting order total and the existing explicit tax rate. Setup is charged once per order line, not once per manufacturing lot.

After order confirmation, per-unit and setup prices are frozen. Same-price instruction revisions can be approved for future production. Pricing amendments require a separate draft order; this feature does not silently alter invoiced or confirmed commercial records. Closed orders cannot receive new design revisions.

## Manufacturing and quality

Manufacturing orders for a branded sales line require an approved matching branding version. The current approved version is selected by default, or an explicit approved historical version may be selected. Its product engineering version must match the manufacturing/BOM specification. The resolved branding ID, sales line and engineering reference are fixed; later design approvals never rewrite an active order.

The production page shows the exact customer artwork, approved proof, placement/application instructions, custom colors/tape and the manufacturing lot quantity separately from the overall order quantity. A separate printable branding sheet is available. Quality acceptance must confirm branding matches the fixed proof before accepting units.

Branded quantities cannot ship before sufficient approved, completed manufacturing output exists for the same sales line. Existing generic-stock sales remain unchanged. This is not a new warehouse lot/serial tracking system: operators must physically pick the customer-specific output identified by the linked manufacturing instructions.

The production quantity guard counts accepted output from completed jobs and planned quantities from open jobs. Rejected garments can therefore receive replacement production without exceeding the outstanding order requirement or charging setup again.

New branding must be requested before order confirmation and before any manufacturing is assigned to that line. This prevents retroactively changing instructions on already active unbranded production.

## File access, integrity and retention

Admins, Sales, Production and Inventory roles can read branding documents/files; Viewer has no branding access. Sales and Admin author designs; Sales and Admin record customer approval. Downloads require an active application session and permitted role. Files are read through the private provider and verified against their stored size and SHA-256 before being served with private/no-store, nosniff headers. PDF files download; raster images can appear in the printable sheet.

Unlinking a draft file does not delete an object that may be referenced by historical versions. Approved files cannot be unlinked or overwritten. A failed upload is cleaned up only when the database confirms that no metadata was committed. If commit state cannot be determined, the private object is retained for operator reconciliation rather than risking an approved file. Automated broad deletion/retention cleanup is intentionally not provided.

## Validation and current limitations

`npm test` runs real PostgreSQL migrations and services in isolated PGlite databases. Branding tests inject an in-memory provider adapter **only in test code** to verify approval/rejection, pricing/invoices, optimistic edits, stale proofs, immutable versions, historical manufacturing references, permissions, asset ownership, checksum failure and upload rollback. This does not establish live Vercel Blob connectivity.

The Playwright suite uses an isolated local database with Blob deliberately unconfigured, tests branding drafts/revisions and safe failure of proof approval, and retains all existing product engineering / production workflows. Example commands:

```sh
DATABASE_URL='' PGLITE_DATA_DIR=.local/branding-e2e npm run db:migrate
DATABASE_URL='' PGLITE_DATA_DIR=.local/branding-e2e npm run db:seed
npm run build
DATABASE_URL='' BLOB_READ_WRITE_TOKEN='' PGLITE_DATA_DIR=.local/branding-e2e PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Stop other servers on port 3000 first. Live uploads and real provider verification remain blocked until the private Blob store/token are connected. No mock upload endpoint is exposed in the application. The feature supports authoring proofs as externally prepared files; it does not draw or generate customer artwork automatically.
