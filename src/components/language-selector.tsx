"use client";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLanguage } from "@/app/locale-actions";
export function LanguageSelector() {
  const locale = useLocale();
  const t = useTranslations("common");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label>
      <span className="sr-only">{t("language")}</span>
      <select
        aria-label={t("language")}
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          start(async () => {
            await setLanguage(value);
            router.refresh();
          });
        }}
      >
        <option value="en">English</option>
        <option value="ru">Русский</option>
        <option value="uz">O‘zbekcha</option>
      </select>
    </label>
  );
}
