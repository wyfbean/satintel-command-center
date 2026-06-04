/**
 * POST /api/auth/register
 * Body: { email: string, password: string, name?: string }
 *
 * Creates a new email/password user in the users table.
 * The Credentials provider `authorize()` only verifies — never creates —
 * so registration always goes through this dedicated endpoint.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/intel/db";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

type Body = { email?: string; password?: string; name?: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const { email, password, name = "" } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: "database unavailable" }, { status: 503 });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const id   = crypto.randomUUID();
  const hash = await hashPassword(password);
  const now  = Date.now();

  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, name.trim(), email.trim().toLowerCase(), hash, now, now);

  return NextResponse.json({ ok: true });
}
