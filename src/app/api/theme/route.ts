import { cookies } from "next/headers";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(request.url).protocol.replace(":", "");
  const expected = `${protocol}://${request.headers.get("host") ?? new URL(request.url).host}`;
  if (origin !== expected)
    return new Response("Forbidden", {status:403});
  let theme: unknown;
  try { theme = (await request.json()).theme; } catch { return new Response("Invalid request", {status:400}); }
  if (theme !== "light" && theme !== "dark") return new Response("Invalid theme", {status:400});
  (await cookies()).set("erp_theme", theme, {httpOnly:true,sameSite:"lax",secure:protocol === "https",path:"/",maxAge:31536000});
  return Response.json({theme});
}
