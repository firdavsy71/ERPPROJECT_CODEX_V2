import type { Metadata } from "next";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { currentLocale } from "@/i18n/server";
import { messages } from "@/i18n/messages";
import localFont from "next/font/local";
import { cookies } from "next/headers";
const display = localFont({src:"./fonts/SpaceGrotesk.ttf", variable:"--font-display", display:"swap"});
const sans = localFont({src:"./fonts/Geist.ttf", variable:"--font-interface", display:"swap"});
const mono = localFont({src:"./fonts/GeistMono.ttf", variable:"--font-mono", display:"swap", preload:false});
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
  const theme = (await cookies()).get("erp_theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang={locale} data-theme={theme} className={theme === "dark" ? "dark" : undefined}>
      <body className={`${display.variable} ${sans.variable} ${mono.variable}`}>
        <NextIntlClientProvider locale={locale} messages={messages[locale]}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
