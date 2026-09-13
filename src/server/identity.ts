import crypto from "node:crypto";

/** 256 bits of entropy, hex-encoded. Never derived from anything. */
export function mintSecretToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Public IDs are short, unrelated to the secret, and safe to broadcast. */
export function mintPublicId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Tokens are stored hashed; a database leak does not leak sessions. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isPlausibleToken(token: string | undefined): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
