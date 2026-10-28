import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute, type BusinessAction } from "../src/services/operations";
import {
  complianceStatus,
  expiresSoon,
  uploadComplianceEvidence,
  readComplianceEvidence,
} from "../src/services/compliance";
import type { Actor } from "../src/lib/permissions";
import { businessDate } from "../src/i18n/format";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor, product: string, standard: string;
const act = (action: BusinessAction, input: unknown, key = randomUUID()) =>
  execute(actor, action, input, key);
const fakeFile = {
  name: "sample.pdf",
  mime: "application/pdf",
  data: Buffer.from("%PDF-test evidence"),
};
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
beforeEach(async () => {
  await db().execute(sql`truncate users,warehouses,products cascade`);
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  actor = { id: u.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  [product] = (
    await db()
      .insert(s.products)
      .values({ name: "Jacket", sku: "JKT" })
      .returning()
  ).map((x) => x.id);
  await act("createSafetyStandard", {
    reference: "TEST STANDARD",
    title: "User supplied test reference",
  });
  [standard] = (await db().select().from(s.safetyStandards)).map((x) => x.id);
});
const fields = () => ({
  productId: product,
  specificationId: "",
  standardId: standard,
  certificateNumber: "CUSTOMER-PROVIDED-1",
  issuer: "Testing organization",
  issueDate: "2026-01-01",
  expiryDate: "2026-12-31",
  scope: "Jacket described in attached evidence",
});
it("requires admin approval of actual certificate evidence and preserves version history", async () => {
  await act("createCertification", fields());
  let [v] = await db().select().from(s.certifications);
  expect(complianceStatus(v, [v], "2026-10-28")).toBe("Draft");
  await uploadComplianceEvidence(
    actor,
    v.id,
    fakeFile,
    "Testing report",
    "",
    "",
  );
  await expect(
    act("approveCertification", { id: v.id, notes: "Reviewed" }),
  ).rejects.toThrow("actual certificate");
  await expect(
    db()
      .update(s.certifications)
      .set({ status: "Approved", approvedBy: actor.id, approvedAt: new Date() })
      .where(eq(s.certifications.id, v.id)),
  ).rejects.toThrow();
  await expect(
    uploadComplianceEvidence(
      { id: actor.id, role: "sales" },
      v.id,
      fakeFile,
      "Certificate",
      "",
      "",
    ),
  ).rejects.toThrow("permission");
  await uploadComplianceEvidence(actor, v.id, fakeFile, "Certificate", "", "");
  await act("approveCertification", {
    id: v.id,
    notes: "Verified issuer, scope and certificate",
  });
  [v] = await db().select().from(s.certifications);
  expect(complianceStatus(v, [v], "2026-10-28")).toBe("Certified");
  expect(expiresSoon(v, [v], "2026-12-05")).toBe(true);
  expect(complianceStatus(v, [v], "2027-01-01")).toBe("Expired");
  await expect(
    uploadComplianceEvidence(actor, v.id, fakeFile, "Certificate", "", ""),
  ).rejects.toThrow("frozen");
  await expect(
    db()
      .update(s.certifications)
      .set({ certificateNumber: "ALTERED" })
      .where(eq(s.certifications.id, v.id)),
  ).rejects.toThrow();
  const [file] = await db()
    .select()
    .from(s.certificationAttachments)
    .where(eq(s.certificationAttachments.certificationId, v.id));
  expect(
    (
      await readComplianceEvidence(
        { id: actor.id, role: "sales" },
        v.id,
        file.id,
      )
    )?.data.equals(fakeFile.data),
  ).toBe(true);
  await expect(
    readComplianceEvidence({ id: actor.id, role: "viewer" }, v.id, file.id),
  ).rejects.toThrow("permission");
  await act("createSafetyStandard", {
    reference: "OTHER",
    title: "Other reference",
  });
  const other = (await db().select().from(s.safetyStandards)).find(
    (x) => x.reference === "OTHER",
  )!;
  await expect(
    act("reviseCertification", { id: v.id, ...fields(), standardId: other.id }),
  ).rejects.toThrow("safety standard");
  await act("reviseCertification", {
    id: v.id,
    ...fields(),
    certificateNumber: "CUSTOMER-PROVIDED-2",
    issueDate: "2026-11-01",
    expiryDate: "2027-11-01",
  });
  const revisions = await db().select().from(s.certifications);
  const draft = revisions.find((x) => x.version === 2)!;
  expect(complianceStatus(v, revisions, "2026-10-28")).toBe("Certified");
  await expect(
    act("approveCertification", { id: draft.id, notes: "Reviewed" }),
  ).rejects.toThrow("actual certificate");
  await uploadComplianceEvidence(
    actor,
    draft.id,
    fakeFile,
    "Certificate",
    "",
    "",
  );
  await act("approveCertification", {
    id: draft.id,
    notes: "Verified revision",
  });
  const versions = await db().select().from(s.certifications);
  const next = versions.find((x) => x.version === 2)!;
  expect(complianceStatus(next, versions, "2026-10-28")).toBe("Not yet valid");
  expect(complianceStatus(v, versions, "2026-11-01")).toBe("Superseded");
  expect(complianceStatus(next, versions, "2026-11-01")).toBe("Certified");
  await act("revokeCertification", {
    id: next.id,
    notes: "Issuer withdrew certificate",
  });
  const revoked = await db().select().from(s.certifications);
  expect(
    complianceStatus(
      revoked.find((x) => x.id === next.id)!,
      revoked,
      "2026-11-02",
    ),
  ).toBe("Revoked");
  expect(complianceStatus(v, revoked, "2026-11-02")).toBe("Superseded");
  expect(
    (await db().select().from(s.certificationEvents)).length,
  ).toBeGreaterThan(3);
});
it("validates dates and product links without fabricating evidence", async () => {
  await expect(
    act("createCertification", { ...fields(), expiryDate: "2025-01-01" }),
  ).rejects.toThrow();
  await expect(
    act("createCertification", { ...fields(), certificateNumber: "" }),
  ).rejects.toThrow();
  await expect(
    execute(
      { id: actor.id, role: "production" },
      "createCertification",
      fields(),
      randomUUID(),
    ),
  ).rejects.toThrow("permission");
  await expect(
    uploadComplianceEvidence(
      actor,
      randomUUID(),
      { name: "x.pdf", mime: "application/pdf", data: Buffer.from("not pdf") },
      "Certificate",
      "",
      "",
    ),
  ).rejects.toThrow("valid");
});
it("uses the business calendar for certificate expiration and alerts at UTC boundaries", async () => {
  await act("createCertification", { ...fields(), expiryDate: "2026-11-28" });
  const [draft] = await db().select().from(s.certifications);
  await uploadComplianceEvidence(
    actor,
    draft.id,
    fakeFile,
    "Certificate",
    "",
    "",
  );
  await act("approveCertification", {
    id: draft.id,
    notes: "Evidence reviewed",
  });
  const versions = await db().select().from(s.certifications);
  const version = versions[0];
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-28T19:00:00Z"));
    expect(expiresSoon(version, versions)).toBe(true);
    expect(
      expiresSoon(version, versions, businessDate(new Date(), "UTC")),
    ).toBe(false);
    vi.setSystemTime(new Date("2026-11-28T18:59:59Z"));
    expect(complianceStatus(version, versions)).toBe("Certified");
    vi.setSystemTime(new Date("2026-11-28T19:00:00Z"));
    expect(complianceStatus(version, versions)).toBe("Expired");
    expect(expiresSoon(version, versions)).toBe(false);
    expect(
      complianceStatus(version, versions, businessDate(new Date(), "UTC")),
    ).toBe("Certified");
  } finally {
    vi.useRealTimers();
  }
});
