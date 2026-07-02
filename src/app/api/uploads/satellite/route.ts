import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPLOAD_DIR = process.env.SATINTEL_UPLOAD_DIR ?? "/root/autodl-tmp/model_outputs/uploads";
const MAX_BYTES = 512 * 1024 * 1024;

function safeName(name: string): string {
  const ext = path.extname(name).slice(0, 16);
  const stem = path.basename(name, ext).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "image";
  return `${stem}_${randomUUID()}${ext}`;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: `file too large (${file.size} bytes)` }, { status: 413 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = safeName(file.name);
  const dest = path.join(UPLOAD_DIR, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(dest, bytes);

  return NextResponse.json({
    ok: true,
    path: dest,
    filename,
    originalName: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
  });
}
