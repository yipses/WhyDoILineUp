import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type Stat = "CHARM" | "INTELLIGENCE" | "STRENGTH";
export const STATS: Stat[] = ["CHARM", "INTELLIGENCE", "STRENGTH"];

export interface QuestOption {
  label: string;
  stat: Stat;
  difficulty: number;
  success: string;
  failure: string;
}

export interface Quest {
  id: string;
  tier: number;
  npcId: string;
  setup: string;
  a: QuestOption;
  b: QuestOption;
}

export interface QuestTier {
  tier: number;
  unlockLevel: number;
  difficultyMin: number;
  difficultyMax: number;
  xpSuccess: number;
}

export interface Npc {
  id: string;
  name: string;
  description: string;
  statLean: Stat[];
}

export interface TitleRow {
  stat: Stat | "NONE";
  minLevel: number;
  title: string;
  accessory: string;
}

export interface EmojiRow {
  emoji: string;
  ascii: string;
  label: string;
}

export interface Content {
  tuning: Record<string, string>;
  xpCurve: number[]; // index = level - 1, value = cumulative xp required
  questTiers: QuestTier[];
  oddsBands: { label: string; min: number }[];
  titles: TitleRow[];
  avatarParts: Record<string, string[]>; // layer -> options, in sheet order
  avatarLayers: string[];
  emojis: EmojiRow[];
  npcs: Npc[];
  npcLines: { npcId: string; text: string }[];
  announcements: { npcId: string; event: string; text: string }[];
  prompts: string[];
  seedMessages: string[];
  blocklist: string[];
  quests: Quest[];
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180-ish parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore; \n handles the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function readTable(name: string): Record<string, string>[] {
  const file = path.join(config.contentDir, `${name}.csv`);
  const text = fs.readFileSync(file, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

function num(v: string | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asStat(v: string, where: string): Stat {
  const s = v.trim().toUpperCase();
  if (s === "CHARM" || s === "INTELLIGENCE" || s === "STRENGTH") return s;
  throw new Error(`Bad stat "${v}" in ${where}`);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadContent(): Content {
  const tuning: Record<string, string> = {};
  for (const r of readTable("Tuning")) tuning[r.key] = r.value;

  const xpRows = readTable("XP_Curve")
    .map((r) => ({ level: num(r.level), xp: num(r.xp_required) }))
    .sort((a, b) => a.level - b.level);
  const xpCurve = xpRows.map((r) => r.xp);
  if (xpCurve.length === 0 || xpCurve[0] !== 0) throw new Error("XP_Curve must start at level 1 with 0 xp");

  const questTiers = readTable("Quest_Tiers")
    .map((r) => ({
      tier: num(r.tier),
      unlockLevel: num(r.unlock_level, 1),
      difficultyMin: num(r.difficulty_min),
      difficultyMax: num(r.difficulty_max),
      xpSuccess: num(r.xp_success),
    }))
    .sort((a, b) => a.tier - b.tier);

  const oddsBands = readTable("Odds_Bands")
    .map((r) => ({ label: r.label, min: num(r.min_probability) }))
    .sort((a, b) => a.min - b.min);

  const titles: TitleRow[] = readTable("Titles").map((r) => ({
    stat: r.stat.toUpperCase() === "NONE" ? "NONE" : asStat(r.stat, "Titles"),
    minLevel: num(r.min_level, 1),
    title: r.title,
    accessory: r.accessory,
  }));

  const avatarParts: Record<string, string[]> = {};
  const avatarLayers: string[] = [];
  for (const r of readTable("Avatar_Parts")) {
    if (!avatarParts[r.layer]) {
      avatarParts[r.layer] = [];
      avatarLayers.push(r.layer);
    }
    avatarParts[r.layer].push(r.option);
  }

  const emojis = readTable("Emojis").map((r) => ({ emoji: r.emoji, ascii: r.ascii, label: r.label }));

  const npcs: Npc[] = readTable("NPCs").map((r) => ({
    id: r.npc_id,
    name: r.name,
    description: r.description,
    statLean: r.stat_lean
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => asStat(s, `NPCs/${r.npc_id}`)),
  }));

  const npcLines = readTable("NPC_Lines").map((r) => ({ npcId: r.npc_id, text: r.text }));
  const announcements = readTable("Announcements").map((r) => ({ npcId: r.npc_id, event: r.event, text: r.text }));
  const prompts = readTable("Prompts").map((r) => r.text).filter(Boolean);
  const seedMessages = readTable("Seed_Messages").map((r) => r.text).filter(Boolean);
  const blocklist = readTable("Blocklist").map((r) => r.word.toLowerCase()).filter(Boolean);

  const quests: Quest[] = readTable("Quests").map((r) => ({
    id: r.id,
    tier: num(r.tier, 1),
    npcId: r.npc_id,
    setup: r.setup,
    a: {
      label: r.a_label,
      stat: asStat(r.a_stat, `Quests/${r.id}`),
      difficulty: num(r.a_difficulty),
      success: r.a_success,
      failure: r.a_failure,
    },
    b: {
      label: r.b_label,
      stat: asStat(r.b_stat, `Quests/${r.id}`),
      difficulty: num(r.b_difficulty),
      success: r.b_success,
      failure: r.b_failure,
    },
  }));

  const npcIds = new Set(npcs.map((n) => n.id));
  for (const q of quests) {
    if (!npcIds.has(q.npcId)) throw new Error(`Quest ${q.id} references unknown npc ${q.npcId}`);
    if (q.a.stat === q.b.stat) throw new Error(`Quest ${q.id}: both options use ${q.a.stat}`);
  }

  return {
    tuning,
    xpCurve,
    questTiers,
    oddsBands,
    titles,
    avatarParts,
    avatarLayers,
    emojis,
    npcs,
    npcLines,
    announcements,
    prompts,
    seedMessages,
    blocklist,
    quests,
  };
}

/** Typed access to tuning values with defaults from the design doc. */
export class Tuning {
  constructor(private readonly raw: Record<string, string>) {}
  num(key: string, fallback: number): number {
    const v = this.raw[key];
    if (v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  str(key: string, fallback: string): string {
    const v = this.raw[key];
    return v === undefined || v === "" ? fallback : v;
  }
  list(key: string, fallback: number[]): number[] {
    const v = this.raw[key];
    if (!v) return fallback;
    const out = v
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    return out.length ? out : fallback;
  }
}
