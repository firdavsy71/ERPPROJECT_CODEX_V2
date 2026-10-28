"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ComplianceUpload({
  id,
  materials,
  suppliers,
}: {
  id: string;
  materials: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <form
      className="spec-upload"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const form = e.currentTarget;
        try {
          const r = await fetch(`/api/compliance/${id}/attachments`, {
            method: "POST",
            body: new FormData(form),
          });
          const result = await r.json();
          setMessage(result.message);
          if (r.ok) {
            form.reset();
            router.refresh();
          }
        } catch {
          setMessage("Upload failed.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="field">
        <span>Evidence type</span>
        <select name="kind">
          {[
            "Certificate",
            "Testing report",
            "Material certification",
            "Supplier declaration",
          ].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Material (optional)</span>
        <select name="materialId">
          <option value="">None</option>
          {materials.map((m) => (
            <option value={m.id} key={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Supplier (optional)</span>
        <select name="supplierId">
          <option value="">None</option>
          {suppliers.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>PDF, PNG or JPEG, maximum 2 MiB</span>
        <input
          type="file"
          name="file"
          accept="application/pdf,image/png,image/jpeg"
          required
        />
      </label>
      <button className="btn" disabled={pending}>
        {pending ? "Uploading…" : "Upload evidence"}
      </button>
      <span role="status">{message}</span>
    </form>
  );
}
