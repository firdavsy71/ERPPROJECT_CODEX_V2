# Business documents

Printable previews and PDF downloads are available for quotations, sales order
confirmations, invoices, packing lists, delivery notes, purchase orders,
material receipts, manufacturing orders, technical specifications and
production material requirements. Access follows the corresponding business
module permissions. The PDF endpoint does not accept arbitrary content or URLs.

For new transactions, document snapshots are captured in the same database
transaction as quotation approval, sales confirmation, invoice issuance,
purchase order placement, receipt, manufacturing planning, specification
approval or delivery dispatch. The snapshots include company and counterparty
details, relevant product descriptions, quantities and agreed prices. The
company logo in effect at that time is included, if configured. Snapshots are
immutable. Later edits to master records or the company logo do not change
those documents. A packing list remains a live preview until dispatch; a
delivery note is unavailable until goods are dispatched. A draft production
requirement sheet is explicitly labelled as unreserved BOM quantities.

Historical transactions created before this feature and drafts may lack a
snapshot. Their pages and PDFs are marked as live previews: current names and
company details may differ from the original transaction. No missing historical
prices, tax rates or statutory document numbers are invented. Receipt documents
use their persisted receipt ID where no separate receipt number exists. Old
receipt lines recovered without a verified price show the price as unavailable.

An administrator can upload a company logo in Settings. PNG or JPEG input is
validated and normalized to a size-limited PNG stored in PostgreSQL. Removing
the current logo does not remove it from issued snapshots. Technical
specification PDF files include their immutable image attachments as pages and
embed referenced files as attachments.

These are business templates, not a representation of statutory compliance,
tax invoices or any government-mandated form. Users remain responsible for
checking applicable requirements before external use.
