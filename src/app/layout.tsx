import type { Metadata } from "next";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { currentLocale } from "@/i18n/server";
import { messages } from "@/i18n/messages";
export const metadata: Metadata = {
  title: "Workwear ERP",
  description: "Connected manufacturing, inventory and sales operations.",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages[locale]}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
