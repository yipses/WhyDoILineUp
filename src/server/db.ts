import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MessageStatus = "pending" | "review" | "approved" | "rejected";

export interface PlayerRow {
  id: number;
  public_id: string;
  token_hash: string;
  name: string;
  avatar_json: string;
  level: number;
  xp: number;
  charm: number;
  intelligence: number;
  strength: number;
  pending_points: number;
  last_raised: string;
  lifetime_seconds: number;
  week_key: string;
  week_xp: number;
  week_seconds: number;
  muted: number;
  created_at: number;
  last_seen: number;
  last_levelup_at: number;
}

export interface MessageRow {
  id: number;
  text: string;
  author_id: number | null;
  status: MessageStatus;
  is_seed: number;
  mod_score: number | null;
  mod_reason: string;
  deliveries: number;
  reports: number;
  created_at: number;
  prompt: string;
}

export interface ReceiptRow {
  id: number;
  player_id: number;
  created_at: number;
  waited_seconds: number;
  behind: number;
  snapshot: string;
  text: string;
}

export interface ChatRow {
  id: number;
  at: number;
  kind: string;
  sender_public_id: string;
  sender_name: string;
  npc_id: string;
  text: string;
}

export class Db {
  readonly sql: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec("PRAGMA journal_mode = WAL");
    this.sql.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        avatar_json TEXT NOT NULL DEFAULT '{}',
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        charm INTEGER NOT NULL DEFAULT 1,
        intelligence INTEGER NOT NULL DEFAULT 1,
        strength INTEGER NOT NULL DEFAULT 1,
        pending_points INTEGER NOT NULL DEFAULT 0,
        last_raised TEXT NOT NULL DEFAULT '',
        lifetime_seconds INTEGER NOT NULL DEFAULT 0,
        week_key TEXT NOT NULL DEFAULT '',
        week_xp INTEGER NOT NULL DEFAULT 0,
        week_seconds INTEGER NOT NULL DEFAULT 0,
        muted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS players_alltime ON players(level DESC, lifetime_seconds DESC);
      CREATE INDEX IF NOT EXISTS players_weekly ON players(week_key, week_xp DESC, week_seconds DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        author_id INTEGER REFERENCES players(id),
        status TEXT NOT NULL,
        is_seed INTEGER NOT NULL DEFAULT 0,
        mod_score REAL,
        mod_reason TEXT NOT NULL DEFAULT '',
        deliveries INTEGER NOT NULL DEFAULT 0,
        reports INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_status ON messages(status);

      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES messages(id),
        player_id INTEGER NOT NULL REFERENCES players(id),
        at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reports (
        message_id INTEGER NOT NULL REFERENCES messages(id),
        player_id INTEGER NOT NULL REFERENCES players(id),
        at INTEGER NOT NULL,
        PRIMARY KEY (message_id, player_id)
      );

      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL REFERENCES players(id),
        created_at INTEGER NOT NULL,
        waited_seconds INTEGER NOT NULL,
        behind INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS receipts_player ON receipts(player_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        sender_public_id TEXT NOT NULL DEFAULT '',
        sender_name TEXT NOT NULL DEFAULT '',
        npc_id TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quest_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL REFERENCES players(id),
        quest_id TEXT NOT NULL,
        option TEXT NOT NULL,
        success INTEGER NOT NULL,
        probability REAL NOT NULL,
        xp INTEGER NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS quest_log_player ON quest_log(player_id, at DESC);
    `);
    // Additive migrations for databases created by earlier builds.
    this.ensureColumn("players", "last_levelup_at", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("quest_log", "stat", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("messages", "prompt", "TEXT NOT NULL DEFAULT ''");
  }

  private ensureColumn(table: string, column: string, ddl: string) {
    const cols = this.sql.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }

  // ---- players -----------------------------------------------------------

  getPlayerByTokenHash(hash: string): PlayerRow | undefined {
    return this.sql.prepare("SELECT * FROM players WHERE token_hash = ?").get(hash) as PlayerRow | undefined;
  }

  getPlayer(id: number): PlayerRow | undefined {
    return this.sql.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow | undefined;
  }

  getPlayerByPublicId(publicId: string): PlayerRow | undefined {
    return this.sql.prepare("SELECT * FROM players WHERE public_id = ?").get(publicId) as PlayerRow | undefined;
  }

  createPlayer(publicId: string, tokenHash: string, avatarJson: string, statBase: number, now: number): PlayerRow {
    const res = this.sql
      .prepare(
        `INSERT INTO players (public_id, token_hash, avatar_json, charm, intelligence, strength, created_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(publicId, tokenHash, avatarJson, statBase, statBase, statBase, now, now);
    return this.getPlayer(Number(res.lastInsertRowid))!;
  }

  updatePlayer(id: number, fields: Partial<PlayerRow>) {
    const keys = Object.keys(fields).filter((k) => k !== "id");
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => (fields as Record<string, unknown>)[k] as string | number);
    this.sql.prepare(`UPDATE players SET ${sets} WHERE id = ?`).run(...values, id);
  }

  countPlayers(): number {
    const r = this.sql.prepare("SELECT COUNT(*) AS n FROM players").get() as { n: number };
    return r.n;
  }

  allTimeBoard(limit: number): PlayerRow[] {
    return this.sql
      .prepare("SELECT * FROM players WHERE name <> '' ORDER BY level DESC, lifetime_seconds DESC, id ASC LIMIT ?")
      .all(limit) as unknown as PlayerRow[];
  }

  allTimeRank(p: PlayerRow): number {
    const r = this.sql
      .prepare(
        `SELECT COUNT(*) AS n FROM players WHERE name <> '' AND
         (level > ? OR (level = ? AND lifetime_seconds > ?) OR (level = ? AND lifetime_seconds = ? AND id < ?))`,
      )
      .get(p.level, p.level, p.lifetime_seconds, p.level, p.lifetime_seconds, p.id) as { n: number };
    return r.n + 1;
  }

  weeklyBoard(weekKey: string, limit: number): PlayerRow[] {
    return this.sql
      .prepare(
        "SELECT * FROM players WHERE name <> '' AND week_key = ? ORDER BY week_xp DESC, week_seconds DESC, id ASC LIMIT ?",
      )
      .all(weekKey, limit) as unknown as PlayerRow[];
  }

  weeklyRank(p: PlayerRow, weekKey: string): number {
    if (p.week_key !== weekKey) return 0;
    const r = this.sql
      .prepare(
        `SELECT COUNT(*) AS n FROM players WHERE name <> '' AND week_key = ? AND
         (week_xp > ? OR (week_xp = ? AND week_seconds > ?) OR (week_xp = ? AND week_seconds = ? AND id < ?))`,
      )
      .get(weekKey, p.week_xp, p.week_xp, p.week_seconds, p.week_xp, p.week_seconds, p.id) as { n: number };
    return r.n + 1;
  }

  // ---- messages ----------------------------------------------------------

  insertMessage(m: {
    text: string;
    authorId: number | null;
    status: MessageStatus;
    isSeed: boolean;
    modScore: number | null;
    modReason: string;
    now: number;
    /** The prompt shown to the writer, if any. Seeds have none. */
    prompt?: string;
  }): number {
    const res = this.sql
      .prepare(
        `INSERT INTO messages (text, author_id, status, is_seed, mod_score, mod_reason, created_at, prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.text, m.authorId, m.status, m.isSeed ? 1 : 0, m.modScore, m.modReason, m.now, m.prompt ?? "");
    return Number(res.lastInsertRowid);
  }

  getMessage(id: number): MessageRow | undefined {
    return this.sql.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  }

  setMessageStatus(id: number, status: MessageStatus, modScore?: number, modReason?: string) {
    if (modScore !== undefined) {
      this.sql
        .prepare("UPDATE messages SET status = ?, mod_score = ?, mod_reason = ? WHERE id = ?")
        .run(status, modScore, modReason ?? "", id);
    } else {
      this.sql.prepare("UPDATE messages SET status = ? WHERE id = ?").run(status, id);
    }
  }

  resetReports(id: number) {
    this.sql.prepare("UPDATE messages SET reports = 0 WHERE id = ?").run(id);
    this.sql.prepare("DELETE FROM reports WHERE message_id = ?").run(id);
  }

  seedCount(): number {
    const r = this.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE is_seed = 1").get() as { n: number };
    return r.n;
  }

  approvedNonSeedCount(): number {
    const r = this.sql
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'approved' AND is_seed = 0")
      .get() as { n: number };
    return r.n;
  }

  approvedMessages(excludeAuthorId: number, includeSeeds: boolean): MessageRow[] {
    return this.sql
      .prepare(
        `SELECT * FROM messages WHERE status = 'approved' AND (author_id IS NULL OR author_id <> ?)
         ${includeSeeds ? "" : "AND is_seed = 0"}`,
      )
      .all(excludeAuthorId) as unknown as MessageRow[];
  }

  recordDelivery(messageId: number, playerId: number, now: number) {
    this.sql.prepare("UPDATE messages SET deliveries = deliveries + 1 WHERE id = ?").run(messageId);
    this.sql.prepare("INSERT INTO deliveries (message_id, player_id, at) VALUES (?, ?, ?)").run(messageId, playerId, now);
  }

  /** Returns the new report count, or -1 if this player already reported it. */
  addReport(messageId: number, playerId: number, now: number): number {
    try {
      this.sql.prepare("INSERT INTO reports (message_id, player_id, at) VALUES (?, ?, ?)").run(messageId, playerId, now);
    } catch {
      return -1;
    }
    this.sql.prepare("UPDATE messages SET reports = reports + 1 WHERE id = ?").run(messageId);
    return this.getMessage(messageId)?.reports ?? 0;
  }

  reviewQueue(): MessageRow[] {
    return this.sql.prepare("SELECT * FROM messages WHERE status = 'review' ORDER BY created_at ASC").all() as unknown as MessageRow[];
  }

  recentMessages(limit: number): MessageRow[] {
    return this.sql.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?").all(limit) as unknown as MessageRow[];
  }

  messageStats(): Record<string, number> {
    const rows = this.sql.prepare("SELECT status, COUNT(*) AS n FROM messages GROUP BY status").all() as {
      status: string;
      n: number;
    }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  // ---- receipts ----------------------------------------------------------

  insertReceipt(r: {
    playerId: number;
    now: number;
    waitedSeconds: number;
    behind: number;
    snapshot: string;
    text: string;
  }): number {
    const res = this.sql
      .prepare(
        `INSERT INTO receipts (player_id, created_at, waited_seconds, behind, snapshot, text) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(r.playerId, r.now, r.waitedSeconds, r.behind, r.snapshot, r.text);
    return Number(res.lastInsertRowid);
  }

  receiptsFor(playerId: number): ReceiptRow[] {
    return this.sql
      .prepare("SELECT * FROM receipts WHERE player_id = ? ORDER BY created_at DESC")
      .all(playerId) as unknown as ReceiptRow[];
  }

  // ---- chat --------------------------------------------------------------

  insertChat(c: { at: number; kind: string; senderPublicId: string; senderName: string; npcId: string; text: string }): number {
    const res = this.sql
      .prepare(
        `INSERT INTO chat (at, kind, sender_public_id, sender_name, npc_id, text) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.at, c.kind, c.senderPublicId, c.senderName, c.npcId, c.text);
    return Number(res.lastInsertRowid);
  }

  recentChat(limit: number): ChatRow[] {
    const rows = this.sql.prepare("SELECT * FROM chat ORDER BY id DESC LIMIT ?").all(limit) as unknown as ChatRow[];
    return rows.reverse();
  }

  // ---- quests ------------------------------------------------------------

  logQuest(q: {
    playerId: number;
    questId: string;
    option: string;
    stat: string;
    success: boolean;
    probability: number;
    xp: number;
    now: number;
  }) {
    this.sql
      .prepare(
        `INSERT INTO quest_log (player_id, quest_id, option, stat, success, probability, xp, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(q.playerId, q.questId, q.option, q.stat, q.success ? 1 : 0, q.probability, q.xp, q.now);
  }

  /** How many times each stat was chosen in quests since `since` (ms). */
  statUsageSince(playerId: number, since: number): Record<string, number> {
    const rows = this.sql
      .prepare("SELECT stat, COUNT(*) AS n FROM quest_log WHERE player_id = ? AND at > ? AND stat <> '' GROUP BY stat")
      .all(playerId, since) as unknown as { stat: string; n: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.stat] = r.n;
    return out;
  }

  recentQuestIds(playerId: number, limit: number): string[] {
    const rows = this.sql
      .prepare("SELECT quest_id FROM quest_log WHERE player_id = ? ORDER BY id DESC LIMIT ?")
      .all(playerId, limit) as { quest_id: string }[];
    return rows.map((r) => r.quest_id);
  }

  close() {
    this.sql.close();
  }
}
