"use client";
import { useState, useTransition, useRef, useId, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Plus, X, Trash2, LoaderCircle, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import type { Field } from "@/lib/modules";
import { businessAction, masterAction, type Result } from "@/app/actions";
import type { MasterModule } from "@/services/master";
import type { BusinessAction } from "@/services/operations";
import { useLocale, useTranslations } from "next-intl";
import { additionalLabels, labelKeys, resolveLocale } from "@/i18n/messages";
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
  initialLineCount = 1,
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
  initialLineCount?: number;
}) {
  const t = useTranslations("forms");
  const common = useTranslations("common");
  const locale = resolveLocale(useLocale());
  const translate = (text: string) =>
    labelKeys[text]
      ? t(labelKeys[text])
      : (additionalLabels[locale][text] ?? text);
  const dialog = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const [count, setCount] = useState(initialLineCount);
  const [key, setKey] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<Record<string, string>>({
    defaultValues: defaults,
    shouldUnregister: true,
  });
  const hasChanges = isDirty || count !== initialLineCount;
  const discardMessage =
    locale === "ru"
      ? "Закрыть форму и удалить несохранённые изменения?"
      : locale === "uz"
        ? "Saqlanmagan o‘zgarishlarni bekor qilib, shakl yopilsinmi?"
        : "Discard unsaved changes and close this form?";
  const closeDialog = () => {
    if (pending || (hasChanges && !window.confirm(discardMessage))) return;
    dialog.current?.close();
    setOpen(false);
    reset(defaults);
    setCount(initialLineCount);
  };
  useEffect(() => {
    if (!open || !hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, hasChanges]);
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    handleSubmit((values) => {
      start(async () => {
        try {
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
            setCount(initialLineCount);
            dialog.current?.close();
            setOpen(false);
          }
        } catch {
          setResult({
            ok: false,
            message:
              locale === "ru"
                ? "Не удалось получить результат. Проверьте соединение и состояние документа перед повтором."
                : locale === "uz"
                  ? "Natija olinmadi. Qayta urinishdan oldin ulanish va hujjat holatini tekshiring."
                  : "Unable to confirm the result. Check your connection and document status before retrying.",
          });
        }
      });
    })(event);
  function field(f: Field, prefix = "") {
    const n = (prefix + f.name).replaceAll(".", "__");
    const attrs = {
      ...register(n, {
        required: f.required
          ? `${translate(f.label)} ${common("required")}`
          : false,
      }),
      defaultValue: defaults[n] ?? f.default ?? "",
      id: `${formId}-${n}`,
      "aria-invalid": Boolean(errors[n]),
      "aria-describedby": errors[n] ? `${formId}-${n}-error` : undefined,
      "aria-required": Boolean(f.required),
    };
    return (
      <label key={n} className={f.type === "textarea" ? "field full" : "field"}>
        <span>
          {translate(f.label)}
          {f.required ? " *" : ""}
        </span>
        {f.type === "select" ? (
          <select {...attrs}>
            <option value="">{common("select")}</option>
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
          <small id={`${formId}-${n}-error`} className="error" role="alert">
            {String(errors[n]?.message)}
          </small>
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
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {secondary ? null : <Plus size={16} />} {translate(label)}
      </Button>
      {result?.ok && (
        <span role="status" className="success">
          {result.message}
        </span>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`${formId}-title`}
        aria-busy={pending}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">WORKWEAR / OPERATIONS</p>
            <h2 id={`${formId}-title`}>{translate(title ?? label)}</h2>
          </div>
          <Button
            variant="ghost"
            aria-label={translate("Close dialog")}
            onClick={closeDialog}
            disabled={pending}
          >
            <X size={20} />
          </Button>
        </div>
        <form onSubmit={onSubmit}>
          <fieldset
            className="dialog-content"
            disabled={pending}
            style={{ border: 0, margin: 0, minWidth: 0 }}
          >
            <div className="form-grid">{fields.map((f) => field(f))}</div>
            {lines && (
              <div className="line-editor">
                <h3>
                  {translate(lines.label)}{" "}
                  <span className="muted">· {count}</span>
                </h3>
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
                    <Plus size={14} /> {translate("Add line")}
                  </Button>
                  {count > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCount((c) => c - 1)}
                    >
                      <Trash2 size={14} /> {translate("Remove last")}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {result && !result.ok && (
              <div className="error form-error" role="alert">
                <p><AlertCircle size={16} aria-hidden="true" /> {result.code === "SESSION_EXPIRED" && locale === "ru" ? "Сессия завершена. Войдите снова, затем вернитесь в это окно и повторите действие." : result.code === "SESSION_EXPIRED" && locale === "uz" ? "Sessiya tugadi. Qayta kiring, so‘ng bu oynaga qaytib amalni takrorlang." : result.message}</p>
                {result.code === "SESSION_EXPIRED" && <a className="btn btn-outline" href="/login" target="_blank" rel="noopener noreferrer">{locale === "ru" ? "Войти в новой вкладке" : locale === "uz" ? "Yangi sahifada kirish" : "Sign in in a new tab"}</a>}
              </div>
            )}
          </fieldset>
          <div className="dialog-footer">
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={pending}
            >
              {common("cancel")}
            </Button>
            <Button disabled={pending}>
              {pending && (
                <LoaderCircle
                  size={16}
                  className="saving-spinner"
                  aria-hidden="true"
                />
              )}
              {pending ? translate("Saving…") : common("save")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
