import { currentActor } from "@/auth";
import {
  verifyPrivateBrandingStorage,
  brandingStorageConfigured,
} from "@/services/branding-storage";
export async function POST(request: Request) {
  const actor = await currentActor();
  if (!actor)
    return Response.json({ message: "Sign in required" }, { status: 401 });
  if (actor.role !== "admin")
    return Response.json(
      { message: "Administrator access required" },
      { status: 403 },
    );
  let same = false;
  try {
    const o = new URL(request.headers.get("origin") ?? "");
    same =
      o.host === (request.headers.get("host") ?? new URL(request.url).host) &&
      o.protocol ===
        (request.headers.get("x-forwarded-proto")
          ? `${request.headers.get("x-forwarded-proto")}:`
          : new URL(request.url).protocol);
  } catch {}
  if (!same)
    return Response.json({ message: "Invalid origin" }, { status: 403 });
  if (!brandingStorageConfigured())
    return Response.json(
      {
        message:
          "Private storage is not configured. Connect a private Vercel Blob store and set BLOB_READ_WRITE_TOKEN.",
      },
      { status: 503 },
    );
  try {
    const checks = await verifyPrivateBrandingStorage();
    return Response.json(
      {
        ...checks,
        message:
          "Private upload, authenticated read, checksum and cleanup verified.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        message:
          "Private storage verification failed. Check that the connected Blob store is private and its token has read/write access.",
      },
      { status: 503 },
    );
  }
}
