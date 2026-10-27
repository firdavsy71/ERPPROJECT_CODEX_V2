"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "./ui/button";
import { RowsEditor } from "./specification-editor";
import {
  brandingTechniques,
  brandingLocations,
  blankBranding,
  customizationPrice,
  type BrandingDocument,
} from "@/lib/branding";
import { brandingAction } from "@/app/branding-actions";
export type BrandingLineOption = {
  id: string;
  label: string;
  variantId: string;
  productId: string;
  quantity: number;
  currency: string;
};
export type BrandingSpecOption = {
  id: string;
  label: string;
  variantId: string;
};
export function BrandingEditor({
  lines,
  specs,
  preferred,
  logos = [],
  initial,
}: {
  lines: BrandingLineOption[];
  specs: BrandingSpecOption[];
  preferred?: string;
  logos?: { assetId: string; name: string }[];
  initial?: {
    id: string;
    saleItemId: string;
    specificationId: string;
    title: string;
    changeNote: string;
    revision: number;
    document: BrandingDocument;
  };
}) {
  const router = useRouter();
  const [lineId, setLine] = useState(initial?.saleItemId ?? preferred ?? "");
  const [specificationId, setSpec] = useState(
    initial?.specificationId ??
      specs.find(
        (s) => s.variantId === lines.find((l) => l.id === preferred)?.variantId,
      )?.id ??
      "",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [changeNote, setChange] = useState(initial?.changeNote ?? "");
  const [document, setDocument] = useState(initial?.document ?? blankBranding);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const line = lines.find((l) => l.id === lineId);
  function update<K extends keyof BrandingDocument>(
    key: K,
    value: BrandingDocument[K],
  ) {
    setDocument((d) => ({ ...d, [key]: value }));
  }
  function placement(i: number, value: BrandingDocument["placements"][number]) {
    update(
      "placements",
      document.placements.map((p, j) => (j === i ? value : p)),
    );
  }
  let price: ReturnType<typeof customizationPrice> | null = null;
  try {
    price = customizationPrice(document, line?.quantity ?? 1);
  } catch {}
  return (
    <form
      className="detail-card spec-editor"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await brandingAction("save", {
            id: initial?.id,
            data: {
              saleItemId: lineId,
              specificationId,
              title,
              changeNote,
              document,
              revision: initial?.revision,
            },
          });
          setMessage(r.message);
          if (r.ok && r.id) {
            router.push(`/branding/${r.id}`);
            router.refresh();
          }
        });
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>Sales order line</span>
          <select
            required
            disabled={!!initial}
            aria-label="Branding sales line"
            value={lineId}
            onChange={(e) => {
              setLine(e.target.value);
              setSpec(
                specs.find(
                  (s) =>
                    s.variantId ===
                    lines.find((l) => l.id === e.target.value)?.variantId,
                )?.id ?? "",
              );
            }}
          >
            <option value="">Select a draft order line…</option>
            {lines.map((l) => (
              <option value={l.id} key={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Approved engineering specification</span>
          <select
            required
            aria-label="Branding engineering specification"
            value={specificationId}
            onChange={(e) => setSpec(e.target.value)}
          >
            <option value="">Select approved specification…</option>
            {specs
              .filter((s) => s.variantId === line?.variantId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Design title</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Change summary</span>
          <input
            required
            value={changeNote}
            onChange={(e) => setChange(e.target.value)}
          />
        </label>
        <label className="field full">
          <span>Customer-specific design instructions</span>
          <textarea
            rows={3}
            value={document.customerInstructions}
            onChange={(e) => update("customerInstructions", e.target.value)}
          />
        </label>
        <label className="field full">
          <span>Exact production instructions</span>
          <textarea
            rows={4}
            value={document.productionInstructions}
            onChange={(e) => update("productionInstructions", e.target.value)}
          />
        </label>
      </div>
      {line && !specs.some((s) => s.variantId === line.variantId) && (
        <p className="error">
          This variant needs an approved engineering specification.{" "}
          <Link
            className="text-link"
            href={`/specifications?productId=${line.productId}`}
          >
            Open product technical specifications
          </Link>
        </p>
      )}
      <h2>Custom fabric color</h2>
      <div className="form-grid">
        {(
          [
            { key: "fabricColor", label: "Custom fabric color" },
            {
              key: "fabricColorStandard",
              label: "Pantone / RAL / customer reference",
            },
            { key: "fabricSurcharge", label: "Fabric surcharge per unit" },
            {
              key: "reflectiveSurcharge",
              label: "Reflective tape surcharge per unit",
            },
          ] as const
        ).map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            <input
              value={document[f.key]}
              onChange={(e) => update(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <RowsEditor
        label="Custom reflective tape"
        rows={document.reflectiveTape}
        fields={[
          { key: "location", label: "Location" },
          { key: "widthMm", label: "Width (mm)" },
          { key: "color", label: "Color / grade" },
          { key: "configuration", label: "Placement and configuration" },
        ]}
        create={{
          location: "",
          widthMm: "50",
          color: "Silver",
          configuration: "",
        }}
        onChange={(v) => update("reflectiveTape", v)}
      />
      <h2>Logos, decoration and placement</h2>
      <p className="muted">
        Save a draft, upload company logos, then edit placements and save again.
        Upload the design proof last: any draft edit makes an older proof stale.
      </p>
      {document.placements.map((p, i) => (
        <section className="spec-row" key={i}>
          <h3>Decoration {i + 1}</h3>
          <div className="form-grid">
            <label className="field">
              <span>Technique</span>
              <select
                aria-label={`Decoration ${i + 1} technique`}
                value={p.technique}
                onChange={(e) =>
                  placement(i, {
                    ...p,
                    technique: e.target.value as typeof p.technique,
                  })
                }
              >
                {brandingTechniques.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Logo placement</span>
              <select
                aria-label={`Decoration ${i + 1} location`}
                value={p.location}
                onChange={(e) =>
                  placement(i, {
                    ...p,
                    location: e.target.value as typeof p.location,
                  })
                }
              >
                {brandingLocations.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="field full">
              <span>Company logo</span>
              <select
                aria-label={`Decoration ${i + 1} logo`}
                value={p.logoAssetId}
                onChange={(e) =>
                  placement(i, { ...p, logoAssetId: e.target.value })
                }
              >
                <option value="">
                  Attach a logo on the draft detail page first…
                </option>
                {logos.map((a) => (
                  <option value={a.assetId} key={a.assetId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                { key: "widthMm", label: "Width (mm)" },
                { key: "heightMm", label: "Height (mm)" },
                { key: "colors", label: "Ink / transfer / thread colors" },
                { key: "thread", label: "Embroidery thread specification" },
                {
                  key: "positionInstructions",
                  label: "Exact position / distance from datum",
                },
                {
                  key: "applicationInstructions",
                  label:
                    "Application instructions (stitches / inks / temperature / time / pressure)",
                },
                { key: "unitPrice", label: "Customization price per garment" },
                { key: "setupPrice", label: "One-time setup price" },
              ] as const
            ).map((f) => (
              <label className="field" key={f.key}>
                <span>{f.label}</span>
                <input
                  required={f.key !== "thread" || p.technique === "Embroidery"}
                  aria-label={`Decoration ${i + 1} ${f.label}`}
                  value={p[f.key]}
                  onChange={(e) =>
                    placement(i, { ...p, [f.key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              update(
                "placements",
                document.placements.filter((_, j) => j !== i),
              )
            }
          >
            Remove decoration {i + 1}
          </Button>
        </section>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          update("placements", [
            ...document.placements,
            {
              technique: "Embroidery",
              location: "Left chest",
              logoAssetId: "",
              widthMm: "80",
              heightMm: "40",
              colors: "",
              thread: "",
              applicationInstructions: "",
              positionInstructions: "",
              unitPrice: "0",
              setupPrice: "0",
            },
          ])
        }
      >
        Add decoration
      </Button>
      <section className="spec-row" aria-live="polite">
        <h3>Customization estimate · {line?.currency ?? "select order"}</h3>
        {price ? (
          <p>
            {price.perUnit} × {line?.quantity ?? "—"} garments + {price.setup}{" "}
            setup = <strong>{price.total}</strong>
          </p>
        ) : (
          <p>Enter valid decimal prices to calculate the estimate.</p>
        )}
        <p className="muted">
          Server recalculates prices. Charges are applied to a draft order on
          design approval, before invoice tax. Merchandise discounts do not
          discount these separate services. Confirmed order prices are frozen.
        </p>
      </section>
      <div className="actions">
        <Button disabled={pending}>
          {pending ? "Saving…" : "Save branding draft"}
        </Button>
        <span role="alert">{message}</span>
      </div>
    </form>
  );
}
