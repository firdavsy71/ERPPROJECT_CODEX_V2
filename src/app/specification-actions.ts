"use server";
import { currentActor } from "@/auth";
import {
  saveSpecification,
  transitionSpecification,
  copySpecification,
  removeSpecificationAttachment,
} from "@/services/specifications";
import { revalidatePath } from "next/cache";
import { z } from "zod";
export async function specificationAction(
  action:
    "save" | "copy" | "submit" | "approve" | "reject" | "removeAttachment",
  input: { id?: string; data?: unknown; note?: string; attachmentId?: string },
) {
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Sign in required" };
  try {
    let id = input.id;
    switch (action) {
      case "save":
        id = await saveSpecification(actor, input.data, id);
        break;
      case "copy":
        id = await copySpecification(actor, z.uuid().parse(id));
        break;
      case "submit":
      case "approve":
      case "reject":
        await transitionSpecification(
          actor,
          z.uuid().parse(id),
          action,
          input.note ?? "",
        );
        break;
      case "removeAttachment":
        await removeSpecificationAttachment(
          actor,
          z.uuid().parse(id),
          z.uuid().parse(input.attachmentId),
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
            : "Unable to save specification. Reload and check related records.",
    };
  }
}
