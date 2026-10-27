"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { specificationAction } from "@/app/specification-actions";
export function SpecificationControls({
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
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  function act(action: "copy" | "submit" | "approve" | "reject") {
    start(async () => {
      const r = await specificationAction(action, { id, note });
      setMessage(r.message);
      if (r.ok) {
        if (action === "copy" && r.id)
          router.push(`/specifications/${r.id}?edit=1`);
        router.refresh();
      }
    });
  }
  return (
    <div className="no-print">
      <div className="actions">
        <Button variant="outline" onClick={() => window.print()}>
          Print technical sheet
        </Button>
        {edit && (
          <Button
            disabled={pending}
            variant="outline"
            onClick={() => act("copy")}
          >
            Create next version
          </Button>
        )}
        {edit && status === "Draft" && (
          <Button disabled={pending} onClick={() => act("submit")}>
            Submit for approval
          </Button>
        )}
      </div>
      {approve && status === "In Review" && (
        <>
          <label className="field">
            <span>Review note / rejection reason</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="actions">
            <Button disabled={pending} onClick={() => act("approve")}>
              Approve version
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => act("reject")}
            >
              Reject version
            </Button>
          </div>
        </>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
export function AttachmentUploader({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <form
      className="spec-upload no-print"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const form = e.currentTarget;
        try {
          const response = await fetch(
            `/api/specifications/${id}/attachments`,
            { method: "POST", body: new FormData(form) },
          );
          const r = await response.json();
          setMessage(r.message);
          if (response.ok) {
            form.reset();
            router.refresh();
          }
        } catch {
          setMessage("Upload failed. Please retry.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="field">
        <span>Attachment type</span>
        <select name="kind">
          {["Technical drawing", "Reference image", "Supporting document"].map(
            (k) => (
              <option key={k}>{k}</option>
            ),
          )}
        </select>
      </label>
      <label className="field">
        <span>PNG, JPEG or PDF · up to 2 MiB · maximum 12 files</span>
        <input
          required
          name="file"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
        />
      </label>
      <Button disabled={pending}>
        {pending ? "Uploading…" : "Upload attachment"}
      </Button>
      <span role="status">{message}</span>
    </form>
  );
}
export function RemoveAttachment({
  id,
  attachmentId,
}: {
  id: string;
  attachmentId: string;
}) {
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="no-print"
        onClick={async () => {
          if (!confirm("Remove this draft attachment?")) return;
          const r = await specificationAction("removeAttachment", {
            id,
            attachmentId,
          });
          if (r.ok) router.refresh();
          else setError(r.message);
        }}
      >
        Remove attachment
      </Button>
      <span role="alert">{error}</span>
    </>
  );
}
