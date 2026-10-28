"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUpRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { nav } from "@/lib/modules";
import { canReadModule, type Role } from "@/lib/permissions";
type SearchResult = {
  id: string;
  label: string;
  detail?: string;
  href: string;
  group: string;
};
export function CommandPalette({ role, label }: { role: Role; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const t = useTranslations("nav");
  const locale = useLocale();
  const text =
    locale === "ru"
      ? {
          pages: "Разделы",
          empty: "Ничего не найдено",
          loading: "Поиск записей…",
          error: "Поиск записей недоступен",
          close: "Закрыть поиск",
          footer: "↑ ↓ выбор · Enter открыть · Esc закрыть",
        }
      : locale === "uz"
        ? {
            pages: "Bo'limlar",
            empty: "Natija topilmadi",
            loading: "Qidirilmoqda…",
            error: "Qidiruv mavjud emas",
            close: "Qidiruvni yopish",
            footer: "↑ ↓ tanlash · Enter ochish · Esc yopish",
          }
        : {
            pages: "Pages",
            empty: "No matching pages or records",
            loading: "Searching records…",
            error: "Record search is unavailable",
            close: "Close search",
            footer: "↑ ↓ navigate · Enter open · Esc close",
          };
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(0);
  function open() {
    dialog.current?.showModal();
    input.current?.focus();
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (query.trim().length < 2) {
        setRecords([]);
        setLoading(false);
        setError(false);
        return;
      }
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("search");
        const data = (await response.json()) as { results?: SearchResult[] };
        if (!controller.signal.aborted)
          setRecords(
            (data.results ?? []).filter(
              (r) => r.href.startsWith("/") && !r.href.startsWith("//"),
            ),
          );
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
          setRecords([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const results = useMemo(
    () =>
      [
        ...nav
          .filter(
            ([path]) =>
              canReadModule(role, path) &&
              `${t(path)} ${path}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
          )
          .map(([path]) => ({
            id: `page-${path}`,
            label: t(path),
            href: `/${path}`,
            group: text.pages,
            detail: "",
          })),
        ...records,
      ].slice(0, 36),
    [role, query, records, t, text.pages],
  );
  function choose(result: SearchResult) {
    dialog.current?.close();
    router.push(result.href);
  }
  return (
    <>
      <button
        type="button"
        className="command-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={open}
      >
        <Search size={17} />
        <span>{label}</span>
        <kbd>⌘ K</kbd>
      </button>
      <dialog
        className="command-dialog"
        ref={dialog}
        aria-labelledby="command-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <h2 id="command-title" className="sr-only">
          {label}
        </h2>
        <div className="command-input-row">
          <Search size={20} />
          <input
            ref={input}
            aria-label={label}
            placeholder={label}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
              setRecords([]);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next =
                  event.key === "ArrowDown"
                    ? Math.max(0, Math.min(selected + 1, results.length - 1))
                    : Math.max(selected - 1, 0);
                setSelected(next);
                dialog.current
                  ?.querySelector(`[data-result-index="${next}"]`)
                  ?.scrollIntoView({ block: "nearest" });
              }
              if (event.key === "Enter" && results[selected]) {
                event.preventDefault();
                choose(results[selected]);
              }
            }}
          />
          <button
            className="icon-button"
            aria-label={text.close}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <div className="command-results" aria-busy={loading}>
          {loading && (
            <p role="status" className="command-empty">
              {text.loading}
            </p>
          )}
          {error && (
            <p role="status" className="command-empty">
              {text.error}
            </p>
          )}
          {!results.length && !loading && (
            <p role="status" className="command-empty">
              {text.empty}
            </p>
          )}
          {results.map((result, index) => (
            <div key={`${result.group}-${result.id}`}>
              {(index === 0 || results[index - 1].group !== result.group) && (
                <p className="command-group">{result.group}</p>
              )}
              <button
                type="button"
                data-result-index={index}
                className={`command-result ${selected === index ? "selected" : ""}`}
                onFocus={() => setSelected(index)}
                onClick={() => choose(result)}
              >
                <span>
                  <strong>{result.label}</strong>
                  {result.detail && <small>{result.detail}</small>}
                </span>
                <ArrowUpRight size={16} />
              </button>
            </div>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">{results[selected]?.label}</p>
        <div className="command-footer">{text.footer}</div>
      </dialog>
    </>
  );
}
