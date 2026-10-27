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
import { ArrowUpDown, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
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
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const defs = useMemo(
    () =>
      columns.map((c, i) => ({
        accessorKey: c.key,
        header: c.label,
        cell: ({
          getValue,
          row,
        }: {
          getValue: () => unknown;
          row: { original: Row };
        }) => {
          const value = String(getValue() ?? "—");
          if (c.key === "status")
            return (
              <span
                className={`badge ${["Completed", "Paid", "Received", "Ready for Shipment", "Active"].includes(value) ? "badge-green" : ""}`}
              >
                {value}
              </span>
            );
          return i === 0 && href ? (
            <Link className="row-link" href={`/${href}/${row.original.id}`}>
              {value}
            </Link>
          ) : (
            value
          );
        },
      })),
    [columns, href],
  );
  const table = useReactTable({
    data: rows,
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
    <section className="table-card">
      <div className="table-tools">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="Search records"
            placeholder="Search records…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="muted">
          {table.getFilteredRowModel().rows.length} records
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th key={h.id}>
                    <button onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowUpDown size={12} />
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
                  <td key={c.id}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!table.getRowModel().rows.length && (
          <div className="empty">
            <strong>No records yet</strong>
            <p>Create a record to start managing this part of your business.</p>
          </div>
        )}
      </div>
      <div className="table-footer">
        <span>
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {Math.max(1, table.getPageCount())}
        </span>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </Button>{" "}
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </section>
  );
}
