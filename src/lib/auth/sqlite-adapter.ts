/**
 * Custom NextAuth v5 adapter backed by our existing better-sqlite3 singleton.
 *
 * Implements only the methods NextAuth actually calls in JWT + OAuth mode:
 *   createUser, getUser, getUserByEmail, getUserByAccount, updateUser, linkAccount
 *
 * Session and verification-token methods are stubs — they will never be called
 * while session strategy is "jwt" and no email-magic-link provider is used.
 */

import type { Adapter } from "next-auth/adapters";
import { getDb } from "@/lib/intel/db";

type UserRow = { id: string; name: string; email: string | null; image: string };

function rowToUser(row: UserRow) {
  return {
    id:            row.id,
    name:          row.name ?? "",
    email:         row.email ?? "",
    emailVerified: null,
    image:         row.image ?? "",
  };
}

export function getSQLiteAdapter(): Adapter {
  return {
    createUser(user) {
      const db = getDb()!;
      const id  = crypto.randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO users (id, name, email, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, user.name ?? "", user.email ?? null, user.image ?? "", now, now);
      return { ...rowToUser({ id, name: user.name ?? "", email: user.email ?? null, image: user.image ?? "" }) };
    },

    getUser(id) {
      const db = getDb();
      if (!db) return null;
      const row = db.prepare("SELECT id, name, email, image FROM users WHERE id = ?").get(id) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    },

    getUserByEmail(email) {
      const db = getDb();
      if (!db) return null;
      const row = db.prepare("SELECT id, name, email, image FROM users WHERE email = ?").get(email) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    },

    getUserByAccount({ provider, providerAccountId }) {
      const db = getDb();
      if (!db) return null;
      const row = db.prepare(`
        SELECT u.id, u.name, u.email, u.image
        FROM users u
        JOIN accounts a ON a.user_id = u.id
        WHERE a.provider = ? AND a.provider_account_id = ?
      `).get(provider, providerAccountId) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    },

    updateUser(user) {
      const db = getDb()!;
      const now = Date.now();
      db.prepare(
        "UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), image = COALESCE(?, image), updated_at = ? WHERE id = ?",
      ).run(user.name ?? null, user.email ?? null, user.image ?? null, now, user.id);
      const updated = db.prepare("SELECT id, name, email, image FROM users WHERE id = ?").get(user.id) as UserRow;
      return rowToUser(updated);
    },

    linkAccount(account) {
      const db = getDb()!;
      db.prepare(
        "INSERT OR IGNORE INTO accounts (id, user_id, provider, provider_account_id) VALUES (?, ?, ?, ?)",
      ).run(crypto.randomUUID(), account.userId, account.provider, account.providerAccountId);
      return account;
    },

    async deleteUser(id) {
      const db = getDb();
      db?.prepare("DELETE FROM users WHERE id = ?").run(id);
    },

    async unlinkAccount({ provider, providerAccountId }) {
      const db = getDb();
      db?.prepare("DELETE FROM accounts WHERE provider = ? AND provider_account_id = ?").run(provider, providerAccountId);
    },

    // ── JWT strategy: session methods are never invoked ──────────────────
    createSession:           async () => { throw new Error("createSession: unused with JWT strategy"); },
    getSessionAndUser:       async () => null,
    updateSession:           async () => null,
    deleteSession:           async () => undefined,
    createVerificationToken: async () => null,
    useVerificationToken:    async () => null,
  };
}
