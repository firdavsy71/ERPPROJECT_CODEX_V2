import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentLocale } from "@/i18n/server";
import { messages } from "@/i18n/messages";
import {
  formatDateOnly,
  formatTimestamp,
  formatMoneyExact,
} from "@/i18n/format";
import { discountedLineTotal } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
export default async function PrintInvoice({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await currentActor())) redirect("/login");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [invoice] = await db()
    .select()
    .from(s.invoices)
    .where(eq(s.invoices.id, id));
  if (!invoice) notFound();
  const [sale] = await db()
    .select()
    .from(s.sales)
    .where(eq(s.sales.id, invoice.orderId));
  if (!sale) notFound();
  const [customer, settings, items, variants, products, locale] =
    await Promise.all([
      db()
        .select()
        .from(s.customers)
        .where(eq(s.customers.id, sale.customerId)),
      db().select().from(s.settings),
      db().select().from(s.saleItems).where(eq(s.saleItems.orderId, sale.id)),
      db().select().from(s.variants),
      db().select().from(s.products),
      currentLocale(),
    ]);
  const t = messages[locale].invoice;
  const company = settings[0];
  const buyer = customer[0];
  const money = (v: string) => formatMoneyExact(v, sale.currency, locale);
  return (
    <article className="detail-card">
      <div className="actions">
        <PrintButton />
      </div>
      <h1>
        {t.title} {invoice.number}
      </h1>
      <p>
        {t.issueDate}:{" "}
        {formatTimestamp(
          invoice.createdAt,
          locale,
          company?.timezone ?? "Asia/Tashkent",
        )}{" "}
        · {t.dueDate}: {formatDateOnly(invoice.dueDate, locale)}
      </p>
      <p>
        {t.order}: {sale.number} · {t.currency}: {sale.currency}
      </p>
      <div className="record-grid">
        <section>
          <h2>{t.seller}</h2>
          <p>{company?.name}</p>
          <p>{company?.address}</p>
          {company?.taxId && (
            <p>
              {t.taxId}: {company.taxId}
            </p>
          )}
          {company?.registrationNumber && (
            <p>
              {t.registration}: {company.registrationNumber}
            </p>
          )}
          {company?.bankDetails && (
            <p>
              {t.bank}: {company.bankDetails}
            </p>
          )}
          <p>
            {company?.email} {company?.phone}
          </p>
        </section>
        <section>
          <h2>{t.buyer}</h2>
          <p>{buyer?.name}</p>
          <p>{buyer?.address}</p>
          {buyer?.taxId && (
            <p>
              {t.taxId}: {buyer.taxId}
            </p>
          )}
        </section>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t.description}</th>
              <th>{t.quantity}</th>
              <th>{t.price}</th>
              <th>{t.discount}</th>
              <th>{t.lineTotal}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const variant = variants.find((v) => v.id === i.variantId);
              const product = products.find((p) => p.id === variant?.productId);
              const total = new Decimal(
                discountedLineTotal(i.quantity, i.price, i.discount),
              )
                .add(i.brandingTotal)
                .toFixed(2);
              return (
                <tr key={i.id}>
                  <td>
                    {product?.name} · {variant?.sku} · {variant?.size} ·{" "}
                    {variant?.color}
                  </td>
                  <td>{i.quantity}</td>
                  <td>{money(i.price)}</td>
                  <td>{i.discount}%</td>
                  <td>{money(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="record-grid">
        <div>
          <dt>{t.subtotal}</dt>
          <dd>{money(invoice.subtotal)}</dd>
        </div>
        <div>
          <dt>
            {t.tax} ({invoice.taxRate}%)
          </dt>
          <dd>
            {money(
              new Decimal(invoice.total).minus(invoice.subtotal).toFixed(2),
            )}
          </dd>
        </div>
        <div>
          <dt>{t.total}</dt>
          <dd>{money(invoice.total)}</dd>
        </div>
      </dl>
      <p>{t.note}</p>
    </article>
  );
}
