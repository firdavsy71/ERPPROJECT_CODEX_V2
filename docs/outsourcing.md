# Outsourced manufacturing

Create a supplier first, then add its workshop capabilities in **Subcontractors**. Profiles can be edited or archived; existing orders retain their supplier references.

Create a draft manufacturing order with its approved technical specification and fixed BOM. Assign the whole manufacturing order to a subcontractor in **Outsourced manufacturing**. Each size/variant has its own manufacturing order. Draft outsourcing terms can be edited or cancelled. Activation fixes the terms and reserves the BOM materials. That manufacturing order is then controlled exclusively by the outsourcing workflow, preventing duplicate internal production postings.

Inventory staff issue allocated materials using a dispatch document reference. For fabric, choose an allocated roll. Issuance removes the physically dispatched quantity from the main warehouse and records the same quantity in external custody; it does not record consumption. The original fabric sections and roll identity remain in the dispatch history.

Record actual consumption only against a workshop consumption document. Record unused returns separately when received. Returned fabric receives a new linked roll identifier, with its original material, supplier batch, composition and width; the settlement document links that roll to the custody line and original roll. Outstanding custody is issued minus consumed minus returned. Do not add external custody to available warehouse stock.

The production manager records cumulative produced quantities and partial delivery inspections. Only accepted quantities enter finished inventory. Rejected quantities remain documented on the inspection receipt and never enter saleable stock. Accepted goods must pass every fixed specification quality check and, where applicable, the fixed branding check. Receipt totals cannot exceed reported production or the manufacturing assignment.

Use unique document references, including line numbers for dispatches. References are normalized to uppercase. Repeating an operation key is idempotent; reusing a document reference with a new key is rejected atomically. Delivery, settlement and cost documents are immutable. Record actual cost documents in the order's fixed currency; agreed estimated cost and actual invoiced costs are displayed separately.

Close an order after every assigned unit has been inspected and all issued materials have consumption or return documents. Closing releases unissued reservations and records the final manufacturing and quality totals; it does not add finished stock a second time. Active orders must be fulfilled and reconciled; cancellation is available for unactivated drafts. Subcontractor history shows accepted/rejected quantities, defect rate and delivery performance.

Permissions follow existing roles: supplier management controls profiles; manufacturing controls order terms, progress, inspection, costs and closure; inventory controls physical material dispatch and custody settlement. All writes use the existing transaction and audit mechanism. No payroll or automatic supplier payments are added.
