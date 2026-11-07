"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";

// shapes returned by the api routes (kept local so no server code
// is bundled into the client)
interface ChatMessage {
  id: string;
  name: string;
  type: "text" | "code";
  text: string;
  language?: string;
  time: string;
}

interface FileMeta {
  id: string;
  name: string;
  size: number;
  uploader: string;
  time: string;
  url: string;
}

const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "go",
  "rust",
  "html",
  "css",
  "sql",
  "bash",
  "json",
  "plaintext",
];

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 32);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightCode(code: string, language?: string): string {
  const lang = (language || "plaintext").toLowerCase();
  try {
    if (lang !== "plaintext" && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
  } catch {
    // fall through to plain escaped text
  }
  return escapeHtml(code);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Home() {
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [room, setRoom] = useState("");
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [composer, setComposer] = useState("");
  const [mode, setMode] = useState<"text" | "code">("text");
  const [language, setLanguage] = useState("javascript");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // prefill the team code from ?room= and rejoin from local storage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = normalizeCode(params.get("room") || "");
    const savedCode = normalizeCode(
      window.localStorage.getItem("hackchat:code") || "",
    );
    const savedName = window.localStorage.getItem("hackchat:name") || "";
    if (fromLink) setCodeInput(fromLink);
    else if (savedCode) setCodeInput(savedCode);
    if (savedName) setNameInput(savedName);
    if ((fromLink || savedCode) && savedName) {
      setRoom(fromLink || savedCode);
      setName(savedName);
    }
  }, []);

  // load cached messages and files whenever entering a room
  useEffect(() => {
    if (!room) return;
    try {
      const cachedM = window.localStorage.getItem(`hackchat:msgs:${room}`);
      if (cachedM) setMessages(JSON.parse(cachedM));
      const cachedF = window.localStorage.getItem(`hackchat:files:${room}`);
      if (cachedF) setFiles(JSON.parse(cachedF));
    } catch {}
  }, [room]);

  const fetchRoom = useCallback(async () => {
    if (!room) return;
    try {
      const [mRes, fRes] = await Promise.all([
        fetch(`/api/rooms/${room}/messages`),
        fetch(`/api/rooms/${room}/files`),
      ]);
      if (mRes.ok) {
        const data = await mRes.json();
        if (Array.isArray(data.messages)) {
          setMessages((prev) => {
            if (data.messages.length === 0 && prev.length > 0) return prev;
            const map = new Map(prev.map((m) => [m.id, m]));
            for (const m of data.messages) {
              map.set(m.id, m);
            }
            const merged = Array.from(map.values()).sort(
              (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
            );
            try {
              window.localStorage.setItem(
                `hackchat:msgs:${room}`,
                JSON.stringify(merged),
              );
            } catch {}
            return merged;
          });
        }
      }
      if (fRes.ok) {
        const data = await fRes.json();
        if (Array.isArray(data.files)) {
          setFiles((prev) => {
            if (data.files.length === 0 && prev.length > 0) return prev;
            const map = new Map(prev.map((f) => [f.id, f]));
            for (const f of data.files) {
              map.set(f.id, f);
            }
            const merged = Array.from(map.values()).sort(
              (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
            );
            try {
              window.localStorage.setItem(
                `hackchat:files:${room}`,
                JSON.stringify(merged),
              );
            } catch {}
            return merged;
          });
        }
      }
    } catch {
      // offline — keep showing the last fetched data
    }
  }, [room]);

  // poll for new messages + files while inside a room
  useEffect(() => {
    if (!room) return;
    fetchRoom();
    const t = window.setInterval(fetchRoom, 2000);
    return () => window.clearInterval(t);
  }, [room, fetchRoom]);

  // keep the message list pinned to the newest message
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, files]);

  const members = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    for (const f of files) counts.set(f.uploader, (counts.get(f.uploader) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [messages, files]);

  function join() {
    const code = normalizeCode(codeInput);
    const displayName = nameInput.trim().slice(0, 40);
    if (!code) {
      setError("enter a team code first");
      return;
    }
    if (!displayName) {
      setError("enter your name first");
      return;
    }
    setError("");
    window.localStorage.setItem("hackchat:code", code);
    window.localStorage.setItem("hackchat:name", displayName);
    setRoom(code);
    setName(displayName);
    try {
      const cachedM = window.localStorage.getItem(`hackchat:msgs:${code}`);
      setMessages(cachedM ? JSON.parse(cachedM) : []);
      const cachedF = window.localStorage.getItem(`hackchat:files:${code}`);
      setFiles(cachedF ? JSON.parse(cachedF) : []);
    } catch {
      setMessages([]);
      setFiles([]);
    }
  }

  function leave() {
    window.localStorage.removeItem("hackchat:code");
    setRoom("");
    setMessages([]);
    setFiles([]);
    setComposer("");
    setError("");
  }

  async function sendMessage() {
    const text = composer.trim();
    if (!text || !room || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/rooms/${room}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: mode,
          text,
          language: mode === "code" ? language : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "could not send the message");
        return;
      }
      const data = await res.json();
      if (data.message) {
        setMessages((prev) => {
          const map = new Map(prev.map((m) => [m.id, m]));
          map.set(data.message.id, data.message);
          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
          );
          try {
            window.localStorage.setItem(
              `hackchat:msgs:${room}`,
              JSON.stringify(merged),
            );
          } catch {}
          return merged;
        });
      }
      setComposer("");
      await fetchRoom();
    } catch {
      setError("could not send — check your connection");
    } finally {
      setSending(false);
    }
  }

  async function uploadFile(f: File) {
    if (!room) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      setError("file too big — max 4 MB per file");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("name", name);
      const res = await fetch(`/api/rooms/${room}/files`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "upload failed");
        return;
      }
      const data = await res.json();
      if (data.file) {
        setFiles((prev) => {
          const map = new Map(prev.map((f) => [f.id, f]));
          map.set(data.file.id, data.file);
          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
          );
          try {
            window.localStorage.setItem(
              `hackchat:files:${room}`,
              JSON.stringify(merged),
            );
          } catch {}
          return merged;
        });
      }
      await fetchRoom();
    } catch {
      setError("upload failed — check your connection");
    } finally {
      setUploading(false);
    }
  }

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 1500);
    } catch {
      // clipboard unavailable — nothing to do
    }
  }

  async function copyRoomLink() {
    const url = `${window.location.origin}${window.location.pathname}?room=${room}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // clipboard unavailable — nothing to do
    }
  }

  // ---------------- join screen ----------------
  if (!room) {
    return (
      <div className="join-wrap">
        <div className="join-card">
          <h1 className="logo">
            Hack<span>Chat</span>
          </h1>
          <p className="tagline">
            Team chatbox for hackathons. Share text, code and files with your
            team — no accounts, just a team code.
          </p>
          {error && <p className="error">{error}</p>}
          <div className="field">
            <label htmlFor="code">Team code</label>
            <input
              id="code"
              className="code-input"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") join();
              }}
              placeholder="TEAM-CODE"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") join();
              }}
              placeholder="Your name"
              autoComplete="off"
            />
          </div>
          <button className="join-btn" onClick={join}>
            Join room
          </button>
          <p className="join-note">
            Everyone with the same team code sees the same room. Pick a code
            only your team knows.
          </p>
        </div>
      </div>
    );
  }

  // ---------------- room screen ----------------
  return (
    <div className="room">
      <header className="room-header">
        <p className="logo">
          Hack<span>Chat</span>
        </p>
        <span className="room-code">{room}</span>
        <span className="file-meta">
          {members.length} member{members.length === 1 ? "" : "s"}
        </span>
        <span className="header-spacer" />
        <button className="header-btn" onClick={copyRoomLink}>
          {linkCopied ? "Link copied" : "Copy room link"}
        </button>
        <button className="header-btn" onClick={leave}>
          Leave
        </button>
      </header>

      <div className="room-body">
        <section className="panel">
          <h2>Messages</h2>
          <div className="msg-list" ref={listRef}>
            {messages.length === 0 ? (
              <p className="msg-empty">
                Nothing here yet. Paste the first code snippet or say hi —
                your team sees it the moment you send it.
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id}>
                  <div className="msg-head">
                    <span className="msg-name">{m.name}</span>
                    <span className="msg-time">{fmtTime(m.time)}</span>
                  </div>
                  {m.type === "code" ? (
                    <div className="msg-code">
                      <div className="msg-code-bar">
                        <span className="msg-code-lang">
                          {m.language || "code"}
                        </span>
                        <button
                          onClick={() => copyText(m.text, m.id)}
                        >
                          {copiedId === m.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <pre>
                        <code
                          dangerouslySetInnerHTML={{
                            __html: highlightCode(m.text, m.language),
                          }}
                        />
                      </pre>
                    </div>
                  ) : (
                    <p className="msg-text">{m.text}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <div className="side">
          <section className="panel">
            <h2>Files ({files.length})</h2>
            {files.length === 0 ? (
              <p className="file-empty">
                No files yet. Attach one below and it shows up here for the
                whole team to download.
              </p>
            ) : (
              <div className="file-list">
                {files.map((f) => (
                  <div className="file-item" key={f.id}>
                    <div>
                      <a href={f.url} download={f.name} target="_blank" rel="noreferrer">
                        {f.name}
                      </a>
                      <div className="file-meta">
                        {fmtSize(f.size)} · {f.uploader} · {fmtTime(f.time)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Members</h2>
            {members.length === 0 ? (
              <p className="member-empty">No one has posted yet.</p>
            ) : (
              <ul className="member-list">
                {members.map(([member, count]) => (
                  <li key={member}>
                    <span>{member}</span>
                    <span className="member-count">
                      {count} post{count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="composer">
        {error && <p className="error">{error}</p>}
        <div className="mode-row">
          <button
            className={`mode-btn ${mode === "text" ? "active" : ""}`}
            onClick={() => setMode("text")}
          >
            Text
          </button>
          <button
            className={`mode-btn ${mode === "code" ? "active" : ""}`}
            onClick={() => setMode("code")}
          >
            Code
          </button>
          {mode === "code" && (
            <select
              className="lang-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Code language"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="composer-row">
          <textarea
            className={mode === "code" ? "code-mode" : ""}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={
              mode === "code"
                ? "paste your code here…"
                : "message your team… (enter to send)"
            }
            rows={2}
          />
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.target.value = "";
            }}
          />
          <button
            className="icon-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload a file (max 4 MB)"
          >
            {uploading ? "…" : "＋ File"}
          </button>
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={sending || !composer.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
