"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import {
  blankDocument,
  garmentTypes,
  type SpecDocument,
  type VariantSpec,
} from "@/lib/specification";
import { specificationAction } from "@/app/specification-actions";
type Choice = { id: string; name: string };
type VariantChoice = {
  id: string;
  productId: string;
  sku: string;
  size: string;
  color: string;
};
export function RowsEditor<T extends Record<string, string>>({
  label,
  rows,
  fields,
  create,
  onChange,
  options = {},
}: {
  label: string;
  rows: T[];
  fields: { key: keyof T; label: string }[];
  create: T;
  onChange: (rows: T[]) => void;
  options?: Partial<Record<keyof T, readonly string[]>>;
}) {
  return (
    <section className="spec-rows" aria-label={label}>
      <div className="section-heading"><h3>{label}</h3><span className="muted">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span></div>
      {rows.map((r, i) => (
        <div className="spec-row" key={i}>
          <div className="form-grid">
            {fields.map((f) => (
              <label className="field" key={String(f.key)}>
                <span>{f.label}</span>
                {options[f.key] ? (
                  <select
                    aria-label={`${label} ${i + 1} ${f.label}`}
                    value={r[f.key]}
                    onChange={(e) =>
                      onChange(
                        rows.map((x, j) =>
                          j === i ? { ...x, [f.key]: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {options[f.key]!.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    aria-label={`${label} ${i + 1} ${f.label}`}
                    value={r[f.key]}
                    onChange={(e) =>
                      onChange(
                        rows.map((x, j) =>
                          j === i ? { ...x, [f.key]: e.target.value } : x,
                        ),
                      )
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            Remove {label.toLowerCase()} {i + 1}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...rows, { ...create }])}
      >
        Add {label.toLowerCase()}
      </Button>
    </section>
  );
}
export const measurementFields = [
  { key: "point", label: "Measurement point" },
  { key: "size", label: "Size" },
  { key: "target", label: "Target" },
  { key: "tolerance", label: "Tolerance ±" },
  { key: "unit", label: "Unit" },
] as const;
export const newMeasurement = {
  point: "",
  size: "L",
  target: "1",
  tolerance: "0.5",
  unit: "cm" as const,
};
export function SpecificationEditor({
  products,
  variants,
  initial,
  productId: preferred,
}: {
  products: Choice[];
  variants: VariantChoice[];
  productId?: string;
  initial?: {
    id: string;
    productId: string;
    title: string;
    changeNote: string;
    revision: number;
    document: SpecDocument;
    variants: VariantSpec[];
  };
}) {
  const router = useRouter();
  const [productId, setProduct] = useState(
    initial?.productId ?? preferred ?? "",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [changeNote, setChange] = useState(initial?.changeNote ?? "");
  const [document, setDocument] = useState(initial?.document ?? blankDocument);
  const [covered, setCovered] = useState<VariantSpec[]>(
    initial?.variants ?? [],
  );
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  function updateDoc<K extends keyof SpecDocument>(
    k: K,
    value: SpecDocument[K],
  ) {
    setDocument((d) => ({ ...d, [k]: value }));
  }
  return (
    <form
      className="detail-card spec-editor"
      aria-label="Technical specification editor"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await specificationAction("save", {
            id: initial?.id,
            data: {
              productId,
              title,
              changeNote,
              document,
              variants: covered,
              revision: initial?.revision,
            },
          });
          setMessage(r.message);
          if (r.ok && r.id) {
            router.push(`/specifications/${r.id}`);
            router.refresh();
          }
        });
      }}
    >
      <header className="editor-intro">
        <p className="eyebrow">PRODUCT ENGINEERING / DRAFT WORKSPACE</p>
        <h2>{initial ? "Refine the specification" : "Define the garment"}</h2>
        <p className="muted">Work from product identity to construction, measurements and variant requirements. Saving a draft does not approve it for production.</p>
        <nav className="editor-nav" aria-label="Specification sections">
          <a href="#spec-identity">01 / Identity</a>
          <a href="#spec-fabric">02 / Fabric</a>
          <a href="#spec-variants">03 / Variants</a>
          <a href="#spec-save">Save draft</a>
        </nav>
      </header>
      <fieldset disabled={pending} className="editor-fields">
      <legend className="sr-only">Specification contents</legend>
      <h2 id="spec-identity">Product identity & construction</h2>
      <div className="form-grid">
        <label className="field">
          <span>Product</span>
          <select
            required
            disabled={!!initial}
            value={productId}
            onChange={(e) => {
              setProduct(e.target.value);
              setCovered([]);
            }}
          >
            <option value="">Select product…</option>
            {products.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Specification title</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Garment type</span>
          <select
            value={document.garmentType}
            onChange={(e) =>
              updateDoc(
                "garmentType",
                e.target.value as SpecDocument["garmentType"],
              )
            }
          >
            {garmentTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Revision / change summary</span>
          <input
            required
            value={changeNote}
            onChange={(e) => setChange(e.target.value)}
          />
        </label>
        {(
          ["description", "construction", "manufacturingInstructions"] as const
        ).map((k) => (
          <label className="field full" key={k}>
            <span>
              {
                {
                  description: "Description",
                  construction:
                    "Garment construction (panels, pockets, lining, set components)",
                  manufacturingInstructions: "Manufacturing instructions",
                }[k]
              }
            </span>
            <textarea
              rows={4}
              value={document[k]}
              onChange={(e) => updateDoc(k, e.target.value)}
            />
          </label>
        ))}
      </div>
      <h2 id="spec-fabric">Fabric specifications & composition</h2>
      {document.fabrics.map((f, i) => (
        <section className="spec-row" key={i}>
          <div className="form-grid">
            {(["name", "weightGsm", "weave", "finish"] as const).map((k) => (
              <label className="field" key={k}>
                <span>
                  {
                    {
                      name: "Fabric name",
                      weightGsm: "Weight (g/m²)",
                      weave: "Weave / construction",
                      finish: "Finish / protection",
                    }[k]
                  }
                </span>
                <input
                  value={f[k]}
                  required={k === "name" || k === "weightGsm"}
                  onChange={(e) =>
                    updateDoc(
                      "fabrics",
                      document.fabrics.map((x, j) =>
                        i === j ? { ...x, [k]: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <RowsEditor
            label="Composition"
            rows={f.composition}
            fields={[
              { key: "fiber", label: "Fiber" },
              { key: "percent", label: "Percent" },
            ]}
            create={{ fiber: "", percent: "100" }}
            onChange={(v) =>
              updateDoc(
                "fabrics",
                document.fabrics.map((x, j) =>
                  i === j ? { ...x, composition: v } : x,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              updateDoc(
                "fabrics",
                document.fabrics.filter((_, j) => i !== j),
              )
            }
          >
            Remove fabric
          </Button>
        </section>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          updateDoc("fabrics", [
            ...document.fabrics,
            {
              name: "",
              weightGsm: "240",
              weave: "",
              finish: "",
              composition: [{ fiber: "", percent: "100" }],
            },
          ])
        }
      >
        Add fabric
      </Button>
      <RowsEditor
        label="Size chart measurements"
        rows={document.measurements}
        fields={measurementFields.map((f) => ({ ...f }))}
        create={newMeasurement}
        options={{ unit: ["cm", "mm"] }}
        onChange={(v) => updateDoc("measurements", v)}
      />
      <RowsEditor
        label="Seams"
        rows={document.seams}
        fields={[
          { key: "location", label: "Location / component" },
          { key: "stitchType", label: "Stitch type" },
          { key: "seamType", label: "Seam type" },
          { key: "stitchesPerCm", label: "Stitches / cm" },
          { key: "thread", label: "Thread specification" },
          { key: "allowanceMm", label: "Seam allowance (mm)" },
        ]}
        create={{
          location: "",
          stitchType: "",
          seamType: "",
          stitchesPerCm: "4",
          thread: "",
          allowanceMm: "10",
        }}
        onChange={(v) => updateDoc("seams", v)}
      />
      <RowsEditor
        label="Reflective tape"
        rows={document.reflectiveTape}
        fields={[
          { key: "location", label: "Garment location" },
          { key: "widthMm", label: "Width (mm)" },
          { key: "placement", label: "Placement / distance from datum" },
          { key: "standard", label: "Required standard / grade (or N/A)" },
        ]}
        create={{ location: "", widthMm: "50", placement: "", standard: "N/A" }}
        onChange={(v) => updateDoc("reflectiveTape", v)}
      />
      <RowsEditor<SpecDocument["accessories"][number]>
        label="Accessories"
        rows={document.accessories}
        fields={[
          { key: "type", label: "Type" },
          { key: "description", label: "Specification" },
          { key: "quantity", label: "Quantity per garment" },
          { key: "placement", label: "Placement" },
        ]}
        options={{
          type: [
            "Zipper",
            "Button",
            "Thread",
            "Velcro",
            "Elastic",
            "Label",
            "Other",
          ],
        }}
        create={{
          type: "Zipper",
          description: "",
          quantity: "1",
          placement: "",
        }}
        onChange={(v) => updateDoc("accessories", v)}
      />
      <RowsEditor
        label="Quality checks"
        rows={document.qualityChecks.map((check) => ({ check }))}
        fields={[{ key: "check", label: "Acceptance criterion" }]}
        create={{ check: "" }}
        onChange={(v) =>
          updateDoc(
            "qualityChecks",
            v.map((r) => r.check),
          )
        }
      />
      <h2 id="spec-variants">Variant manufacturing details</h2>
      <p className="muted">
        Select the variants covered by this version. Each requires fabric
        consumption. Empty measurement overrides inherit the size chart; empty
        instructions inherit the general instructions.
      </p>
      {variants
        .filter((v) => v.productId === productId)
        .map((v) => {
          const entry = covered.find((c) => c.variantId === v.id);
          const set = (value: VariantSpec) =>
            setCovered((rows) =>
              rows.map((r) => (r.variantId === v.id ? value : r)),
            );
          return (
            <section className="spec-row" key={v.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!!entry}
                  onChange={(e) =>
                    setCovered((rows) =>
                      e.target.checked
                        ? [
                            ...rows,
                            {
                              variantId: v.id,
                              fabricConsumption: "1",
                              consumptionUnit: "Meters",
                              instructions: "",
                              measurements: [],
                            },
                          ]
                        : rows.filter((r) => r.variantId !== v.id),
                    )
                  }
                />{" "}
                {v.sku} · {v.size} / {v.color}
              </label>
              {entry && (
                <>
                  <div className="form-grid">
                    <label className="field">
                      <span>Fabric consumption per unit</span>
                      <input
                        required
                        value={entry.fabricConsumption}
                        onChange={(e) =>
                          set({ ...entry, fabricConsumption: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Consumption unit</span>
                      <select
                        value={entry.consumptionUnit}
                        onChange={(e) =>
                          set({
                            ...entry,
                            consumptionUnit: e.target
                              .value as VariantSpec["consumptionUnit"],
                          })
                        }
                      >
                        {["Meters", "Kilograms", "Pieces"].map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field full">
                      <span>Variant instructions</span>
                      <textarea
                        value={entry.instructions}
                        onChange={(e) =>
                          set({ ...entry, instructions: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <RowsEditor
                    label={`${v.sku} measurement overrides`}
                    rows={entry.measurements}
                    fields={measurementFields.map((f) => ({ ...f }))}
                    options={{ unit: ["cm", "mm"] }}
                    create={{ ...newMeasurement, size: v.size }}
                    onChange={(m) => set({ ...entry, measurements: m })}
                  />
                </>
              )}
            </section>
          );
        })}
      </fieldset>
      <div className="actions editor-actions" id="spec-save">
        <Button disabled={pending}>{pending ? "Saving…" : "Save draft"}</Button>
        <span role="status" aria-live="polite">{message}</span>
      </div>
      <p className="muted">
        Upload drawings and reference images after saving the draft.
      </p>
    </form>
  );
}
