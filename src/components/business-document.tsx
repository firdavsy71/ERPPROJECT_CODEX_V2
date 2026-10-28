/* eslint-disable @next/next/no-img-element -- Private or embedded document images must not pass through an image optimization proxy. */
import type { DocumentData } from "@/services/documents";
import type { Locale } from "@/i18n/messages";
import { messages } from "@/i18n/messages";
import { documentLabel, documentTitle } from "@/i18n/documents";
import {
  formatDateOnly,
  formatTimestamp,
  formatMoneyExact,
} from "@/i18n/format";
import { PrintButton } from "@/components/print-button";
export function BusinessDocument({
  document: d,
  source,
  locale,
  id,
}: {
  document: DocumentData;
  source: "snapshot" | "live";
  locale: Locale;
  id: string;
}) {
  const t = messages[locale].invoice;
  const dt = messages[locale].documents;
  const money = (v: string) =>
    d.currency ? formatMoneyExact(v, d.currency, locale) : v;
  const label = (v: string) => documentLabel(v, locale);
  return (
    <article className="business-document">
      <header className="document-header">
        <div>
          {d.company.logo && (
            <img
              className="document-logo"
              src={`data:${d.company.logo.mime};base64,${d.company.logo.data}`}
              alt={dt.companyLogo}
            />
          )}
          <h2>{d.company.name}</h2>
          <p>{d.company.address}</p>
          <p>
            {d.company.email} {d.company.phone}
          </p>
          {d.company.taxId && (
            <p>
              {t.taxId}: {d.company.taxId}
            </p>
          )}
          {d.company.registration && (
            <p>
              {t.registration}: {d.company.registration}
            </p>
          )}
          {d.company.bank && (
            <p>
              {t.bank}: {d.company.bank}
            </p>
          )}
        </div>
        <div>
          <h1>{documentTitle(d.kind, locale)}</h1>
          <p>{d.number}</p>
          <p>{d.status}</p>
          <p>
            {d.kind === "invoice" ? t.issueDate : messages[locale].reports.date}:{" "}
            {formatTimestamp(d.createdAt, locale, d.company.timezone)}
          </p>
        </div>
      </header>
      {source === "live" && (
        <p className="document-warning">
          {dt.livePreview}
        </p>
      )}
      <p className="document-warning">{t.note}</p>
      {d.party && (
        <section>
          <h2>
            {d.kind === "purchase-order" || d.kind === "material-receipt"
              ? dt.supplier
              : t.buyer}
          </h2>
          <p>{d.party.name}</p>
          <p>{d.party.address}</p>
          {d.party.taxId && (
            <p>
              {t.taxId}: {d.party.taxId}
            </p>
          )}
          <p>
            {d.party.email} {d.party.phone}
          </p>
        </section>
      )}
      {d.facts.length > 0 && (
        <dl className="document-facts">
          {d.facts.map((f, i) => (
            <div key={i}>
              <dt>{label(f.label)}</dt>
              <dd>
                {/^\d{4}-\d{2}-\d{2}$/.test(f.value)
                  ? formatDateOnly(f.value, locale)
                  : f.value || "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {d.rows.length > 0 && (
        <table className="document-table">
          <thead>
            <tr>
              <th>{t.description}</th>
              <th>{t.quantity}</th>
              {d.rows.some((r) => r.price !== undefined) && <th>{t.price}</th>}
              {d.rows.some((r) => r.discount !== undefined) && (
                <th>{t.discount}</th>
              )}
              {d.rows.some((r) => r.total !== undefined) && (
                <th>{t.lineTotal}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.description}</td>
                <td>{r.quantity ?? "—"}</td>
                {d.rows.some((x) => x.price !== undefined) && (
                  <td>{r.price !== undefined ? money(r.price) : "—"}</td>
                )}
                {d.rows.some((x) => x.discount !== undefined) && (
                  <td>{r.discount !== undefined ? `${r.discount}%` : "—"}</td>
                )}
                {d.rows.some((x) => x.total !== undefined) && (
                  <td>{r.total !== undefined ? money(r.total) : "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.sections.map((s, i) => (
        <section key={i}>
          <h2>{label(s.title)}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{s.content}</p>
        </section>
      ))}
      {d.attachments && d.attachments.length > 0 && (
        <section>
          <h2>{dt.attachments}</h2>
          {d.attachments.map((a) => (
            <div key={a.id}>
              <p>
                <a href={`/api/specifications/${id}/attachments/${a.id}`}>
                  {a.kind} · {a.name}
                </a>
              </p>
              {a.mime.startsWith("image/") && (
                <img
                  src={`/api/specifications/${id}/attachments/${a.id}`}
                  alt={a.name}
                  style={{ maxWidth: "100%", maxHeight: "600px" }}
                />
              )}
            </div>
          ))}
        </section>
      )}
      {d.totals.length > 0 && (
        <dl className="document-totals">
          {d.totals.map((a, i) => (
            <div key={i}>
              <dt>{label(a.label)}</dt>
              <dd>{a.monetary ? money(a.value) : a.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="document-signatures">
        <span>{dt.preparedBy}: __________________</span>
        <span>{dt.receivedBy}: __________________</span>
      </div>
      <div className="actions no-print">
        <PrintButton />
        <a className="btn btn-outline" href={`/api/documents/${d.kind}/${id}`}>
          {dt.downloadPdf}
        </a>
      </div>
    </article>
  );
}
