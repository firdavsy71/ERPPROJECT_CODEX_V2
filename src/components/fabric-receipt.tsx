"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { businessAction } from "@/app/actions";
import { rollFields } from "@/lib/fabric-fields";

export function FabricReceipt({ orderId, lines }: { orderId: string; lines: { id: string; label: string }[] }) {
  const [count, setCount] = useState(1);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rolls = Array.from({ length: count }, (_, i) => Object.fromEntries(rollFields.map((f) => [f.name, String(form.get(`${i}-${f.name}`) ?? "")])));
    let total: string;
    try { total = rolls.reduce((sum, roll) => sum.add(roll.receivedLength), new Decimal(0)).toFixed(4); }
    catch { setMessage("Enter a valid length for each roll."); return; }
    start(async () => {
      const result = await businessAction("receive", { id: orderId, lines: [{ id: String(form.get("line")), quantity: total, rolls }] }, crypto.randomUUID());
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }
  return <form onSubmit={submit}>
    <label className="field"><span>Purchase order line</span><select name="line" required><option value="">Select…</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}</select></label>
    {Array.from({ length: count }, (_, i) => <fieldset className="line-editor" key={i}><legend>Roll {i + 1}</legend><div className="form-grid">{rollFields.map((f) => <label className="field" key={f.name}><span>{f.label}{f.required ? " *" : ""}</span>{f.type === "textarea" ? <textarea name={`${i}-${f.name}`} /> : <input name={`${i}-${f.name}`} required={f.required} type={f.type ?? "text"} step={f.type === "number" ? "0.0001" : undefined} min={f.type === "number" ? "0" : undefined} />}</label>)}</div></fieldset>)}
    <div className="actions"><button type="button" className="btn btn-outline" onClick={() => setCount((x) => x + 1)}>Add roll</button>{count > 1 && <button type="button" className="btn btn-outline" onClick={() => setCount((x) => x - 1)}>Remove last</button>}<button type="submit" className="btn btn-primary" disabled={pending || !lines.length}>Receive rolls</button></div>
    {message && <p role="status">{message}</p>}
  </form>;
}
