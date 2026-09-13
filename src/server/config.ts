import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: envNum("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  /** Root of the repository (dist/server -> ../..). */
  rootDir: path.resolve(here, "..", ".."),
  contentDir: process.env.CONTENT_DIR ?? path.resolve(here, "..", "..", "content"),
  publicDir: path.resolve(here, "..", "..", "public"),
  dbPath: process.env.DB_PATH ?? path.resolve(here, "..", "..", "data", "the-line.sqlite"),
  /**
   * Divides every timed duration. TIME_SCALE=10 makes a 60s tick take 6s.
   * For playtesting only. Leave at 1 in production.
   */
  timeScale: Math.max(0.01, envNum("TIME_SCALE", 1)),
  /** Send the Secure cookie attribute. Set to "0" for plain-http local dev. */
  secureCookies: (process.env.SECURE_COOKIES ?? "1") !== "0",
  cookieName: "tl_token",
  cookieMaxAgeSeconds: 365 * 24 * 3600,
  /** Password for the /mod review tool. If unset, /mod is disabled. */
  modPassword: process.env.MOD_PASSWORD ?? "",
  /** Optional Claude-backed classifier. Off unless a key is present. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  modModel: process.env.MOD_MODEL ?? "claude-opus-5",
  /** Public site URL used in share text. */
  siteUrl: process.env.SITE_URL ?? "",
};

/** Milliseconds for a tuning value expressed in seconds, honouring TIME_SCALE. */
export function secondsMs(seconds: number): number {
  return (seconds * 1000) / config.timeScale;
}

export function minutesMs(minutes: number): number {
  return secondsMs(minutes * 60);
}
