"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { businessAction } from "@/app/actions";

export function EnableEmptyRollTracking({ options }: { options: { value: string; label: string }[] }) {
  const [materialId, setMaterialId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!options.length) return null;
  return <form className="actions" onSubmit={(e) => { e.preventDefault(); start(async () => { const result = await businessAction("activateRollTracking", { materialId, rolls: [] }, crypto.randomUUID()); setMessage(result.message); if (result.ok) router.refresh(); }); }}>
    <label className="field"><span>Empty material balance</span><select value={materialId} onChange={(e) => setMaterialId(e.target.value)} required><option value="">Select…</option>{options.map((o) => <option value={o.value} key={o.value}>{o.label}</option>)}</select></label>
    <button className="btn btn-outline" type="submit" disabled={pending}>Enable roll tracking for empty stock</button>{message && <span role="status">{message}</span>}
  </form>;
}
