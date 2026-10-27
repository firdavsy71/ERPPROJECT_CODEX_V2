import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import { users, loginAttempts } from "@/db/schema";
import type { Actor, Role } from "@/lib/permissions";
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const input = z
          .object({ email: z.email(), password: z.string().min(1).max(200) })
          .safeParse(credentials);
        if (!input.success) return null;
        const attemptKey = createHash("sha256")
          .update(input.data.email.toLowerCase())
          .digest("hex");
        const [attempt] = await db()
          .insert(loginAttempts)
          .values({ key: attemptKey })
          .onConflictDoUpdate({
            target: loginAttempts.key,
            set: {
              attempts: sql`case when ${loginAttempts.startedAt} < now() - interval '15 minutes' then 1 else ${loginAttempts.attempts} + 1 end`,
              startedAt: sql`case when ${loginAttempts.startedAt} < now() - interval '15 minutes' then now() else ${loginAttempts.startedAt} end`,
            },
          })
          .returning();
        if (attempt.attempts > 10) return null;
        const [user] = await db()
          .select()
          .from(users)
          .where(eq(users.email, input.data.email.toLowerCase()));
        // Always perform a hash comparison to reduce account enumeration timing differences.
        const valid = await compare(
          input.data.password,
          user?.passwordHash ??
            "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
        );
        if (!user?.active || !valid) return null;
        await db()
          .delete(loginAttempts)
          .where(eq(loginAttempts.key, attemptKey));
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) token.sub = user.id;
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [u] = await db()
    .select()
    .from(users)
    .where(eq(users.id, session.user.id));
  return u?.active ? { id: u.id, role: u.role as Role } : null;
}
