import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Workwear ERP",
  description: "Connected manufacturing, inventory and sales operations.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
