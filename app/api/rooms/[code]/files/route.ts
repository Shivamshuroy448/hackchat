import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import {
  addFile,
  blobEnabled,
  listFiles,
  normalizeCode,
  type FileMeta,
} from "@/lib/store";

export const dynamic = "force-dynamic";

// Vercel serverless functions cap request bodies around 4.5 MB on Hobby,
// so 4 MB is the safe ceiling for uploads through this route.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

type RouteParams = { params: Promise<{ code: string }> };

export async function GET(_req: NextRequest, ctx: RouteParams) {
  const { code } = await ctx.params;
  const room = normalizeCode(code);
  const files = await listFiles(room);
  return NextResponse.json({ room, files });
}

export async function POST(req: NextRequest, ctx: RouteParams) {
  const { code } = await ctx.params;
  const room = normalizeCode(code);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "request must be multipart form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const uploader =
    typeof form.get("name") === "string" && (form.get("name") as string).trim()
      ? ((form.get("name") as string).trim().slice(0, 40))
      : "anonymous";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file uploaded — send it as the "file" field' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "uploaded file is empty" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "file too big — max 4 MB per file" },
      { status: 413 },
    );
  }

  // strip path separators and odd characters from the original name
  const safeName =
    file.name.replace(/[\\/]/g, "_").replace(/[^\w.\-() ]/g, "_").slice(0, 120) || "file";

  let url: string;
  if (blobEnabled()) {
    try {
      const blob = await put(
        `hackchat/${room}/${Date.now()}-${safeName}`,
        file,
        { access: "public" },
      );
      url = blob.url;
    } catch (err) {
      console.error("blob upload failed:", err);
      return NextResponse.json(
        { error: "upload failed — blob storage is not reachable right now" },
        { status: 502 },
      );
    }
  } else {
    // Demo-only fallback (no BLOB_READ_WRITE_TOKEN): keep the bytes in
    // memory as a base64 data URL. Works for small files locally, does
    // not persist across deploys — set the token for real use.
    const buf = Buffer.from(await file.arrayBuffer());
    url = `data:${file.type || "application/octet-stream"};base64,${buf.toString("base64")}`;
  }

  const meta: FileMeta = {
    id: crypto.randomUUID(),
    name: safeName,
    size: file.size,
    uploader,
    time: new Date().toISOString(),
    url,
  };

  await addFile(room, meta);
  return NextResponse.json({ file: meta }, { status: 201 });
}
