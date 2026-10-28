"use client";
import { useTranslations } from "next-intl";
export function PrintButton() {
  const t = useTranslations("common");
  return (
    <button className="btn btn-primary no-print" onClick={() => window.print()}>
      {t("print")}
    </button>
  );
}
