"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function CompanyLogoManager() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setPending(true);
          try {
            const r = await fetch("/api/company-logo", {
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
        <label className="field logo-upload-field">
          <span>Company logo · PNG or JPEG, up to 512 KiB</span>
          <input
            name="file"
            type="file"
            accept="image/png,image/jpeg"
            required
          />
        </label>
        <button className="btn btn-outline" disabled={pending}>
          Upload company logo
        </button>
        <span role="status">{message}</span>
      </form>
      <button
        className="btn btn-outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const r = await fetch("/api/company-logo", { method: "DELETE" });
            const result = await r.json();
            setMessage(result.message);
            if (r.ok) router.refresh();
          } catch {
            setMessage("Unable to remove logo.");
          } finally {
            setPending(false);
          }
        }}
      >
        Remove logo from future documents
      </button>
    </div>
  );
}
