"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Rows3,
  AlignJustify,
} from "lucide-react";
import { Button } from "./ui/button";
import { useLocale, useTranslations } from "next-intl";
import { additionalLabels, labelKeys, resolveLocale } from "@/i18n/messages";
import { formatTimestamp } from "@/i18n/format";
import { useBusinessTimeZone } from "@/components/regional-provider";
import { StatusBadge, statusLabel } from "./status-badge";
export type Row = Record<string, string | number | boolean | null | undefined>;
export function DataTable({
  rows,
  columns,
  href,
}: {
  rows: Row[];
  columns: { key: string; label: string }[];
  href?: string;
}) {
  "use no memo";
  const t = useTranslations("forms");
  const common = useTranslations("common");
  const locale = resolveLocale(useLocale());
  const timeZone = useBusinessTimeZone();
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [status, setStatus] = useState("");
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const copy =
    locale === "ru"
      ? {
          all: "Все статусы",
          status: "Фильтр по статусу",
          density: "Плотность таблицы",
          compact: "Компактно",
          comfortable: "Обычно",
          empty: "Записей пока нет",
          hint: "Создайте первую запись с помощью доступного действия на странице.",
          noMatch: "Ничего не найдено",
          reset: "Сбросить фильтры",
          matchHint: "Измените запрос или фильтр статуса.",
          page: "Страница",
          of: "из",
          previous: "Предыдущая страница",
          next: "Следующая страница",
        }
      : locale === "uz"
        ? {
            all: "Barcha holatlar",
            status: "Holat bo‘yicha filtr",
            density: "Jadval zichligi",
            compact: "Ixcham",
            comfortable: "Odatiy",
            empty: "Hali yozuvlar yo‘q",
            hint: "Sahifadagi mavjud amal orqali birinchi yozuvni yarating.",
            noMatch: "Hech narsa topilmadi",
            reset: "Filtrlarni tozalash",
            matchHint: "Qidiruv yoki holat filtrini o‘zgartiring.",
            page: "Sahifa",
            of: "/",
            previous: "Oldingi sahifa",
            next: "Keyingi sahifa",
          }
        : {
            all: "All statuses",
            status: "Filter by status",
            density: "Table density",
            compact: "Compact",
            comfortable: "Comfortable",
            empty: "No records yet",
            hint: "Use an available action on this page to create your first record.",
            noMatch: "No matching records",
            reset: "Clear filters",
            matchHint: "Try a different search or status filter.",
            page: "Page",
            of: "of",
            previous: "Previous page",
            next: "Next page",
          };
  const statuses = useMemo(
    () =>
      columns.some((c) => c.key === "status")
        ? [
            ...new Set(rows.map((r) => String(r.status ?? "")).filter(Boolean)),
          ].sort()
        : [],
    [rows, columns],
  );
  const filteredRows = useMemo(
    () => (status ? rows.filter((r) => r.status === status) : rows),
    [rows, status],
  );
  const defs = useMemo(
    () =>
      columns.map((c, i) => ({
        accessorKey: c.key,
        header: labelKeys[c.label]
          ? t(labelKeys[c.label])
          : (additionalLabels[locale][c.label] ??
            c.label.replace("(UTC)", `(${timeZone})`)),
        cell: ({
          getValue,
          row,
        }: {
          getValue: () => unknown;
          row: { original: Row };
        }) => {
          const raw = String(getValue() ?? "—");
          const value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
            raw,
          )
            ? formatTimestamp(raw, locale, timeZone)
            : raw;
          if (c.key === "status")
            return <StatusBadge status={raw} locale={locale} />;
          return i === 0 && href ? (
            <Link className="row-link" href={`/${href}/${row.original.id}`}>
              {value}
            </Link>
          ) : (
            value
          );
        },
      })),
    [columns, href, t, locale, timeZone],
  );
  const table = useReactTable({
    data: filteredRows,
    columns: defs,
    state: { globalFilter: search, sorting },
    onGlobalFilterChange: setSearch,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  return (
    <section className={`table-card table-density-${density}`}>
      <div className="table-tools">
        <div className="search-input">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label={common("search")}
            placeholder={common("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {statuses.length > 0 && (
          <div className="table-filter">
            <ListFilter size={15} aria-hidden="true" />
            <select
              aria-label={copy.status}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                table.setPageIndex(0);
              }}
            >
              <option value="">{copy.all}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s, locale)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div
          className="table-density-control"
          role="group"
          aria-label={copy.density}
        >
          <Button
            variant="ghost"
            size="sm"
            aria-label={copy.comfortable}
            title={copy.comfortable}
            aria-pressed={density === "comfortable"}
            onClick={() => setDensity("comfortable")}
          >
            <Rows3 size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={copy.compact}
            title={copy.compact}
            aria-pressed={density === "compact"}
            onClick={() => setDensity("compact")}
          >
            <AlignJustify size={16} />
          </Button>
        </div>
        <span className="muted">
          {table.getFilteredRowModel().rows.length} {common("records")}
        </span>
      </div>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={common("records")}
      >
        <table>
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={
                      h.column.getIsSorted() === "asc"
                        ? "ascending"
                        : h.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowUpDown size={12} aria-hidden="true" />
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) => (
                  <td
                    key={c.id}
                    className={
                      /sku|number|batch|reference/i.test(c.column.id)
                        ? "identifier-cell"
                        : /quantity|price|cost|total|amount|reserved|available|onHand|shipped|paid|completed|rejected|length|minimum/i.test(
                              c.column.id,
                            )
                          ? "numeric-cell"
                          : undefined
                    }
                  >
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!table.getRowModel().rows.length && (
          <div className="empty">
            <strong>{search || status ? copy.noMatch : copy.empty}</strong>
            <p>{search || status ? copy.matchHint : copy.hint}</p>
            {(search || status) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatus("");
                  table.setPageIndex(0);
                }}
              >
                {copy.reset}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="table-footer">
        <span>
          {copy.page} {table.getState().pagination.pageIndex + 1} {copy.of}{" "}
          {Math.max(1, table.getPageCount())}
        </span>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            aria-label={copy.previous}
          >
            <ChevronLeft size={16} />
          </Button>{" "}
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            aria-label={copy.next}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </section>
  );
}
