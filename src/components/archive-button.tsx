"use client";
import { useState, useTransition } from "react";
import { archiveAction } from "@/app/actions";
import { Button } from "./ui/button";
export function ArchiveButton({ module, id }: { module: string; id: string }) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (
            confirm(
              "Archive this record? Historical transactions will be retained.",
            )
          )
            start(async () => {
              const r = await archiveAction(module, id);
              setMessage(r.message);
            });
        }}
      >
        Archive
      </Button>
      <span role="status">{message}</span>
    </>
  );
}
