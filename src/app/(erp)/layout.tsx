import { auth, currentActor } from "@/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { RegionalProvider } from "@/components/regional-provider";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
export default async function ERPLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const theme = (await cookies()).get("erp_theme")?.value === "dark" ? "dark" : "light";
  const [company] = await db()
    .select({ timezone: settings.timezone })
    .from(settings)
    .limit(1);
  return (
    <RegionalProvider timeZone={company?.timezone ?? "Asia/Tashkent"}>
      <Shell name={session.user.name ?? "User"} role={actor.role} initialTheme={theme}>
        {children}
      </Shell>
    </RegionalProvider>
  );
}
