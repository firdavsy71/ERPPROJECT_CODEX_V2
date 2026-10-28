# Localization and regional settings

The language selector stores a validated English, Russian or Uzbek locale in a
browser cookie. Translation keys and shared form-label mappings are in
`src/i18n/messages.ts`; untranslated labels fall back to English. Navigation,
common forms and tables, report exports and printable invoices use the selected
language. Some specialized screens and server error messages still need
translations.

Company settings contain a configurable IANA timezone, currency (UZS or USD),
tax rate and optional tax, registration and bank details. The existing default
tax value is application configuration, not a statement of Uzbek law; users must
set the appropriate rate themselves. Invoice totals keep the rate and currency
used at issuance. Printed seller details come from current company settings, not
an immutable snapshot.

Amounts are calculated using decimal arithmetic and formatted from decimal
strings without binary floating-point conversion. Calendar dates are displayed
as dates, while invoice timestamps, report timestamps and full ISO timestamps in
shared tables use the configured business timezone. Some specialized pages
still show their existing UTC dates and require migration to the shared formatter.
CSV amounts remain machine-readable decimal strings; selected column headings
and timestamps use the selected language and timezone.

The printable invoice is a commercial document, not a claim to implement a
government-mandated form, electronic invoicing protocol or local tax compliance.
