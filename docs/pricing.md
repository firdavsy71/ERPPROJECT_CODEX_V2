# B2B pricing and contracts

Rules are scoped to one variant and currency. Contract and Customer rules require a customer; Volume and Standard rules are universal. Sales staff prepare drafts and quotations; administrators approve/reject them. Approved rules are immutable. Replacement requires a retirement date and a new approved version. Retirement history cannot be changed or backdated. Catalog price edits through product management record before/after audit values on the pricing page.

Resolution is deterministic: **active Contract → Customer → eligible Volume → Standard currency price → catalog price in company currency**. Only approved versions are eligible. Dates are inclusive, evaluated in Asia/Tashkent. Overlapping approved rules at the same priority/customer/variant/currency are rejected. Retirement excludes a rule from its effective date.

Choose the highest quantity threshold not exceeding the line quantity. Thresholds 1, 50 and 200 mean 1–49, 50–199 and 200+ units. Combine quantities for each variant into one line; duplicate variants are rejected. Sizes/variants do not combine into a shared tier. The winning rule's MOQ and first-tier eligibility are enforced; an unmet contract/customer minimum never silently falls back to a cheaper rule. Volume rules below their first threshold do fall back.

A tier is either a fixed unit price or a percentage discount. Discounts never stack. A percentage uses a Standard currency price or same-currency catalog price. The Standard base's MOQ also applies when supplying a discount base. Standard rules contain one fixed-price tier. There is no implicit FX: foreign-currency discounts require an explicit Standard price in that currency. Decimal arithmetic applies discounts to the extended line amount, rounding once to two decimal places.

Create server-priced **Quotations**, recalculate drafts if rules change, and obtain administrator approval. Validity cannot exceed the selected rule's expiration. An approved, unexpired quotation converts once to a sales order, retaining agreed prices and rule versions even if the rule is subsequently retired. Branding charges and invoice tax are separate from the quoted product total.

Existing manual sales entry remains available. Salespeople may confirm only prices/discounts matching approved rules and MOQ. An administrator can authorize a manual pricing exception by confirming that sale; original prices and approving actor are retained. Orders converted from approved quotations already carry price approval.

Confirmed sales prices, quantities, discounts, currency and snapshots are immutable. Shipment/reservation counters continue normally. Invoices use agreed stored totals, not current price lists, and issued invoice totals are immutable. Customer pages link to customer rules/quotations, and quotation details link to the resulting sales order. Document conversion is protected by operation keys, transactions and a unique quotation/order relationship.
