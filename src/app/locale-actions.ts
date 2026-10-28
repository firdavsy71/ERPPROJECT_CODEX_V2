"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { locales, type Locale } from "@/i18n/messages";
export async function setLanguage(value: string) {
  if (!locales.includes(value as Locale))
    throw new Error("Unsupported language");
  (await cookies()).set("erp_locale", value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 31536000,
  });
  revalidatePath("/", "layout");
}
