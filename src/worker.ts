// src/worker.ts — Invoice Extractor Worker (Gemini Flash edition)
// -------------------------------------------------------------------
// Endpoints:
//   POST /api/login    { username, password }
//   POST /api/logout   clears session cookie + KV entry
//   POST /api/extract  FormData(images_dataurl[], doc_text?)
//                      Session users: unlimited. Free trial: 3 attempts, 1 page max.
//
// Wrangler bindings needed:
//   [vars]           ALLOWED_ORIGIN = "https://deep7285.github.io"
//   [[kv_namespaces]] binding = "USERS"
//   secret           GEMINI_API_KEY    ← changed from OPENAI_API_KEY
//
// Model options (set GEMINI_MODEL below):
//   "gemini-2.5-flash"      → 250 RPD / 10 RPM  (better quality, recommended)
//   "gemini-2.5-flash-lite" → 1000 RPD / 15 RPM (more quota, slightly lower quality)
// -------------------------------------------------------------------

import { SYSTEM_PROMPT, USER_INSTRUCTIONS } from "./schema_and_prompt";

export interface Env {
  ALLOWED_ORIGIN: string;
  GEMINI_API_KEY: string;   // Add this secret in Cloudflare dashboard (was OPENAI_API_KEY)
  USERS: KVNamespace;
}

const GEMINI_MODEL = "gemini-2.5-flash";

// Gemini requires nullable:true instead of ["type", "null"] union arrays
const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    seller: {
      type: "object",
      properties: {
        company_name: { type: "string", nullable: true },
        gstin:        { type: "string", nullable: true },
        address:      { type: "string", nullable: true }
      },
      required: ["company_name", "gstin", "address"]
    },
    invoice: {
      type: "object",
      properties: {
        number:         { type: "string", nullable: true },
        date:           { type: "string", nullable: true },
        transaction_id: { type: "string", nullable: true }
      },
      required: ["number", "date", "transaction_id"]
    },
    taxes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type:         { type: "string" },
          rate_percent: { type: "number", nullable: true },
          amount:       { type: "number", nullable: true }
        },
        required: ["type", "rate_percent", "amount"]
      }
    },
    amounts: {
      type: "object",
      properties: {
        taxable_amount: { type: "number", nullable: true },
        total_amount:   { type: "number", nullable: true }
      },
      required: ["taxable_amount", "total_amount"]
    }
  },
  required: ["seller", "invoice", "taxes", "amounts"]
};

// -------------------------
// 0) Utilities
// -------------------------
const JSON_HEADER = { "content-type": "application/json; charset=utf-8" };

function cors(env: Env) {
  return {
    "Access-Control-Allow-Origin":      env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":     "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods":     "POST, OPTIONS",
    "Access-Control-Max-Age":           "86400",
    "Vary":                             "Origin"
  };
}

function ok(body: any, env: Env, extraHeaders: Record<string, string> = {}) {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status: 200, headers: { ...JSON_HEADER, ...cors(env), ...extraHeaders } }
  );
}

