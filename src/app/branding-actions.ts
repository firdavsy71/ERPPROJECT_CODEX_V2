"use server";
import { currentActor } from "@/auth";
import {
  saveBranding,
  copyBranding,
  transitionBranding,
  removeBrandingFile,
} from "@/services/branding";
import { revalidatePath } from "next/cache";
import { z } from "zod";
export async function brandingAction(
  action: "save" | "copy" | "submit" | "approve" | "reject" | "removeFile",
  input: { id?: string; data?: unknown; fileId?: string },
) {
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Sign in required" };
  try {
    let id = input.id;
    switch (action) {
      case "save":
        id = await saveBranding(actor, input.data, id);
        break;
      case "copy":
        id = await copyBranding(actor, z.uuid().parse(id));
        break;
      case "submit":
      case "approve":
      case "reject":
        await transitionBranding(
          actor,
          z.uuid().parse(id),
          action,
          input.data ?? {},
        );
        break;
      case "removeFile":
        await removeBrandingFile(
          actor,
          z.uuid().parse(id),
          z.uuid().parse(input.fileId),
        );
        break;
      default:
        throw new Error("Unknown action");
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved successfully", id };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : e instanceof Error && !("cause" in e) && !("query" in e)
            ? e.message
            : "Unable to save branding. Reload and verify the linked records.",
    };
  }
}
