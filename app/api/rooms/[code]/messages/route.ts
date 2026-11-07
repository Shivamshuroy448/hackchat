import { NextRequest, NextResponse } from "next/server";
import {
  addMessage,
  listMessages,
  normalizeCode,
  type ChatMessage,
} from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_TEXT_CHARS = 50_000;
const MAX_CODE_CHARS = 100_000;

type RouteParams = { params: Promise<{ code: string }> };

export async function GET(_req: NextRequest, ctx: RouteParams) {
  const { code } = await ctx.params;
  const room = normalizeCode(code);
  const messages = await listMessages(room);
  return NextResponse.json({ room, messages });
}

export async function POST(req: NextRequest, ctx: RouteParams) {
  const { code } = await ctx.params;
  const room = normalizeCode(code);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "request body must be valid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "request body must be a json object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
  const text = typeof b.text === "string" ? b.text : "";
  const type = b.type === "code" ? "code" : "text";
  const language =
    typeof b.language === "string" && b.language.trim()
      ? b.language.trim().slice(0, 30)
      : undefined;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "message text cannot be empty" }, { status: 400 });
  }
  const max = type === "code" ? MAX_CODE_CHARS : MAX_TEXT_CHARS;
  if (text.length > max) {
    return NextResponse.json(
      { error: `message too long — max ${max.toLocaleString()} characters` },
      { status: 413 },
    );
  }

  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    name,
    type,
    text,
    language: type === "code" ? language : undefined,
    time: new Date().toISOString(),
  };

  await addMessage(room, msg);
  return NextResponse.json({ message: msg }, { status: 201 });
}
