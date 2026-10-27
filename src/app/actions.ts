"use server";
import { currentActor, signIn, signOut } from "@/auth";
import { execute, type BusinessAction } from "@/services/operations";
import {
  saveMaster,
  archiveMaster,
  type MasterModule,
} from "@/services/master";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { z } from "zod";
export type Result = { ok: boolean; message: string };
async function run(
  operation: (
    actor: NonNullable<Awaited<ReturnType<typeof currentActor>>>,
  ) => Promise<void>,
): Promise<Result> {
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Please sign in again." };
  try {
    await operation(actor);
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved successfully." };
  } catch (e) {
    if (e instanceof z.ZodError)
      return {
        ok: false,
        message: e.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      };
    const known = e instanceof Error && !("query" in e) && !("cause" in e);
    return {
      ok: false,
      message: known
        ? e.message
        : "Operation could not be saved. Check unique SKUs, related records and numeric limits.",
    };
  }
}
export async function businessAction(
  action: BusinessAction,
  input: unknown,
  key: string,
) {
  return run((a) => execute(a, action, input, key));
}
export async function masterAction(
  module: MasterModule,
  input: unknown,
  id?: string,
) {
  return run((a) => saveMaster(a, module, input, id));
}
export async function archiveAction(module: string, id: string) {
  return run((a) => archiveMaster(a, module, id));
}
export async function loginAction(_: Result, form: FormData): Promise<Result> {
  try {
    await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirectTo: "/dashboard",
    });
    return { ok: true, message: "" };
  } catch (e) {
    if (e instanceof AuthError)
      return {
        ok: false,
        message: "Unable to sign in. Check your credentials.",
      };
    throw e;
  }
}
export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
