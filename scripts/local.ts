import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env.local")) {
  console.log(".env.local already exists; preserved.");
  process.exit(0);
}
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".env.local",
  `PGLITE_DATA_DIR=.local/postgres\nAUTH_SECRET=${randomBytes(32).toString("hex")}\nAUTH_URL=http://localhost:3000\nADMIN_EMAIL=admin@workwear.local\nADMIN_PASSWORD=${randomBytes(24).toString("base64url")}\n`,
  { mode: 0o600 },
);
console.log(
  "Local configuration created. Read ADMIN_EMAIL and ADMIN_PASSWORD from ignored .env.local to sign in. No credentials printed.",
);
