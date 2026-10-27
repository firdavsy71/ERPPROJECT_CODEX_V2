"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { brandingAction } from "@/app/branding-actions";
export function BrandingControls({
  id,
  status,
  edit,
  approve,
}: {
  id: string;
  status: string;
  edit: boolean;
  approve: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [customerApprover, setApprover] = useState("");
  const [approvalReference, setReference] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  function act(action: "copy" | "submit" | "approve" | "reject") {
    start(async () => {
      const r = await brandingAction(action, {
        id,
        data: { note, customerApprover, approvalReference },
      });
      setMessage(r.message);
      if (r.ok) {
        if (action === "copy" && r.id) router.push(`/branding/${r.id}?edit=1`);
        router.refresh();
      }
    });
  }
  return (
    <section className="no-print">
      <div className="actions">
        <Button variant="outline" onClick={() => window.print()}>
          Print branding instructions
        </Button>
        {edit && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => act("copy")}
          >
            Create branding revision
          </Button>
        )}
        {edit && status === "Draft" && (
          <Button disabled={pending} onClick={() => act("submit")}>
            Submit design proof
          </Button>
        )}
      </div>
      {approve && status === "In Review" && (
        <>
          <p className="muted">
            Record the customer&apos;s explicit approval. This records an
            employee&apos;s confirmation of external customer approval; it does
            not represent a customer portal signature.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>Customer approver</span>
              <input
                value={customerApprover}
                onChange={(e) => setApprover(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Customer approval reference</span>
              <input
                value={approvalReference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Email / signed proof / ticket reference"
              />
            </label>
            <label className="field full">
              <span>Design review note / rejection reason</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <div className="actions">
            <Button disabled={pending} onClick={() => act("approve")}>
              Approve customer design
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => act("reject")}
            >
              Reject customer design
            </Button>
          </div>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
export function BrandingUpload({
  id,
  revision,
  configured,
}: {
  id: string;
  revision: number;
  configured: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <section className="no-print">
      {!configured && (
        <p role="status" className="error">
          Private file storage is not connected. Connect a private Vercel Blob
          store and set BLOB_READ_WRITE_TOKEN. Drafts can be edited; uploads and
          approval require storage.
        </p>
      )}
      <form
        className="spec-upload"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          const form = e.currentTarget;
          const data = new FormData(form);
          data.set("revision", String(revision));
          try {
            const r = await fetch(`/api/branding/${id}/files`, {
              method: "POST",
              body: data,
            });
            const body = await r.json();
            setMessage(body.message);
            if (r.ok) {
              form.reset();
              router.refresh();
            }
          } catch {
            setMessage(
              "Upload failed. Retry after checking the private storage connection.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="field">
          <span>Branding file purpose</span>
          <select name="purpose" disabled={!configured}>
            {["Logo", "Design proof", "Reference"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Private logo / proof / reference file (PNG, JPEG, PDF; max 2 MiB)
          </span>
          <input
            type="file"
            name="file"
            accept="image/png,image/jpeg,application/pdf"
            required
            disabled={!configured}
          />
        </label>
        <Button disabled={pending || !configured}>
          {pending ? "Uploading…" : "Upload private branding file"}
        </Button>
        <span role="status">{message}</span>
      </form>
    </section>
  );
}
export function BrandingRemoveFile({
  id,
  fileId,
}: {
  id: string;
  fileId: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  return (
    <>
      <Button
        className="no-print"
        variant="ghost"
        size="sm"
        onClick={async () => {
          if (
            !confirm(
              "Unlink this file from the draft? Approved originals are retained securely.",
            )
          )
            return;
          const r = await brandingAction("removeFile", { id, fileId });
          setMessage(r.message);
          if (r.ok) router.refresh();
        }}
      >
        Unlink file
      </Button>
      <span role="status">{message}</span>
    </>
  );
}
export function BrandingStorageCheck() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div className="actions">
      <Button
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const r = await fetch("/api/branding/storage/check", {
              method: "POST",
            });
            const result = await r.json();
            setMessage(result.message);
          } catch {
            setMessage("Storage check could not complete. Please retry.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Checking…" : "Check private storage"}
      </Button>
      <span role="status">{message}</span>
    </div>
  );
}