function bad(body: any, env: Env, status = 400) {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: { ...JSON_HEADER, ...cors(env) } }
  );
}

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("Cookie") || "";
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(
  name: string,
  val: string,
  opts: { maxAge?: number; path?: string; httpOnly?: boolean; sameSite?: "Lax" | "Strict" | "None"; secure?: boolean } = {}
) {
  const parts = [`${name}=${encodeURIComponent(val)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "None"}`);
  if (opts.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

async function hashPasswordPBKDF2(password: string, saltB64: string, iterations: number): Promise<string> {
  const enc  = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key  = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations, salt }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function b64Random(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/=+$/, "");
}

// -------------------------
// 1) Session & trial
// -------------------------
const SESSION_PREFIX       = "session:";
const SESSION_TTL_SECONDS  = 60 * 60 * 24 * 30; // 30 days
const TRIAL_LIMIT          = 3;
const TRIAL_COOKIE         = "trial";
const SESSION_COOKIE       = "sess";

async function getSession(env: Env, token: string | null) {
  if (!token) return null;
  return env.USERS.get(SESSION_PREFIX + token, "json") as Promise<null | { username: string; exp: number; roles?: string[] }>;
}

async function createSession(env: Env, username: string, roles: string[] = []) {
  const token = b64Random(24);
  const exp   = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await env.USERS.put(SESSION_PREFIX + token, JSON.stringify({ username, exp, roles }), {
    expirationTtl: SESSION_TTL_SECONDS
  });
  return { token, exp };
}

async function destroySession(env: Env, token: string | null) {
  if (token) await env.USERS.delete(SESSION_PREFIX + token);
}

function readTrialCookie(req: Request): number {
  const v = getCookie(req, TRIAL_COOKIE);
  const n = parseInt(v || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

// -------------------------
// 2) Login / Logout
// -------------------------
async function handleLogin(req: Request, env: Env) {
  try {
    const body = await req.json<{ username?: string; password?: string; _hp?: string }>();

    // Honeypot: bots fill hidden fields, humans don't
    if (body._hp) return bad({ error: "invalid_request" }, env, 400);

    const username = (body.username || "").trim().toLowerCase();
    const password = body.password || "";
    if (!username || !password) return bad({ error: "username_and_password_required" }, env, 400);

    // Accepts both formats make-user.mjs can produce:
    // Format A: hash = "pbkdf2$sha256$120000$<saltB64>$<hashB64>"  (combined string)
    // Format B: { salt, hash, iterations } as separate fields      (older format)
    const doc = await env.USERS.get("user:" + username, "json") as null | {
      username: string;
      hash: string;         // either combined string OR just the derived hash
      salt?: string;        // present in Format B only
      iterations?: number;  // present in Format B only
      expires?: string;
      roles?: string[];
      status?: string;
    };

    if (!doc) return bad({ error: "invalid_credentials" }, env, 401);

    if (doc.status === "inactive") {
      return bad({ error: "account_disabled" }, env, 403);
    }

    if (doc.expires && new Date(doc.expires).getTime() < Date.now()) {
      return bad({ error: "account_expired" }, env, 403);
    }

    // Parse whichever hash format is stored
    let saltB64: string;
    let iterations: number;
    let storedHash: string;

    const combinedMatch = doc.hash?.match(/^pbkdf2[$]sha256[$](\d+)[$]([^$]+)[$](.+)$/);
    if (combinedMatch) {
      // Format A — make-user.mjs output
      iterations = parseInt(combinedMatch[1], 10);
      saltB64    = combinedMatch[2];
      storedHash = combinedMatch[3];
    } else if (doc.salt && doc.iterations) {
      // Format B — separate fields
      saltB64    = doc.salt;
      iterations = doc.iterations;
      storedHash = doc.hash;
    } else {
      console.error("[login] Unrecognised hash format for user:", username);
      return bad({ error: "invalid_credentials" }, env, 401);
    }

    const derived = await hashPasswordPBKDF2(password, saltB64, iterations);
    if (derived !== storedHash) return bad({ error: "invalid_credentials" }, env, 401);

    const session  = await createSession(env, username, doc.roles ?? []);
    const cookie   = setCookie(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "None", secure: true, maxAge: SESSION_TTL_SECONDS });
    const clearTrial = setCookie(TRIAL_COOKIE, "0", { httpOnly: true, sameSite: "None", secure: true, maxAge: 0 });

    return ok({ ok: true, username }, env, { "Set-Cookie": `${cookie}, ${clearTrial}` });
  } catch (e: any) {
    return bad({ error: e?.message || "bad_request" }, env, 400);
  }
}

async function handleLogout(req: Request, env: Env) {
  const token = getCookie(req, SESSION_COOKIE);
  await destroySession(env, token);
  const clear = setCookie(SESSION_COOKIE, "", { httpOnly: true, sameSite: "None", secure: true, maxAge: 0 });
  return ok({ ok: true }, env, { "Set-Cookie": clear });
}

// -------------------------
// 3) Auth guard for /api/extract
// -------------------------
type AuthResult =
  | { kind: "session"; username: string; roles: string[] }
  | { kind: "trial"; count: number };

async function guardExtract(
  req: Request, env: Env
): Promise<{ allowed: boolean; mode?: AuthResult; headers?: Record<string, string>; error?: Response }> {
  const sess = await getSession(env, getCookie(req, SESSION_COOKIE));
  if (sess && sess.exp > Math.floor(Date.now() / 1000)) {
    return { allowed: true, mode: { kind: "session", username: sess.username, roles: sess.roles ?? [] } };
  }

  const used = readTrialCookie(req);
  if (used >= TRIAL_LIMIT) {
    return {
      allowed: false,
      error: bad({ error: "trial_exhausted", trialUsed: used, trialLimit: TRIAL_LIMIT, hint: "Login to continue" }, env, 429)
    };
  }

  const newCount = used + 1;
  const cookie   = setCookie(TRIAL_COOKIE, String(newCount), { httpOnly: true, sameSite: "None", secure: true, maxAge: 60 * 60 * 24 * 7 });
  return { allowed: true, mode: { kind: "trial", count: newCount }, headers: { "Set-Cookie": cookie } };
}

// -------------------------
// 4) Gemini extraction
// -------------------------
async function extractWithGemini(env: Env, parts: { imgs: string[]; docText: string }) {
  const contentParts: any[] = [
    { text: SYSTEM_PROMPT + "\n\n" + USER_INSTRUCTIONS }
  ];

  for (const dataUrl of parts.imgs) {
    const commaIdx = dataUrl.indexOf(",");
    const header   = dataUrl.substring(0, commaIdx);
    const data     = dataUrl.substring(commaIdx + 1);
    const mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
    contentParts.push({ inlineData: { mimeType, data } });
  }

  if (parts.docText?.trim()) {
    contentParts.push({ text: "Raw extracted text:\n" + parts.docText.slice(0, 10000) });
  }

  const requestBody = {
    contents: [{ parts: contentParts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema:   GEMINI_RESPONSE_SCHEMA,
      temperature:      0
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(requestBody)
  });

  if (!resp.ok) {
    const text   = await resp.text().catch(() => "");
    const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const msg    = parsed?.error?.message || text || `HTTP ${resp.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }

  const data      = await resp.json<any>();
  const candidate = data?.candidates?.[0];

  if (candidate?.finishReason === "SAFETY") {
    throw new Error("Invoice content was blocked by safety filters. Try a clearer image.");
  }

  const responseText = candidate?.content?.parts?.[0]?.text ?? "{}";

  try {
    return JSON.parse(responseText);
  } catch {
    return { raw: responseText };
  }
}

// -------------------------
// 5) /api/extract handler
// -------------------------
async function handleExtract(req: Request, env: Env) {
  const guard = await guardExtract(req, env);
  if (!guard.allowed) return guard.error!;

  const extraHeaders = guard.headers || {};

  // File size guard — reject overly large payloads before parsing
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > 60 * 1024 * 1024) {
    return bad({ error: "payload_too_large", hint: "Maximum total upload is 60 MB" }, env, 413);
  }

  const form    = await req.formData();
  const imgs: string[] = [];
  for (const [key, val] of form.entries()) {
    if (key === "images_dataurl[]" && typeof val === "string") imgs.push(val);
  }
  const docText = (form.get("doc_text") as string) || "";

  // Trial restriction: max 1 page
  if (guard.mode?.kind === "trial" && imgs.length > 1) {
    return bad({ error: "trial_one_page_only", hint: "Free trial is limited to 1 page per session. Login for full access." }, env, 403);
  }

  if (imgs.length > 10) {
    return bad({ error: "too_many_pages", hint: "Maximum 10 pages per invoice." }, env, 400);
  }

  if (!imgs.length && !docText.trim()) {
    return bad({ error: "no_content", hint: "No image or text content received." }, env, 400);
  }

  const json = await extractWithGemini(env, { imgs, docText });

  return new Response(JSON.stringify(json), {
    status:  200,
    headers: { ...JSON_HEADER, ...cors(env), ...extraHeaders }
  });
}

// -------------------------
// 6) Router
// -------------------------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    const { pathname } = new URL(req.url);

    try {
      if (pathname === "/api/login"   && req.method === "POST") return handleLogin(req, env);
      if (pathname === "/api/logout"  && req.method === "POST") return handleLogout(req, env);
      if (pathname === "/api/extract" && req.method === "POST") return handleExtract(req, env);

      return bad({ error: "not_found" }, env, 404);
    } catch (err: any) {
      console.error("[worker] Unhandled error:", err);
      return bad({ error: "server_error", detail: String(err?.message || err) }, env, 500);
    }
  }
};