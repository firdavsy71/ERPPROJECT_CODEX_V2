import { config } from "dotenv";
config({path: ".env.local",quiet:true});
config({quiet:true});

/** Read-only checks; output deliberately excludes URLs, tokens, accounts and errors. */
const present = (key: string) => Boolean(process.env[key]?.trim());
const checks: Record<string, boolean | string> = {
  databaseConfigured: present("DATABASE_URL"),
  authSecretConfigured: present("AUTH_SECRET") || present("NEXTAUTH_SECRET"),
  authUrlConfigured: present("AUTH_URL") || present("NEXTAUTH_URL"),
  blobTokenConfigured: present("BLOB_READ_WRITE_TOKEN"),
  vercelCredentialConfigured: present("VERCEL_TOKEN"),
  neonManagementCredentialConfigured: present("NEON_API_KEY"),
};
let failed = false;
try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  checks.neonEndpoint = url.hostname.endsWith(".neon.tech");
  checks.databaseTlsRequired = ["require", "verify-full", "verify-ca"].includes(url.searchParams.get("sslmode") ?? "");
} catch { checks.databaseUrlValid = false; }
try {
  const url = new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "");
  checks.authUrlValid = ["http:","https:"].includes(url.protocol);
  checks.authUrlLocal = ["localhost","127.0.0.1","0.0.0.0"].includes(url.hostname);
  if(process.env.VERCEL === "1" && (url.protocol !== "https:" || checks.authUrlLocal)) failed = true;
} catch { checks.authUrlValid = false; }
if (!checks.databaseConfigured || !checks.authSecretConfigured || !checks.authUrlValid) failed = true;
if (process.argv.includes("--database")) {
  const {db,localClient,neonClient} = await import("../src/db");
  const {sql} = await import("drizzle-orm");
  try {
    await db().transaction(async tx => { await tx.execute(sql`SELECT 1`); }, {accessMode:"read only"});
    checks.databaseRead = true;
  } catch { checks.databaseRead = false; failed = true; }
  finally { await localClient()?.close(); await neonClient()?.end(); }
}
if (process.argv.includes("--storage")) {
  if (!checks.blobTokenConfigured) {checks.storageRead = "blocked_missing_token";failed = true;}
  else {
    try {
      const {list} = await import("@vercel/blob");
      const result = await list({limit:1,token:process.env.BLOB_READ_WRITE_TOKEN});
      checks.storageRead = true;
      checks.privateObjectOrigin = result.blobs.length ? new URL(result.blobs[0].url).hostname.endsWith(".private.blob.vercel-storage.com") : "unverified_empty_store";
      if(checks.privateObjectOrigin === false) failed = true;
    } catch {checks.storageRead = false;failed = true;}
  }
}
console.log(JSON.stringify({checks,storageWriteAndAnonymousDenial:"not_checked_read_only"},null,2));
process.exit(failed ? 1 : 0);
