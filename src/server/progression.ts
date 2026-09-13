import type { Content, Stat, TitleRow } from "./content.js";
import { STATS, Tuning } from "./content.js";
import type { PlayerRow } from "./db.js";

export interface Stats {
  CHARM: number;
  INTELLIGENCE: number;
  STRENGTH: number;
}

export function statsOf(p: PlayerRow): Stats {
  return { CHARM: p.charm, INTELLIGENCE: p.intelligence, STRENGTH: p.strength };
}

export function statColumn(stat: Stat): "charm" | "intelligence" | "strength" {
  return stat.toLowerCase() as "charm" | "intelligence" | "strength";
}

/** Level for a cumulative XP total. Cap = last row of the curve. */
export function levelForXp(xp: number, curve: number[]): number {
  let level = 1;
  for (let i = 0; i < curve.length; i++) {
    if (xp >= curve[i]) level = i + 1;
    else break;
  }
  return level;
}

export function levelCap(curve: number[]): number {
  return curve.length;
}

/** XP still needed for the next level, or null at cap. */
export function xpToNext(xp: number, curve: number[]): number | null {
  const level = levelForXp(xp, curve);
  if (level >= curve.length) return null;
  return curve[level] - xp;
}

/**
 * Dominant stat, with ties resolved to the most recently raised stat.
 * Returns "NONE" when every stat is equal and nothing has been raised.
 */
export function dominantStat(stats: Stats, lastRaised: string): Stat | "NONE" {
  const max = Math.max(stats.CHARM, stats.INTELLIGENCE, stats.STRENGTH);
  const leaders = STATS.filter((s) => stats[s] === max);
  if (leaders.length === 1) return leaders[0];
  if (leaders.includes(lastRaised as Stat)) return lastRaised as Stat;
  return "NONE";
}

export function titleFor(level: number, stats: Stats, lastRaised: string, titles: TitleRow[]): TitleRow {
  const dom = dominantStat(stats, lastRaised);
  const candidates = titles.filter((t) => t.stat === dom && t.minLevel <= level).sort((a, b) => b.minLevel - a.minLevel);
  if (candidates.length) return candidates[0];
  const none = titles.filter((t) => t.stat === "NONE").sort((a, b) => b.minLevel - a.minLevel);
  return none[0] ?? { stat: "NONE", minLevel: 1, title: "Person in Line", accessory: "" };
}

// ---------------------------------------------------------------------------
// Rolls
// ---------------------------------------------------------------------------

export function successProbability(stat: number, difficulty: number, tuning: Tuning): number {
  const base = tuning.num("ROLL_BASE", 0.5);
  const step = tuning.num("ROLL_STEP", 0.08);
  const floor = tuning.num("ROLL_FLOOR", 0.05);
  const ceiling = tuning.num("ROLL_CEILING", 0.95);
  const p = base + (stat - difficulty) * step;
  return Math.max(floor, Math.min(ceiling, p));
}

export function oddsBand(p: number, bands: { label: string; min: number }[]): string {
  let label = bands[0]?.label ?? "Even";
  for (const b of bands) if (p >= b.min) label = b.label;
  return label;
}

// ---------------------------------------------------------------------------
// Avatars (text)
// ---------------------------------------------------------------------------

export type Avatar = Record<string, string>;

export function randomAvatar(content: Content, rng: () => number = Math.random): Avatar {
  const out: Avatar = {};
  for (const layer of content.avatarLayers) {
    const opts = content.avatarParts[layer];
    if (opts && opts.length) out[layer] = opts[Math.floor(rng() * opts.length)];
  }
  return out;
}

export function parseAvatar(json: string): Avatar {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Avatar) : {};
  } catch {
    return {};
  }
}

/** One-line prose description used in the status screen and hover text. */
export function describeAvatar(avatar: Avatar, layers: string[], accessory: string): string {
  const parts: string[] = [];
  const build = avatar.build;
  const hair = avatar.hair;
  const top = avatar.top;
  const bottom = avatar.bottom;
  const item = avatar.item;
  const head = [build ? `${build} person` : "person", hair ? `${hair}` : ""].filter(Boolean).join(", ");
  parts.push(head);
  const wear = [top, bottom].filter(Boolean).join(" and ");
  if (wear) parts.push(`wearing ${withArticle(top ?? bottom ?? "")}${top && bottom ? ` and ${bottom}` : ""}`);
  if (item && item !== "nothing in particular") parts.push(`with ${withArticle(item)}`);
  // Any extra layers from the sheet that we don't know about:
  for (const layer of layers) {
    if (["build", "hair", "top", "bottom", "item"].includes(layer)) continue;
    if (avatar[layer]) parts.push(`${layer}: ${avatar[layer]}`);
  }
  if (accessory) parts.push(`with ${withArticle(accessory)}`);
  return parts.join(", ");
}

/** Short signature used to tell same-named players apart on the boards. */
export function avatarSignature(avatar: Avatar): string {
  return [avatar.hair, avatar.top].filter(Boolean).join(", ");
}

/** Adds "a"/"an" unless the phrase already carries an article or reads as plural/mass. */
function withArticle(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^(a|an|the|some|two|three|his|her|their|my|nothing|earbuds|sunglasses|glasses|braids|joggers|shorts|jeans|chinos|corduroys|trousers)\b/i.test(t)) return t;
  if (/^(reading glasses|three pens|wide-leg|bike shorts|cargo shorts|black jeans)/i.test(t)) return t;
  return `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t}`;
}

// ---------------------------------------------------------------------------
// Weekly board keys
// ---------------------------------------------------------------------------

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** ISO date (UTC) of the most recent reset-day midnight at or before `now`. */
export function weekKey(now: number, resetDay: string): string {
  const target = DAYS.indexOf(resetDay.trim().toLowerCase());
  const idx = target >= 0 ? target : 1;
  const d = new Date(now);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(utcMidnight).getUTCDay();
  const back = (dow - idx + 7) % 7;
  const start = utcMidnight - back * 24 * 3600 * 1000;
  return new Date(start).toISOString().slice(0, 10);
}
