"use client";

import { useRef, useState, useTransition } from "react";
import Decimal from "decimal.js";
import { businessAction, type Result } from "@/app/actions";
import { Button } from "./ui/button";

export type ProductionRollMaterial = {
  materialId: string;
  reservationId?: string;
  label: string;
  required: string;
  tracked: boolean;
  rolls: { id: string; label: string; available: string; allocated: string }[];
};

export function ManufacturingRollForm({
  id,
  mode,
  materials,
  completed,
  qualityChecks,
  branded,
}: {
  id: string;
  mode: "plan" | "complete";
  materials: ProductionRollMaterial[];
  completed: number;
  qualityChecks: string[];
  branded: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const [key, setKey] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const label =
    mode === "plan"
      ? "Choose rolls & reserve materials"
      : "Verify roll consumption & complete";
  function open() {
    setResult(null);
    setKey(crypto.randomUUID());
    setValues(
      Object.fromEntries(
        materials.flatMap((material) =>
          material.tracked
            ? material.rolls.map((roll) => [
                roll.id,
                mode === "complete" ? roll.allocated : "0",
              ])
            : [[material.materialId, material.required]],
        ),
      ),
    );
    dialog.current?.showModal();
  }
  return (
    <>
      <Button onClick={open}>{label}</Button>
      {result?.ok && (
        <p className="success" role="status">
          {result.message}
        </p>
      )}
      <dialog ref={dialog} aria-labelledby={`roll-operation-${id}`}>
        <div className="dialog-header">
          <h2 id={`roll-operation-${id}`}>{label}</h2>
          <Button
            variant="ghost"
            aria-label="Close roll operation"
            onClick={() => dialog.current?.close()}
          >
            Close
          </Button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            start(async () => {
              try {
                const rollLines = materials
                  .filter((m) => m.tracked)
                  .flatMap((material) =>
                    material.rolls
                      .filter((roll) =>
                        new Decimal(values[roll.id] || "0").gt(0),
                      )
                      .map((roll) => ({
                        materialId: material.materialId,
                        reservationId: material.reservationId,
                        rollId: roll.id,
                        quantity: values[roll.id],
                      })),
                  );
                const consumption = materials.map((material) => ({
                  reservationId: material.reservationId,
                  quantity: material.tracked
                    ? material.rolls
                        .reduce(
                          (total, roll) => total.add(values[roll.id] || "0"),
                          new Decimal(0),
                        )
                        .toFixed(4)
                    : values[material.materialId],
                }));
                const input =
                  mode === "plan"
                    ? {
                        id,
                        rollAllocations: rollLines.map(
                          ({ materialId, rollId, quantity }) => ({
                            materialId,
                            rollId,
                            quantity,
                          }),
                        ),
                      }
                    : {
                        id,
                        consumption,
                        rollConsumption: rollLines.map(
                          ({ reservationId, rollId, quantity }) => ({
                            reservationId,
                            rollId,
                            quantity,
                          }),
                        ),
                        approved: String(data.get("approved")),
                        notes: String(data.get("notes") || ""),
                        brandingCheck: branded
                          ? String(data.get("brandingCheck"))
                          : undefined,
                        qualityResults: qualityChecks.map((check, index) => ({
                          check,
                          result: String(data.get(`check-${index}`)),
                          notes: "",
                        })),
                      };
                const response = await businessAction(mode, input, key);
                setResult(response);
                if (response.ok) dialog.current?.close();
              } catch {
                setResult({
                  ok: false,
                  message:
                    "Enter valid decimal lengths with no more than four decimal places.",
                });
              }
            });
          }}
        >
          <p className="muted">
            {mode === "plan"
              ? "Choose exact rolls and supplier batches. Each tracked material's allocated meters must equal its required meters."
              : "Record actual meters used, including rejected units. Unused reserved fabric is released automatically. Other orders' reserved fabric cannot be consumed."}
          </p>
          {materials.map((material) => (
            <fieldset key={material.materialId} className="line-editor">
              <legend>
                {material.label} · {material.required}{" "}
                {material.tracked ? "m" : "units"}{" "}
                {mode === "plan" ? "required" : "reserved"}
              </legend>
              {material.tracked ? (
                <>
                  {!material.rolls.length && (
                    <p className="error">
                      No available rolls. Receive identified rolls before
                      planning.
                    </p>
                  )}
                  {material.rolls.map((roll) => (
                    <label className="field" key={roll.id}>
                      <span>
                        {roll.label} · {roll.available} m available to this
                        order
                        {mode === "complete"
                          ? ` · ${roll.allocated} m allocated`
                          : ""}
                      </span>
                      <input
                        type="number"
                        min="0"
                        max={roll.available}
                        step="0.0001"
                        required
                        value={values[roll.id] ?? "0"}
                        aria-label={`${material.label}, ${roll.label}, ${mode === "plan" ? "allocate" : "consume"} meters`}
                        onChange={(event) =>
                          setValues((prior) => ({
                            ...prior,
                            [roll.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : mode === "complete" ? (
                <label className="field">
                  <span>Actual consumed</span>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    required
                    value={values[material.materialId] ?? material.required}
                    onChange={(event) =>
                      setValues((prior) => ({
                        ...prior,
                        [material.materialId]: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : (
                <p>Reserved through existing material inventory.</p>
              )}
            </fieldset>
          ))}
          {mode === "complete" && (
            <div className="form-grid">
              <label className="field">
                <span>Quality-approved units</span>
                <input
                  name="approved"
                  type="number"
                  min="0"
                  max={completed}
                  step="1"
                  required
                  defaultValue={completed}
                />
              </label>
              {branded && (
                <label className="field">
                  <span>Branding matches fixed approved proof</span>
                  <select name="brandingCheck" required>
                    <option value="">Select…</option>
                    <option>Pass</option>
                    <option>Fail</option>
                  </select>
                </label>
              )}
              {qualityChecks.map((check, index) => (
                <label key={check} className="field">
                  <span>QC: {check}</span>
                  <select name={`check-${index}`} required>
                    <option value="">Select…</option>
                    <option>Pass</option>
                    <option>Fail</option>
                  </select>
                </label>
              ))}
              <label className="field full">
                <span>Inspection notes</span>
                <textarea name="notes" maxLength={2000} />
              </label>
            </div>
          )}
          {result && !result.ok && (
            <p className="error" role="alert">
              {result.message}
            </p>
          )}
          <div className="dialog-footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </Button>
            <Button disabled={pending}>
              {pending
                ? "Saving…"
                : mode === "plan"
                  ? "Reserve selected rolls"
                  : "Approve & complete"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
