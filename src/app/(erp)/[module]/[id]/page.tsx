import { notFound, redirect } from "next/navigation";
import { nav } from "@/lib/modules";
import { currentActor } from "@/auth";
import { data } from "@/services/queries";
import { ModuleView } from "@/components/module-view";
import { z } from "zod";
export default async function DetailPage({
  params,
}: {
  params: Promise<{ module: string; id: string }>;
}) {
  const { module, id } = await params;
  if (
    (!nav.some((n) => n[0] === module) && module !== "users") ||
    !z.uuid().safeParse(id).success
  )
    notFound();
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (module === "users" && actor.role !== "admin") notFound();
  return (
    <ModuleView module={module} recordId={id} d={await data()} actor={actor} />
  );
}
