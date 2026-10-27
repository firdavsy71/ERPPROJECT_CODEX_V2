"use client";
import { useState, useTransition, useRef } from "react";
import { useForm } from "react-hook-form";
import { Plus, X, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import type { Field } from "@/lib/modules";
import { businessAction, masterAction, type Result } from "@/app/actions";
import type { MasterModule } from "@/services/master";
import type { BusinessAction } from "@/services/operations";
type Option = { value: string; label: string };
export type LineConfig = { name: string; label: string; fields: Field[] };
export function ActionForm({
  label,
  title,
  fields = [],
  defaults = {},
  master,
  action,
  id,
  lines,
  secondary = false,
}: {
  label: string;
  title?: string;
  fields?: Field[];
  defaults?: Record<string, string>;
  master?: MasterModule;
  action?: BusinessAction;
  id?: string;
  lines?: LineConfig;
  secondary?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const [count, setCount] = useState(1);
  const [key, setKey] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Record<string, string>>({
    defaultValues: defaults,
    shouldUnregister: true,
  });
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    handleSubmit((values) => {
      start(async () => {
        const input: Record<string, unknown> = { ...values };
        if (lines) {
          const grouped: Record<string, string>[] = [];
          for (let i = 0; i < count; i++) {
            const line: Record<string, string> = {};
            for (const f of lines.fields) {
              line[f.name] = values[`${lines.name}__${i}__${f.name}`] ?? "";
              delete input[`${lines.name}__${i}__${f.name}`];
            }
            grouped.push(line);
          }
          input[lines.name] = grouped;
        }
        if (id && action) input.id = id;
        const r = master
          ? await masterAction(master, input, id)
          : await businessAction(action!, input, key);
        setResult(r);
        if (r.ok) {
          reset(defaults);
          setCount(1);
          dialog.current?.close();
        }
      });
    })(event);
  function field(f: Field, prefix = "") {
    const n = (prefix + f.name).replaceAll(".", "__");
    const attrs = {
      ...register(n, {
        required: f.required ? `${f.label} is required` : false,
      }),
      defaultValue: defaults[n] ?? f.default ?? "",
      id: `${label}-${n}`,
    };
    return (
      <label key={n} className={f.type === "textarea" ? "field full" : "field"}>
        <span>
          {f.label}
          {f.required ? " *" : ""}
        </span>
        {f.type === "select" ? (
          <select {...attrs}>
            <option value="">Select…</option>
            {f.options?.map((o: Option) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : f.type === "textarea" ? (
          <textarea {...attrs} rows={3} />
        ) : (
          <input
            {...attrs}
            type={f.type ?? "text"}
            step={f.type === "number" ? "0.0001" : undefined}
            min={f.type === "number" ? "0" : undefined}
            autoComplete={f.type === "password" ? "new-password" : undefined}
          />
        )}{" "}
        {errors[n] && (
          <small className="error">{String(errors[n]?.message)}</small>
        )}
      </label>
    );
  }
  return (
    <>
      <Button
        variant={secondary ? "outline" : "default"}
        onClick={() => {
          setKey(crypto.randomUUID());
          setResult(null);
          dialog.current?.showModal();
        }}
      >
        {secondary ? null : <Plus size={16} />} {label}
      </Button>
      {result?.ok && (
        <span role="status" className="success">
          {result.message}
        </span>
      )}
      <dialog ref={dialog}>
        <div className="dialog-header">
          <div>
            <p className="eyebrow">WORKWEAR / OPERATIONS</p>
            <h2>{title ?? label}</h2>
          </div>
          <Button
            variant="ghost"
            aria-label="Close dialog"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </Button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-grid">{fields.map((f) => field(f))}</div>
          {lines && (
            <div className="line-editor">
              <h3>{lines.label}</h3>
              {Array.from({ length: count }, (_, i) => (
                <div className="line-row" key={i}>
                  <span className="line-number">{i + 1}</span>
                  <div className="form-grid">
                    {lines.fields.map((f) => field(f, `${lines.name}.${i}.`))}
                  </div>
                </div>
              ))}
              <div className="line-buttons">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCount((c) => c + 1)}
                >
                  <Plus size={14} /> Add line
                </Button>
                {count > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCount((c) => c - 1)}
                  >
                    <Trash2 size={14} /> Remove last
                  </Button>
                )}
              </div>
            </div>
          )}
          {result && !result.ok && (
            <p className="error form-error" role="alert">
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
              {pending ? "Saving…" : "Save record"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
