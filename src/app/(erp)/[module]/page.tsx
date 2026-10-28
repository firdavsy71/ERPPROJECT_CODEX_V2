import { notFound, redirect } from "next/navigation";
import { nav } from "@/lib/modules";
import { currentActor } from "@/auth";
import { data } from "@/services/queries";
import { ModuleView } from "@/components/module-view";
import { canReadModule } from "@/lib/permissions";
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  if (!nav.some((n) => n[0] === module)) notFound();
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!canReadModule(actor.role, module)) notFound();
  return <ModuleView module={module} d={await data()} actor={actor} />;
}
