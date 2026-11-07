// lib/store.ts — the one storage module for HackChat.
//
// How it works:
// - When KV_REST_API_URL + KV_REST_API_TOKEN are set, messages and file
//   metadata live in Vercel KV (Redis, via its REST API). Rooms persist
//   across deploys and serverless instances.
// - When BLOB_READ_WRITE_TOKEN is set, uploaded files go to Vercel Blob
//   (handled in the files API route, which calls `put` from @vercel/blob).
// - When those env vars are missing, everything falls back to an
//   IN-MEMORY store (module-level Maps below). That fallback is DEMO-ONLY:
//   it lives in a single serverless instance, is lost on redeploy or
//   restart, and teammates hitting a different instance will not see
//   each other's data. The app still runs and builds without any env
//   vars so it can be demoed locally with zero setup.
//
// Rooms are keyed by team code:
//   room:<CODE>:messages  — list of messages, newest last, capped at 500
//   room:<CODE>:files     — list of file metadata, newest last, capped at 200

import { createClient } from "@vercel/kv";
import type { VercelKV } from "@vercel/kv";

export type MessageType = "text" | "code";

export interface ChatMessage {
  id: string;
  name: string;
  type: MessageType;
  text: string;
  language?: string;
  time: string; // ISO timestamp
}

export interface FileMeta {
  id: string;
  name: string;
  size: number; // bytes
  uploader: string;
  time: string; // ISO timestamp
  url: string; // Vercel Blob URL, or a base64 data: URL in demo mode
}

export const MAX_MESSAGES_PER_ROOM = 500;
export const MAX_FILES_PER_ROOM = 200;

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

/** Normalise a raw team code: uppercase, letters/numbers/dash only, max 32. */
export function normalizeCode(raw: string): string {
  const cleaned = (raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 32);
  return cleaned || "GENERAL";
}

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

export function kvEnabled(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** "kv" when rooms persist in Vercel KV, "memory" for the demo fallback. */
export function storageMode(): "kv" | "memory" {
  return kvEnabled() ? "kv" : "memory";
}

// ---------------------------------------------------------------------------
// Vercel KV client (created lazily, only when env vars exist)
// ---------------------------------------------------------------------------

let kvClient: VercelKV | null | undefined; // undefined = not tried yet

function getKv(): VercelKV | null {
  if (kvClient !== undefined) return kvClient;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    kvClient = null;
    return null;
  }
  try {
    kvClient = createClient({ url, token });
  } catch {
    kvClient = null;
  }
  return kvClient;
}

// ---------------------------------------------------------------------------
// Demo-only in-memory store (single instance, no persistence — see header)
// ---------------------------------------------------------------------------

const memoryMessages = new Map<string, ChatMessage[]>();
const memoryFiles = new Map<string, FileMeta[]>();

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function messagesKey(code: string): string {
  return `room:${normalizeCode(code)}:messages`;
}

export async function listMessages(code: string): Promise<ChatMessage[]> {
  const kv = getKv();
  if (kv) {
    const raw = (await kv.lrange(messagesKey(code), 0, -1)) as unknown[];
    const out: ChatMessage[] = [];
    for (const item of raw) {
      try {
        const msg = typeof item === "string" ? JSON.parse(item) : item;
        if (msg && typeof msg.id === "string" && typeof msg.text === "string") {
          out.push(msg as ChatMessage);
        }
      } catch {
        // skip one corrupt entry rather than failing the whole room
      }
    }
    return out;
  }
  return [...(memoryMessages.get(normalizeCode(code)) ?? [])];
}

export async function addMessage(
  code: string,
  msg: ChatMessage,
): Promise<ChatMessage> {
  const kv = getKv();
  if (kv) {
    const key = messagesKey(code);
    await kv.rpush(key, JSON.stringify(msg));
    // keep only the newest MAX_MESSAGES_PER_ROOM entries
    await kv.ltrim(key, -MAX_MESSAGES_PER_ROOM, -1);
    return msg;
  }
  const room = normalizeCode(code);
  const list = memoryMessages.get(room) ?? [];
  list.push(msg);
  memoryMessages.set(room, list.slice(-MAX_MESSAGES_PER_ROOM));
  return msg;
}

// ---------------------------------------------------------------------------
// Files (metadata only — the bytes live in Blob, or in-memory as data URLs)
// ---------------------------------------------------------------------------

function filesKey(code: string): string {
  return `room:${normalizeCode(code)}:files`;
}

export async function listFiles(code: string): Promise<FileMeta[]> {
  const kv = getKv();
  if (kv) {
    const raw = (await kv.lrange(filesKey(code), 0, -1)) as unknown[];
    const out: FileMeta[] = [];
    for (const item of raw) {
      try {
        const meta = typeof item === "string" ? JSON.parse(item) : item;
        if (meta && typeof meta.id === "string" && typeof meta.url === "string") {
          out.push(meta as FileMeta);
        }
      } catch {
        // skip one corrupt entry rather than failing the whole room
      }
    }
    return out;
  }
  return [...(memoryFiles.get(normalizeCode(code)) ?? [])];
}

export async function addFile(code: string, meta: FileMeta): Promise<FileMeta> {
  const kv = getKv();
  if (kv) {
    const key = filesKey(code);
    await kv.rpush(key, JSON.stringify(meta));
    await kv.ltrim(key, -MAX_FILES_PER_ROOM, -1);
    return meta;
  }
  const room = normalizeCode(code);
  const list = memoryFiles.get(room) ?? [];
  list.push(meta);
  memoryFiles.set(room, list.slice(-MAX_FILES_PER_ROOM));
  return meta;
}
