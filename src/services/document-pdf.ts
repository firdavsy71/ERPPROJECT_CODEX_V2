import PDFDocument from "pdfkit";
import path from "node:path";
import type { DocumentData } from "./documents";
import type { Locale } from "@/i18n/messages";
import { messages } from "@/i18n/messages";
import {
  formatDateOnly,
  formatTimestamp,
  formatMoneyExact,
} from "@/i18n/format";
export async function renderDocumentPdf(
  d: DocumentData,
  source: "snapshot" | "live",
  locale: Locale,
  attachments: { name: string; mime: string; data: Buffer }[] = [],
): Promise<Buffer> {
  const font = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
  const doc = new PDFDocument({
    size: "A4",
    margin: 44,
    font,
    info: { Title: `${d.title} ${d.number}` },
    bufferPages: false,
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const t = messages[locale].invoice;
  const money = (v: string) =>
    d.currency ? formatMoneyExact(v, d.currency, locale) : v;
  const label = (v: string) =>
    d.kind === "invoice"
      ? ((
          {
            "Due date": t.dueDate,
            "Sales order": t.order,
            Subtotal: t.subtotal,
            Tax: t.tax,
            Total: t.total,
          } as Record<string, string>
        )[v] ?? v)
      : v;
  if (d.company.logo) {
    doc.image(Buffer.from(d.company.logo.data, "base64"), { fit: [100, 50] });
    doc.moveDown(0.4);
  }
  doc
    .fillColor("#153e3b")
    .fontSize(18)
    .text(d.company.name || " ");
  doc.fillColor("#202a29").fontSize(9);
  for (const value of [
    d.company.address,
    d.company.email,
    d.company.phone,
    d.company.taxId ? `${t.taxId}: ${d.company.taxId}` : "",
    d.company.registration
      ? `${t.registration}: ${d.company.registration}`
      : "",
    d.company.bank ? `${t.bank}: ${d.company.bank}` : "",
  ])
    if (value) doc.text(value);
  doc
    .moveDown()
    .fontSize(19)
    .fillColor("#153e3b")
    .text(`${d.kind === "invoice" ? t.title : d.title} · ${d.number}`);
  doc
    .fontSize(9)
    .fillColor("#202a29")
    .text(
      `${d.status} · ${d.kind === "invoice" ? t.issueDate : messages[locale].reports.date}: ${formatTimestamp(d.createdAt, locale, d.company.timezone)}`,
    );
  if (source === "live")
    doc
      .moveDown()
      .fillColor("#8b4c05")
      .text(
        "Live preview: historical snapshot unavailable; current names and company details may differ from the original transaction.",
      )
      .fillColor("#202a29");
  doc.moveDown(0.5).fontSize(8).text(t.note);
  if (d.party) {
    doc
      .moveDown()
      .fontSize(11)
      .text(
        d.kind === "purchase-order" || d.kind === "material-receipt"
          ? "Supplier"
          : t.buyer,
      );
    doc.fontSize(9);
    for (const v of [
      d.party.name,
      d.party.address,
      d.party.taxId ? `${t.taxId}: ${d.party.taxId}` : "",
      d.party.email,
      d.party.phone,
    ])
      if (v) doc.text(v);
  }
  for (const f of d.facts)
    doc
      .fontSize(9)
      .text(
        `${label(f.label)}: ${/^\d{4}-\d{2}-\d{2}$/.test(f.value) ? formatDateOnly(f.value, locale) : f.value || "—"}`,
      );
  if (d.rows.length) {
    doc
      .moveDown()
      .fontSize(12)
      .fillColor("#153e3b")
      .text(t.description)
      .fillColor("#202a29");
    for (const r of d.rows) {
      doc.moveDown(0.35).fontSize(9).text(r.description);
      const parts = [
        r.quantity !== undefined ? `${t.quantity}: ${r.quantity}` : "",
        r.price !== undefined ? `${t.price}: ${money(r.price)}` : "",
        r.discount !== undefined ? `${t.discount}: ${r.discount}%` : "",
        r.total !== undefined ? `${t.lineTotal}: ${money(r.total)}` : "",
      ].filter(Boolean);
      doc.fontSize(8).text(parts.join("  |  "));
    }
  }
  for (const section of d.sections) {
    doc
      .moveDown()
      .fontSize(11)
      .fillColor("#153e3b")
      .text(section.title)
      .fillColor("#202a29")
      .fontSize(9)
      .text(section.content);
  }
  if (d.totals.length) doc.moveDown();
  for (const total of d.totals)
    doc
      .fontSize(10)
      .text(
        `${label(total.label)}: ${total.monetary ? money(total.value) : total.value}`,
        { align: "right" },
      );
  doc
    .moveDown(2)
    .fontSize(9)
    .text("Prepared by: ______________________________")
    .moveDown()
    .text("Received / approved by: ______________________________");
  for (const attachment of attachments) {
    doc.file(attachment.data, { name: attachment.name, type: attachment.mime });
    if (attachment.mime === "image/png" || attachment.mime === "image/jpeg") {
      doc.addPage().fontSize(12).text(attachment.name).moveDown();
      doc.image(attachment.data, { fit: [500, 680], align: "center" });
    }
  }
  doc.end();
  return done;
}
