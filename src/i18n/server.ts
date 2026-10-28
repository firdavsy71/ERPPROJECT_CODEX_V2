import { cookies } from "next/headers";
import { resolveLocale } from "./messages";
export async function currentLocale() {
  return resolveLocale((await cookies()).get("erp_locale")?.value);
}
