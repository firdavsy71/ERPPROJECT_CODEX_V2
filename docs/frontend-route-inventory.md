# Frontend route inventory and visual QA

Scope: current Next App Router pages, using real application actions/data. Screenshot fixtures are an isolated seeded PGlite database, not customer production data.

## Core routes

The dynamic `/(erp)/[module]` and `[module]/[id]` routes cover dashboard, sales, customers, products (including variant creation/editing), manufacturing, BOM versions, raw materials, finished inventory, purchasing, suppliers, invoices (including payment forms), reports, employees, settings and administrator users. Warehouses are configured within settings/master management; no separate warehouse route is invented.

## Specialist routes

| Area | Implemented screens |
| --- | --- |
| Engineering | /specifications, /specifications/new, /specifications/[id] |
| Branding | /branding, /branding/new, /branding/[id] |
| Fabric | /fabric-rolls, /fabric-rolls/[id], /fabric-rolls/receive/[id] |
| Cutting | /cutting, /cutting/[id] |
| Labor | /production-operations, /production-operations/[id] |
| Outsourcing | /outsourcing, /outsourcing/[id], /subcontractors, /subcontractors/[id] |
| Pricing | /pricing, /pricing/[id], /quotations, /quotations/[id] |
| Delivery | /deliveries, /deliveries/[id] |
| Returns | /returns, /returns/[id] |
| Repairs | /repairs, /repairs/[id] |
| Compliance | /compliance, /compliance/[id] |
| Supplier evaluation | /supplier-performance |
| Documents | /documents/[kind]/[id], /invoices/[id]/print |
| Authentication | /login; / redirects according to application entry logic |

## API surfaces retained

Authentication, CSV reports, company logo, specification attachments, branding files/storage check, delivery proofs, compliance attachments and document PDF handlers remain backend integrations; redesign does not replace them. Theme preference and authorized command search are new UI integration endpoints owned by lead.

## Visual verification procedure

`scripts/capture-redesign.ts` records before dashboard screenshots at1440 and390px when run with an already-running isolated local server and DATABASE_URL empty. `e2e/redesign.spec.ts` records dashboard, products, manufacturing, materials, sales, customers, invoices, settings, inventory, BOM, purchases and reports in light/dark at1440/768/390px. It discovers available persisted product/manufacturing/sales/customer/invoice detail records; unavailable detail fixtures are explicitly annotated rather than fabricated. The second test checks document overflow and screenshots; first checks Ctrl+K/Escape, theme persistence and mobile signout.

Screenshot generation is not equivalent to visual inspection or WCAG conformance. Lead must inspect accepted images and record failures/limitations; specialist detail routes and long forms require additional representative fixture coverage.

Baseline dashboard captures were saved and visually inspected at1440 and390px in `.local/redesign-before/`. Desktop showed uniform teal/white cards and a flat long navigation list. Mobile retained a64px icon rail, clipped language/user footer and oversized empty dashboard regions. These are screenshot-observed findings, not a full accessibility audit. Local baseline server was stopped after capture.

## Final screenshot review

The QA worker visually inspected12 redesigned captures from `test-results/redesign-screens-remain-re-70442-al-persisted-record-details/`: dashboard light/dark390; manufacturing detail dark1440; sales detail light390; settings dark390/light1440; product detail dark768; product catalog light1440; manufacturing overview light768; materials dark390; customer detail dark1440; invoice detail dark390. All showed loaded content and coherent theme surfaces. Mobile no longer retained the cramped icon rail. Wide tables intentionally scroll within their panels; quantities remain aligned.

Small findings reported to lead for correction: manufacturing timeline number/text gap; dark-chart point contrast; generic product/customer detail field names and raw category identifier; settings logo-control vertical spacing. Empty invoice-related tables remain visually tall on mobile and could receive a later compact empty-history treatment. This review did not inspect every specialist screen, actual screen-reader announcements or multiple browser engines.
