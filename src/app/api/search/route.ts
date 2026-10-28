import { currentActor } from "@/auth";
import { searchRecords } from "@/services/search";
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", {status:401});
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.length > 100) return new Response("Query too long", {status:400});
  return Response.json({results:await searchRecords(actor,q)}, {headers:{"Cache-Control":"private, no-store"}});
}
