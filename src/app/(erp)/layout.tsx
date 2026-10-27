import { auth, currentActor } from "@/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
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
  return (
    <Shell name={session.user.name ?? "User"} role={actor.role}>
      {children}
    </Shell>
  );
}
