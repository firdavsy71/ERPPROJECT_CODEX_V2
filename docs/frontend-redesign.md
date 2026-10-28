# Industrial ERP redesign

Implementation contract: preserve existing routes, server actions, financial precision and authorization. No schema changes or fake operational data.

Visual foundation: warm background #F7F7F4, white surfaces, ink #111315, secondary #61656B, border #E3E5E3, lime #C6F567 and restrained orange #FF7648. Dark background #0B0D0F and surface #141719. Space Grotesk headings, Geist interface and Geist Mono identifiers where font assets can be licensed and self-hosted. 4/8px spacing, geometric6/10/14px radii, thin structural borders. Semantic tokens retain compatibility aliases --bg,--text,--muted,--green,--soft,--radius.

Ownership: design-system worker owns globals.css only; shell worker owns shell.tsx and command-palette.tsx; shared-controls worker owns forms.tsx and data-table.tsx; workflow worker owns module-view.tsx and revenue-chart.tsx; QA worker owns new e2e/redesign.spec.ts and route inventory. Lead owns layout, theme persistence, font assets, search service/API and integration. No overlapping writes.

Motion uses CSS tokens120–280ms, eased opacity/transform and reduced-motion overrides. Native dialogs retain keyboard/focus semantics. Mobile uses a drawer with visible logout. Every navigation item must match an existing authorized route. Record search requires server-side role filtering and returns minimal labels.

The supplied master prompt is the acceptance brief. Final verification must distinguish code coverage, browser screenshots inspected and remaining unverified screens. No universal accessibility claim based on screenshots.

## Delivered implementation

- Fonts: licensed self-hosted Space Grotesk, Geist Sans and Geist Mono assets with next/font/local; OFL licenses alongside assets. Unsupported script glyphs use system fallback.
- Shell: actual module groups, authorized navigation, desktop collapse, native mobile drawer, skip link, breadcrumbs, visible logout/user settings and Ctrl/Cmd+K palette. Global search returns minimal persisted product/customer/material/sales/manufacturing results filtered server-side by current role. No fake notifications or actions.
- Theme: cookie-backed server-rendered light/dark preference with same-origin mutation endpoint; no theme DB schema or external runtime font request.
- Shared controls: density/status/search/sorting/pagination, semantic status badge and tabular identifiers; named native dialogs, associated field errors, pending state/recovery and unsaved-change protection.
- Core workspaces: editorial dashboard; actual production queue; production stage/accepted-output/material allocation views; warehouse-separated variant availability matrix; material movement detail and sales fulfillment totals. Existing commercial/master/detail/create actions retained.
- Specialist forms: engineering and branding section navigation, pending controls and sticky save actions; login redesigned. Other specialist pages consume global/shared controls; their individual compositions were not all rebuilt.
- Motion: centralized CSS timing/easing, restrained reveal/hover/dialog/drawer feedback, reduced-motion override. Chart keeps actual state stable and exposes an accessible value table.

## Executed verification

127 unit/integration tests passed across20 files, including new real-database search role-boundary regression. Production build and TypeScript passed. Lint has no errors, with the existing TanStack compiler warning. Primary business browser workflow passed after updating the deliberately changed dashboard heading assertion. New browser tests cover command palette/Escape, theme persistence, mobile signout, table density/search/sort, named dialog and dirty-close decisions. Visual suite creates102 screenshots across17 core list/detail screens in light/dark at1440/768/390px, testing document overflow.

Before captures: .local/redesign-before/. After captures: test-results/redesign-screens-remain-re-70442-al-persisted-record-details/.12 representative after screenshots visually inspected by QA, plus lead inspection of desktop dashboard and mobile dark manufacturing. Visual findings corrected: stage-label spacing, dark chart contrast, raw detail keys/category ID, logo upload spacing, mobile long-button wrapping and stage layout. Screenshot coverage is not a pixel-baseline regression comparison or WCAG certification. Chromium is the executed browser; other browsers unverified.

## Remaining scope

The master brief is broader than this implemented batch. Specialist detail/create screens beyond engineering/branding still need individual composition/visual review; additional category/output/trend analytics need evidence-backed read models; product grid/table toggle, advanced combobox/multiselect and report date filtering are not universally added. No unsupported bulk actions or inline financial editing were invented. Dedicated Warehouses/Payments/QC modules are not fabricated when the existing workflow embeds them in other pages. Full UI translation, screen-reader audit and cross-browser testing remain. Hosted deployment/publication is unverified; this frontend task did not apply any database schema migration or alter business services.
