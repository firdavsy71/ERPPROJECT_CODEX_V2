import { put, get, del } from "@vercel/blob";
import { randomUUID, createHash } from "node:crypto";
export interface BrandingStorage {
  put(path: string, bytes: Buffer, mime: string): Promise<void>;
  read(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
}
function token() {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error(
      "Private file storage is not configured. Connect a private Vercel Blob store and set BLOB_READ_WRITE_TOKEN.",
    );
  return process.env.BLOB_READ_WRITE_TOKEN;
}
function pathAllowed(path: string) {
  if (!/^branding\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(path))
    throw new Error("Invalid storage object path");
}
export const privateBrandingStorage: BrandingStorage = {
  async put(path, bytes, mime) {
    pathAllowed(path);
    await put(path, bytes, {
      token: token(),
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: mime,
    });
  },
  async read(path) {
    pathAllowed(path);
    const blob = await get(path, {
      token: token(),
      access: "private",
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200)
      throw new Error("Private file not found");
    if (blob.blob.size > 2097152)
      throw new Error("Stored file exceeds its permitted size");
    const reader = blob.stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2097152) {
        await reader.cancel();
        throw new Error("Stored file exceeds its permitted size");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  },
  async remove(path) {
    pathAllowed(path);
    await del(path, { token: token() });
  },
};
export function brandingStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}
export async function verifyPrivateBrandingStorage() {
  const pathname = `branding/${randomUUID()}/${randomUUID()}`;
  const bytes = Buffer.from("Workwear ERP private storage connectivity check");
  let uploaded = false;
  try {
    const blob = await put(pathname, bytes, {
      token: token(),
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "text/plain",
    });
    uploaded = true;
    const read = await privateBrandingStorage.read(pathname);
    if (
      createHash("sha256").update(read).digest("hex") !==
      createHash("sha256").update(bytes).digest("hex")
    )
      throw new Error("Storage integrity verification failed");
    if (
      !new URL(blob.url).hostname.endsWith(".private.blob.vercel-storage.com")
    )
      throw new Error("Unexpected private storage origin");
    const anonymous = await fetch(blob.url, {
      redirect: "manual",
      cache: "no-store",
    });
    if (![401, 403, 404].includes(anonymous.status))
      throw new Error("Anonymous storage access must be denied");
    return {
      privateUpload: true,
      privateRead: true,
      integrity: true,
      anonymousAccessDenied: true,
    };
  } finally {
    if (uploaded) await privateBrandingStorage.remove(pathname);
  }
}
