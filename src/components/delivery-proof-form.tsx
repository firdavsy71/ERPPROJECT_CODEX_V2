"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
export function DeliveryProofForm({
  id,
  configured,
}: {
  id: string;
  configured: boolean;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          try {
            const response = await fetch(`/api/deliveries/${id}/proofs`, {
              method: "POST",
              body: form,
            });
            const data = await response.json();
            setMessage(data.message);
            if (response.ok) router.refresh();
          } catch {
            setMessage(
              "Upload could not complete; retry after checking connectivity",
            );
          }
        });
      }}
    >
      <label className="field">
        <span>Proof file · PNG, JPEG or PDF, maximum 2 MiB</span>
        <input
          name="file"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          required
          disabled={!configured || pending}
        />
      </label>
      <label className="field">
        <span>Proof / recipient notes</span>
        <textarea
          name="note"
          required
          minLength={3}
          maxLength={2000}
          disabled={!configured || pending}
        />
      </label>
      <button className="btn btn-primary" disabled={!configured || pending}>
        Upload private proof
      </button>
      {!configured && (
        <p className="muted">
          Private Vercel Blob storage must be connected before uploading
          delivery evidence.
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
