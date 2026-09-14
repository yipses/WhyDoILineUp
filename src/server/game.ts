import { config, minutesMs, secondsMs } from "./config.js";
import type { Content, Quest, Stat } from "./content.js";
import { Tuning } from "./content.js";
import type { Db, PlayerRow, ReceiptRow } from "./db.js";
import { buildClassifier, decide, type Classifier } from "./moderation.js";
import {
  avatarSignature,
  describeAvatar,
  levelBounds,
  levelCap,
  levelForXp,
  oddsBand,
  parseAvatar,
  randomAvatar,
  statColumn,
  statsOf,
  successProbability,
  titleFor,
  weekKey,
  xpToNext,
  type Avatar,
} from "./progression.js";
import { formatDuration, lineSnapshot, renderReceipt } from "./receipts.js";

// ---------------------------------------------------------------------------
// Types shared with the client (mirrored loosely in public/app.js)
// ---------------------------------------------------------------------------

export type Phase = "landing" | "inline" | "front" | "exiting";

export interface ChatLine {
  id: number;
  at: number;
  kind: "human" | "npc" | "announce" | "system";
  name: string;
  npcId: string;
  publicId: string;
  text: string;
}

export interface QuestView {
  instanceId: number;
  npcId: string;
  npcName: string;
  setup: string;
  a: { label: string; stat: Stat; band: string };
  b: { label: string; stat: Stat; band: string };
  expiresAt: number;
}

export interface QuestResultView {
  npcName: string;
  option: "a" | "b";
  label: string;
  stat: Stat;
  band: string;
  success: boolean;
  text: string;
  xp: number;
}

export interface LineEntryView {
  publicId: string;
  name: string;
  level: number;
  title: string;
  accessory: string;
  avatarText: string;
  isYou: boolean;
  isFront: boolean;
}

export interface LineView {
  count: number;
  entries: LineEntryView[];
  emptyCopy: string;
}

export interface MeView {
  publicId: string;
  name: string;
  avatar: Avatar;
  avatarText: string;
  level: number;
  levelCap: number;
  xp: number;
  xpToNext: number | null;
  /** Cumulative XP where this level started and where the next begins (null at cap). */
  xpLevelStart: number;
  xpLevelEnd: number | null;
  stats: { CHARM: number; INTELLIGENCE: number; STRENGTH: number };
  pendingPoints: number;
  title: string;
  accessory: string;
  lifetimeSeconds: number;
  muted: boolean;
  phase: Phase;
  position: number | null;
  joinedAt: number | null;
  waitedSeconds: number;
  quest: QuestView | null;
  questResult: QuestResultView | null;
  front: {
    deadline: number;
    extensionsLeft: number;
    messageText: string | null;
    prompt: string;
    maxChars: number;
    reported: boolean;
    canReport: boolean;
    /** XP granted for making it to the front. */
    bonusXp: number;
  } | null;
  exiting: { deadline: number; emojis: { emoji: string; ascii: string; label: string }[] } | null;
}

export interface View {
  serverTime: number;
  me: MeView;
  line: LineView;
  chat: ChatLine[];
  tuning: { lineTickSeconds: number; nameMaxChars: number; chatMaxChars: number; timeScale: number };
}

export interface ReceiptView {
  id: number;
  createdAt: number;
  waitedSeconds: number;
  behind: number;
  text: string;
}

export interface Listener {
  /** Something about this player's own state changed; send them a fresh view. */
  onPlayer(playerId: number): void;
  /** The line changed; everyone should get a fresh line view. */
  onLine(): void;
  onChat(line: ChatLine): void;
  /** A world event everyone sees (someone left through the door, etc). */
  onToast(text: string): void;
  onFinished(playerId: number, payload: { receipt: ReceiptView; timedOut: boolean }): void;
  onError(playerId: number, text: string): void;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface PendingQuest {
  instanceId: number;
  quest: Quest;
  issuedAt: number;
  expiresAt: number;
  pA: number;
  pB: number;
}

interface LineEntry {
  playerId: number;
  joinedAt: number;
  lastIdleCreditAt: number;
  nextQuestAt: number;
  quest: PendingQuest | null;
  questResult: QuestResultView | null;
  front: FrontState | null;
}

interface FrontState {
  enteredAt: number;
  deadline: number;
  extensions: number;
  messageId: number | null;
  messageText: string | null;
  prompt: string;
  receiptId: number;
  reported: boolean;
  bonusXp: number;
}

interface ExitState {
  playerId: number;
  deadline: number;
  receiptId: number;
  timedOut: boolean;
  name: string;
}

interface Presence {
  connections: number;
  disconnectedAt: number | null;
}

export class Game {
  readonly tuning: Tuning;
  readonly classifier: Classifier;
  private line: LineEntry[] = [];
  private exiting = new Map<number, ExitState>();
  private presence = new Map<number, Presence>();
  private chatHistory: ChatLine[] = [];
  private lastChatAt = new Map<number, number>();
  private lastAnnouncementAt = 0;
  private nextAmbientAt = 0;
  private recentAmbient: string[] = [];
  private questSeq = 1;
  private promptIdx = 0;
  private listener: Listener | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly db: Db,
    readonly content: Content,
    private now: () => number = Date.now,
  ) {
    this.tuning = new Tuning(content.tuning);
    this.classifier = buildClassifier(content.blocklist);
    this.seedMessages();
    this.chatHistory = db.recentChat(this.tuning.num("CHAT_HISTORY_LINES", 50)).map((r) => ({
      id: r.id,
      at: r.at,
      kind: r.kind as ChatLine["kind"],
      name: r.sender_name,
      npcId: r.npc_id,
      publicId: r.sender_public_id,
      text: r.text,
    }));
    this.scheduleAmbient(this.now());
  }

  setListener(l: Listener) {
    this.listener = l;
  }

  start(intervalMs = 500) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick(this.now());
      } catch (err) {
        console.error("[game] tick error", err);
      }
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // -------------------------------------------------------------------------
  // Seeds
  // -------------------------------------------------------------------------

  private seedMessages() {
    if (this.db.seedCount() > 0) return;
    const now = this.now();
    for (const text of this.content.seedMessages) {
      this.db.insertMessage({ text, authorId: null, status: "approved", isSeed: true, modScore: 1, modReason: "seed", now });
    }
    console.log(`[game] seeded ${this.content.seedMessages.length} messages`);
  }

  // -------------------------------------------------------------------------
  // Players and presence
  // -------------------------------------------------------------------------

  createPlayer(publicId: string, tokenHash: string): PlayerRow {
    const avatar = randomAvatar(this.content);
    return this.db.createPlayer(publicId, tokenHash, JSON.stringify(avatar), this.tuning.num("STAT_BASE", 1), this.now());
  }

  connect(playerId: number) {
    const p = this.presence.get(playerId) ?? { connections: 0, disconnectedAt: null };
    p.connections += 1;
    p.disconnectedAt = null;
    this.presence.set(playerId, p);
    this.db.updatePlayer(playerId, { last_seen: this.now() });
  }

  disconnect(playerId: number) {
    const p = this.presence.get(playerId);
    if (!p) return;
    p.connections = Math.max(0, p.connections - 1);
    if (p.connections === 0) p.disconnectedAt = this.now();
  }

  private humansInLine(): number {
    return this.line.filter((e) => (this.presence.get(e.playerId)?.connections ?? 0) > 0).length;
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  private entryFor(playerId: number): LineEntry | undefined {
    return this.line.find((e) => e.playerId === playerId);
  }

  private indexOf(playerId: number): number {
    return this.line.findIndex((e) => e.playerId === playerId);
  }

  private titleOf(p: PlayerRow) {
    return titleFor(p.level, statsOf(p), p.last_raised, this.content.titles);
  }

  private avatarTextOf(p: PlayerRow): string {
    const t = this.titleOf(p);
    return describeAvatar(parseAvatar(p.avatar_json), this.content.avatarLayers, t.accessory);
  }

  lineView(forPlayerId: number | null): LineView {
    const entries: LineEntryView[] = [];
    for (let i = 0; i < this.line.length; i++) {
      const e = this.line[i];
      const p = this.db.getPlayer(e.playerId);
      if (!p) continue;
      const t = this.titleOf(p);
      entries.push({
        publicId: p.public_id,
        name: p.name,
        level: p.level,
        title: t.title,
        accessory: t.accessory,
        avatarText: this.avatarTextOf(p),
        isYou: e.playerId === forPlayerId,
        isFront: i === 0,
      });
    }
    return { count: this.line.length, entries, emptyCopy: "You're first in line. Someone has to be." };
  }

  view(playerId: number): View {
    const p = this.db.getPlayer(playerId);
    if (!p) throw new Error("no such player");
    const now = this.now();
    const entry = this.entryFor(playerId);
    const exit = this.exiting.get(playerId);
    const t = this.titleOf(p);
    let phase: Phase = "landing";
    if (exit) phase = "exiting";
    else if (entry?.front) phase = "front";
    else if (entry) phase = "inline";
    const idx = entry ? this.indexOf(playerId) : -1;
    const npcName = (id: string) => this.content.npcs.find((n) => n.id === id)?.name ?? id;

    const me: MeView = {
      publicId: p.public_id,
      name: p.name,
      avatar: parseAvatar(p.avatar_json),
      avatarText: this.avatarTextOf(p),
      level: p.level,
      levelCap: levelCap(this.content.xpCurve),
      xp: p.xp,
      xpToNext: xpToNext(p.xp, this.content.xpCurve),
      xpLevelStart: levelBounds(p.xp, this.content.xpCurve).start,
      xpLevelEnd: levelBounds(p.xp, this.content.xpCurve).end,
      stats: statsOf(p),
      pendingPoints: p.pending_points,
      title: t.title,
      accessory: t.accessory,
      lifetimeSeconds: p.lifetime_seconds,
      muted: p.muted === 1,
      phase,
      position: idx >= 0 ? idx + 1 : null,
      joinedAt: entry ? entry.joinedAt : null,
      waitedSeconds: entry ? Math.floor(((now - entry.joinedAt) * config.timeScale) / 1000) : 0,
      quest: entry?.quest
        ? {
            instanceId: entry.quest.instanceId,
            npcId: entry.quest.quest.npcId,
            npcName: npcName(entry.quest.quest.npcId),
            setup: entry.quest.quest.setup,
            a: { label: entry.quest.quest.a.label, stat: entry.quest.quest.a.stat, band: oddsBand(entry.quest.pA, this.content.oddsBands) },
            b: { label: entry.quest.quest.b.label, stat: entry.quest.quest.b.stat, band: oddsBand(entry.quest.pB, this.content.oddsBands) },
            expiresAt: entry.quest.expiresAt,
          }
        : null,
      questResult: entry?.questResult ?? null,
      front: entry?.front
        ? {
            deadline: entry.front.deadline,
            extensionsLeft: this.tuning.num("FRONT_EXTENSIONS_MAX", 2) - entry.front.extensions,
            messageText: entry.front.messageText,
            prompt: entry.front.prompt,
            maxChars: this.tuning.num("MESSAGE_MAX_CHARS", 140),
            reported: entry.front.reported,
            canReport: entry.front.messageId !== null,
            bonusXp: entry.front.bonusXp,
          }
        : null,
      exiting: exit ? { deadline: exit.deadline, emojis: this.content.emojis } : null,
    };

    return {
      serverTime: now,
      me,
      line: this.lineView(playerId),
      chat: p.muted === 1 ? [] : this.chatHistory,
      tuning: {
        lineTickSeconds: this.tuning.num("LINE_TICK_SECONDS", 60),
        nameMaxChars: this.tuning.num("NAME_MAX_CHARS", 20),
        chatMaxChars: this.tuning.num("CHAT_MAX_CHARS", 200),
        timeScale: config.timeScale,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Joining and leaving
  // -------------------------------------------------------------------------

  async join(playerId: number, rawName: string): Promise<void> {
    const p = this.db.getPlayer(playerId);
    if (!p) return;
    if (this.exiting.has(playerId)) {
      this.listener?.onError(playerId, "Pick your exit emoji first.");
      return;
    }
    const name = rawName.replace(/\s+/g, " ").trim().slice(0, this.tuning.num("NAME_MAX_CHARS", 20));
    if (name.length < 1) {
      this.listener?.onError(playerId, "You need a name. Any name.");
      return;
    }
    if (name !== p.name) {
      const verdict = await this.classifier.classify(name, "name");
      if (verdict.score < this.tuning.num("MOD_PASS_THRESHOLD", 0.7)) {
        this.listener?.onError(playerId, "That name didn't pass. Try another.");
        return;
      }
      this.db.updatePlayer(playerId, { name });
    }
    const now = this.now();
    // One identity, one position. A second join replaces the first (rule 11.7),
    // and always lands at the back (rule 2.8).
    this.removeFromLine(playerId, "rejoin", now);
    this.line.push({
      playerId,
      joinedAt: now,
      lastIdleCreditAt: now,
      nextQuestAt: now + minutesMs(this.tuning.num("QUEST_FIRST_DELAY_MINUTES", 1)),
      quest: null,
      questResult: null,
      front: null,
    });
    this.promoteFrontIfNeeded(now);
    this.listener?.onLine();
    this.listener?.onPlayer(playerId);
  }

  leave(playerId: number) {
    const now = this.now();
    if (this.removeFromLine(playerId, "left", now)) {
      this.promoteFrontIfNeeded(now);
      this.listener?.onLine();
    }
    this.listener?.onPlayer(playerId);
  }

  /** Removes the player from the line. Returns true if they were in it. */
  private removeFromLine(playerId: number, reason: "left" | "rejoin" | "timeout" | "grace" | "done", now: number): boolean {
    const idx = this.indexOf(playerId);
    if (idx < 0) return false;
    const entry = this.line[idx];
    this.creditIdle(entry, now, true);
    this.line.splice(idx, 1);
    if (entry.front && reason !== "done") {
      // Left or timed out at the front: no message, receipt already exists.
      const p = this.db.getPlayer(playerId);
      const receipt = this.receiptView(entry.front.receiptId);
      if (receipt) this.listener?.onFinished(playerId, { receipt, timedOut: reason === "timeout" });
      if (p && reason === "timeout") this.listener?.onToast(`${p.name} ran out of time at the door and wandered off.`);
    }
    // The player's own phase changed; make sure their client hears about it.
    if (reason === "timeout" || reason === "grace") this.listener?.onPlayer(playerId);
    return true;
  }

  // -------------------------------------------------------------------------
  // The front of the line
  // -------------------------------------------------------------------------

  private promoteFrontIfNeeded(now: number) {
    const first = this.line[0];
    if (!first || first.front) return;
    const p = this.db.getPlayer(first.playerId);
    if (!p) return;
    // Quests never interrupt the front.
    first.quest = null;
    first.questResult = null;

    const tick = secondsMs(this.tuning.num("LINE_TICK_SECONDS", 60));
    const waitedSeconds = Math.floor(((now - first.joinedAt) * config.timeScale) / 1000);
    const names = this.line.map((e) => this.db.getPlayer(e.playerId)?.name ?? "?");
    const snapshot = lineSnapshot(names, 0, this.tuning.num("RECEIPT_SNAPSHOT_NAMES", 10));
    const behind = this.line.length - 1;
    const text = renderReceipt(waitedSeconds, snapshot, behind);
    const receiptId = this.db.insertReceipt({ playerId: p.id, now, waitedSeconds, behind, snapshot, text });

    const msg = this.drawMessage(p.id, now);
    const prompts = this.content.prompts;
    const prompt = prompts.length ? prompts[this.promptIdx++ % prompts.length] : "";

    // Making it to the front is worth something on its own.
    const bonusXp = Math.max(0, this.tuning.num("XP_FRONT_BONUS", 50));
    first.front = {
      enteredAt: now,
      deadline: now + tick,
      extensions: 0,
      messageId: msg?.id ?? null,
      messageText: msg?.text ?? null,
      prompt,
      receiptId,
      reported: false,
      bonusXp,
    };
    if (bonusXp > 0) this.grantXp(p.id, bonusXp, now);
    this.listener?.onPlayer(p.id);
  }

  private drawMessage(playerId: number, now: number): { id: number; text: string } | null {
    const retire = this.tuning.num("SEED_RETIRE_THRESHOLD", 200);
    const weightExp = this.tuning.num("MESSAGE_DELIVERY_WEIGHT", 1);
    let pool = this.db.approvedMessages(playerId, this.db.approvedNonSeedCount() <= retire);
    if (pool.length === 0) pool = this.db.approvedMessages(playerId, true);
    if (pool.length === 0) return null;
    const weights = pool.map((m) => 1 / Math.pow(1 + m.deliveries, weightExp));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pick = pool[i];
        break;
      }
    }
    this.db.recordDelivery(pick.id, playerId, now);
    return { id: pick.id, text: pick.text };
  }

  moreTime(playerId: number) {
    const entry = this.entryFor(playerId);
    if (!entry?.front) return;
    const max = this.tuning.num("FRONT_EXTENSIONS_MAX", 2);
    if (entry.front.extensions >= max) {
      this.listener?.onError(playerId, "No more time. That's the last of it.");
      return;
    }
    entry.front.extensions += 1;
    entry.front.deadline += secondsMs(this.tuning.num("LINE_TICK_SECONDS", 60));
    this.listener?.onPlayer(playerId);
  }

  async submitMessage(playerId: number, rawText: string) {
    const entry = this.entryFor(playerId);
    if (!entry?.front) return;
    const max = this.tuning.num("MESSAGE_MAX_CHARS", 140);
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text) {
      this.listener?.onError(playerId, "Write something. Anything. It's for a stranger.");
      return;
    }
    if (text.length > max) {
      this.listener?.onError(playerId, `Too long. ${max} characters.`);
      return;
    }
    const now = this.now();
    const p = this.db.getPlayer(playerId)!;
    const front = entry.front;

    // The line advances the moment the message is submitted (rule 2.3a).
    this.removeFromLine(playerId, "done", now);
    this.exiting.set(playerId, {
      playerId,
      deadline: now + secondsMs(this.tuning.num("EXIT_EMOJI_SECONDS", 20)),
      receiptId: front.receiptId,
      timedOut: false,
      name: p.name,
    });
    this.promoteFrontIfNeeded(now);
    this.listener?.onLine();
    this.listener?.onPlayer(playerId);

    // Moderation is asynchronous; the message is not eligible until it passes.
    const id = this.db.insertMessage({ text, authorId: playerId, status: "pending", isSeed: false, modScore: null, modReason: "", now });
    void this.moderateMessage(id, text);
  }

  private async moderateMessage(id: number, text: string) {
    try {
      const v = await this.classifier.classify(text, "message");
      const d = decide(v.score, this.tuning.num("MOD_PASS_THRESHOLD", 0.7), this.tuning.num("MOD_FAIL_THRESHOLD", 0.3));
      this.db.setMessageStatus(id, d, v.score, v.reason);
    } catch (err) {
      console.error("[moderation] message classify failed; sending to review", err);
      this.db.setMessageStatus(id, "review", 0.5, "classifier error");
    }
  }

  chooseEmoji(playerId: number, emoji: string) {
    const exit = this.exiting.get(playerId);
    if (!exit) return;
    const row = this.content.emojis.find((e) => e.emoji === emoji || e.ascii === emoji || e.label === emoji);
    this.finishExit(exit, row ? row : null);
  }

  private finishExit(exit: ExitState, emoji: { emoji: string; ascii: string; label: string } | null) {
    this.exiting.delete(exit.playerId);
    const tag = emoji ? ` ${emoji.emoji} (${emoji.ascii})` : "";
    this.listener?.onToast(`${exit.name} walks through the door.${tag}`);
    const receipt = this.receiptView(exit.receiptId);
    if (receipt) this.listener?.onFinished(exit.playerId, { receipt, timedOut: false });
    this.listener?.onPlayer(exit.playerId);
  }

  report(playerId: number) {
    const entry = this.entryFor(playerId);
    if (!entry?.front || entry.front.messageId === null) return;
    if (entry.front.reported) return;
    const n = this.db.addReport(entry.front.messageId, playerId, this.now());
    entry.front.reported = true;
    if (n >= this.tuning.num("MESSAGE_REPORT_THRESHOLD", 3)) {
      const m = this.db.getMessage(entry.front.messageId);
      if (m && m.status === "approved") this.db.setMessageStatus(m.id, "review");
    }
    this.listener?.onPlayer(playerId);
  }

  // -------------------------------------------------------------------------
  // Progression
  // -------------------------------------------------------------------------

  private grantXp(playerId: number, amount: number, now: number, seconds = 0) {
    if (amount <= 0 && seconds <= 0) return;
    const p = this.db.getPlayer(playerId);
    if (!p) return;
    const wk = weekKey(now, this.tuning.str("LEADERBOARD_RESET_DAY", "Monday"));
    const weekXp = (p.week_key === wk ? p.week_xp : 0) + amount;
    const weekSeconds = (p.week_key === wk ? p.week_seconds : 0) + seconds;
    const xp = p.xp + amount;
    const newLevel = levelForXp(xp, this.content.xpCurve);
    const gained = Math.max(0, newLevel - p.level);
    this.db.updatePlayer(playerId, {
      xp,
      level: Math.max(p.level, newLevel),
      pending_points: p.pending_points + gained,
      lifetime_seconds: p.lifetime_seconds + seconds,
      week_key: wk,
      week_xp: weekXp,
      week_seconds: weekSeconds,
    });
    if (gained > 0) {
      const milestones = this.tuning.list("ANNOUNCE_LEVEL_MILESTONES", [5, 10, 15, 20, 25, 30]);
      for (let l = p.level + 1; l <= newLevel; l++) {
        if (milestones.includes(l)) this.announce("level_milestone", { name: p.name, level: String(l) }, now);
      }
    }
  }

  private creditIdle(entry: LineEntry, now: number, flush: boolean) {
    const minute = secondsMs(60);
    const elapsed = now - entry.lastIdleCreditAt;
    const minutes = Math.floor(elapsed / minute);
    if (minutes <= 0 && !flush) return;
    const rate = this.tuning.num("XP_IDLE_PER_MINUTE", 2);
    if (minutes > 0) {
      entry.lastIdleCreditAt += minutes * minute;
      this.grantXp(entry.playerId, minutes * rate, now, minutes * 60);
    }
    if (flush) {
      const remainderSeconds = Math.floor(((now - entry.lastIdleCreditAt) * config.timeScale) / 1000);
      entry.lastIdleCreditAt = now;
      if (remainderSeconds > 0) this.grantXp(entry.playerId, 0, now, remainderSeconds);
    }
  }

  levelUp(playerId: number, stat: string) {
    const p = this.db.getPlayer(playerId);
    if (!p) return;
    const s = stat.toUpperCase() as Stat;
    if (!["CHARM", "INTELLIGENCE", "STRENGTH"].includes(s)) return;
    if (p.pending_points <= 0) {
      this.listener?.onError(playerId, "No stat points to spend.");
      return;
    }
    const col = statColumn(s);
    this.db.updatePlayer(playerId, { [col]: p[col] + 1, pending_points: p.pending_points - 1, last_raised: s } as Partial<PlayerRow>);
    this.listener?.onPlayer(playerId);
    this.listener?.onLine();
  }

  reroll(playerId: number) {
    const avatar = randomAvatar(this.content);
    this.db.updatePlayer(playerId, { avatar_json: JSON.stringify(avatar) });
    this.listener?.onPlayer(playerId);
    if (this.entryFor(playerId)) this.listener?.onLine();
  }

  setMuted(playerId: number, on: boolean) {
    this.db.updatePlayer(playerId, { muted: on ? 1 : 0 });
    this.listener?.onPlayer(playerId);
  }

  // -------------------------------------------------------------------------
  // Quests
  // -------------------------------------------------------------------------

  private issueQuest(entry: LineEntry, now: number) {
    const p = this.db.getPlayer(entry.playerId);
    if (!p) return;
    const unlocked = this.content.questTiers.filter((t) => t.unlockLevel <= p.level).map((t) => t.tier);
    if (unlocked.length === 0) return;
    const recent = new Set(this.db.recentQuestIds(p.id, this.tuning.num("QUEST_RECENT_MEMORY", 8)));
    const bias = this.tuning.num("QUEST_TIER_WEIGHT_BIAS", 2);
    const byTier = new Map<number, Quest[]>();
    for (const q of this.content.quests) {
      if (!unlocked.includes(q.tier) || recent.has(q.id)) continue;
      if (!byTier.has(q.tier)) byTier.set(q.tier, []);
      byTier.get(q.tier)!.push(q);
    }
    let candidates = [...byTier.entries()];
    if (candidates.length === 0) {
      // Everything recent; allow repeats rather than go silent.
      for (const q of this.content.quests) {
        if (!unlocked.includes(q.tier)) continue;
        if (!byTier.has(q.tier)) byTier.set(q.tier, []);
        byTier.get(q.tier)!.push(q);
      }
      candidates = [...byTier.entries()];
      if (candidates.length === 0) return;
    }
    const weights = candidates.map(([tier]) => Math.pow(tier, bias));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let chosenTier = candidates[candidates.length - 1][1];
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosenTier = candidates[i][1];
        break;
      }
    }
    const quest = chosenTier[Math.floor(Math.random() * chosenTier.length)];
    const stats = statsOf(p);
    entry.questResult = null;
    entry.quest = {
      instanceId: this.questSeq++,
      quest,
      issuedAt: now,
      expiresAt: now + secondsMs(this.tuning.num("QUEST_TIMEOUT_SECONDS", 180)),
      pA: successProbability(stats[quest.a.stat], quest.a.difficulty, this.tuning),
      pB: successProbability(stats[quest.b.stat], quest.b.difficulty, this.tuning),
    };
    this.listener?.onPlayer(p.id);
  }

  private scheduleNextQuest(entry: LineEntry, now: number) {
    const interval = minutesMs(this.tuning.num("QUEST_INTERVAL_MINUTES", 4));
    const jitter = minutesMs(this.tuning.num("QUEST_INTERVAL_JITTER_MINUTES", 1));
    entry.nextQuestAt = now + interval + (Math.random() * 2 - 1) * jitter;
  }

  chooseQuest(playerId: number, instanceId: number, option: "a" | "b" | "ignore") {
    const entry = this.entryFor(playerId);
    if (!entry?.quest || entry.quest.instanceId !== instanceId) return;
    const now = this.now();
    const pending = entry.quest;
    entry.quest = null;
    this.scheduleNextQuest(entry, now);
    if (option === "ignore") {
      entry.questResult = null;
      this.listener?.onPlayer(playerId);
      return;
    }
    const opt = option === "a" ? pending.quest.a : pending.quest.b;
    const p = option === "a" ? pending.pA : pending.pB;
    const success = Math.random() < p;
    const tier = this.content.questTiers.find((t) => t.tier === pending.quest.tier);
    const xp = success ? (tier?.xpSuccess ?? 20) : this.tuning.num("QUEST_XP_FAIL", 5);
    const band = oddsBand(p, this.content.oddsBands);
    const npcName = this.content.npcs.find((n) => n.id === pending.quest.npcId)?.name ?? pending.quest.npcId;
    entry.questResult = {
      npcName,
      option,
      label: opt.label,
      stat: opt.stat,
      band,
      success,
      text: success ? opt.success : opt.failure,
      xp,
    };
    this.db.logQuest({ playerId, questId: pending.quest.id, option, success, probability: p, xp, now });
    const player = this.db.getPlayer(playerId);
    this.grantXp(playerId, xp, now);
    if (success && band === this.content.oddsBands[0]?.label && player) {
      this.announce("long_shot", { name: player.name, level: String(player.level) }, now);
    }
    this.listener?.onPlayer(playerId);
  }

  dismissQuestResult(playerId: number) {
    const entry = this.entryFor(playerId);
    if (!entry) return;
    entry.questResult = null;
    this.listener?.onPlayer(playerId);
  }

  // -------------------------------------------------------------------------
  // Chat and NPCs
  // -------------------------------------------------------------------------

  private pushChat(line: Omit<ChatLine, "id">): ChatLine {
    const id = this.db.insertChat({
      at: line.at,
      kind: line.kind,
      senderPublicId: line.publicId,
      senderName: line.name,
      npcId: line.npcId,
      text: line.text,
    });
    const full: ChatLine = { id, ...line };
    this.chatHistory.push(full);
    const keep = this.tuning.num("CHAT_HISTORY_LINES", 50);
    if (this.chatHistory.length > keep) this.chatHistory.splice(0, this.chatHistory.length - keep);
    this.listener?.onChat(full);
    return full;
  }

  async chat(playerId: number, rawText: string) {
    const p = this.db.getPlayer(playerId);
    if (!p) return;
    if (!this.entryFor(playerId)) {
      this.listener?.onError(playerId, "Chat is for people in line.");
      return;
    }
    const text = rawText.replace(/\s+/g, " ").trim().slice(0, this.tuning.num("CHAT_MAX_CHARS", 200));
    if (!text) return;
    const now = this.now();
    const last = this.lastChatAt.get(playerId) ?? 0;
    if (now - last < secondsMs(this.tuning.num("CHAT_RATE_LIMIT_SECONDS", 3))) {
      this.listener?.onError(playerId, "Slow down.");
      return;
    }
    this.lastChatAt.set(playerId, now);
    const verdict = await this.classifier.classify(text, "chat");
    if (verdict.score < this.tuning.num("MOD_PASS_THRESHOLD", 0.7)) {
      this.listener?.onError(playerId, "That didn't go through.");
      return;
    }
    const delay = secondsMs(this.tuning.num("CHAT_MOD_DELAY_SECONDS", 2));
    setTimeout(() => {
      if (!this.entryFor(playerId)) return; // left before it posted
      this.pushChat({ at: this.now(), kind: "human", name: p.name, npcId: "", publicId: p.public_id, text });
    }, delay);
  }

  private scheduleAmbient(now: number) {
    const interval = secondsMs(this.tuning.num("NPC_AMBIENT_INTERVAL_SECONDS", 45));
    const jitter = secondsMs(this.tuning.num("NPC_AMBIENT_JITTER_SECONDS", 30));
    this.nextAmbientAt = now + interval + (Math.random() * 2 - 1) * jitter;
  }

  private ambient(now: number) {
    const lines = this.content.npcLines.filter((l) => !this.recentAmbient.includes(l.text));
    const pool = lines.length ? lines : this.content.npcLines;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.recentAmbient.push(pick.text);
    if (this.recentAmbient.length > 12) this.recentAmbient.shift();
    const npc = this.content.npcs.find((n) => n.id === pick.npcId);
    this.pushChat({ at: now, kind: "npc", name: npc?.name ?? pick.npcId, npcId: pick.npcId, publicId: "", text: pick.text });
  }

  private announce(event: string, vars: Record<string, string>, now: number) {
    const minGap = secondsMs(this.tuning.num("ANNOUNCE_MIN_INTERVAL_SECONDS", 90));
    if (now - this.lastAnnouncementAt < minGap) return; // dropped, not queued
    const options = this.content.announcements.filter((a) => a.event === event);
    if (!options.length) return;
    const pick = options[Math.floor(Math.random() * options.length)];
    const text = pick.text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
    const npc = this.content.npcs.find((n) => n.id === pick.npcId);
    this.lastAnnouncementAt = now;
    this.pushChat({ at: now, kind: "announce", name: npc?.name ?? pick.npcId, npcId: pick.npcId, publicId: "", text });
  }

  // -------------------------------------------------------------------------
  // Leaderboards and receipts
  // -------------------------------------------------------------------------

  leaderboard(playerId: number) {
    const size = this.tuning.num("LEADERBOARD_SIZE", 100);
    const me = this.db.getPlayer(playerId);
    const wk = weekKey(this.now(), this.tuning.str("LEADERBOARD_RESET_DAY", "Monday"));
    const row = (p: PlayerRow, rank: number, weekly: boolean) => ({
      rank,
      publicId: p.public_id,
      name: p.name,
      level: p.level,
      title: this.titleOf(p).title,
      avatarText: this.avatarTextOf(p),
      avatarShort: avatarSignature(parseAvatar(p.avatar_json)),
      minutes: Math.floor((weekly ? p.week_seconds : p.lifetime_seconds) / 60),
      xp: weekly ? p.week_xp : p.xp,
      isYou: p.id === playerId,
    });
    const all = this.db.allTimeBoard(size).map((p, i) => row(p, i + 1, false));
    const weekly = this.db.weeklyBoard(wk, size).map((p, i) => row(p, i + 1, true));
    let myAll = null;
    let myWeekly = null;
    if (me && me.name) {
      if (!all.some((r) => r.isYou)) myAll = row(me, this.db.allTimeRank(me), false);
      if (!weekly.some((r) => r.isYou)) {
        const r = this.db.weeklyRank(me, wk);
        myWeekly = r > 0 ? row(me, r, true) : null;
      }
    }
    return { weekKey: wk, all, weekly, myAll, myWeekly };
  }

  receiptView(id: number): ReceiptView | null {
    const rows = this.db.sql.prepare("SELECT * FROM receipts WHERE id = ?").all(id) as unknown as ReceiptRow[];
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, createdAt: r.created_at, waitedSeconds: r.waited_seconds, behind: r.behind, text: r.text };
  }

  receipts(playerId: number): ReceiptView[] {
    return this.db.receiptsFor(playerId).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      waitedSeconds: r.waited_seconds,
      behind: r.behind,
      text: r.text,
    }));
  }

  // -------------------------------------------------------------------------
  // The clock
  // -------------------------------------------------------------------------

  tick(now: number) {
    let lineChanged = false;

    // Disconnected players lose their spot after the grace period.
    const grace = secondsMs(this.tuning.num("LEAVE_GRACE_SECONDS", 30));
    for (const [playerId, pres] of this.presence) {
      if (pres.connections === 0 && pres.disconnectedAt !== null && now - pres.disconnectedAt >= grace) {
        if (this.removeFromLine(playerId, "grace", now)) lineChanged = true;
        const exit = this.exiting.get(playerId);
        if (exit) this.finishExit(exit, null);
        this.presence.delete(playerId);
      }
    }

    // Front-of-line timer.
    const front = this.line[0];
    if (front?.front && now >= front.front.deadline) {
      this.removeFromLine(front.playerId, "timeout", now);
      lineChanged = true;
    }

    if (lineChanged) this.promoteFrontIfNeeded(now);

    // Exit emoji timeouts.
    for (const exit of [...this.exiting.values()]) {
      if (now >= exit.deadline) this.finishExit(exit, null);
    }

    // Idle XP and quests for everyone in line.
    for (const entry of this.line) {
      const before = this.db.getPlayer(entry.playerId)?.level ?? 0;
      this.creditIdle(entry, now, false);
      const after = this.db.getPlayer(entry.playerId)?.level ?? 0;
      if (after !== before) this.listener?.onPlayer(entry.playerId);

      if (entry.front) continue;
      if (entry.quest && now >= entry.quest.expiresAt) {
        entry.quest = null; // expires silently, no penalty
        this.scheduleNextQuest(entry, now);
        this.listener?.onPlayer(entry.playerId);
      }
      if (!entry.quest && now >= entry.nextQuestAt) {
        this.issueQuest(entry, now);
        if (!entry.quest) this.scheduleNextQuest(entry, now);
      }
    }

    // NPC ambient chat, only while someone is actually here.
    if (now >= this.nextAmbientAt) {
      if (this.humansInLine() > 0) this.ambient(now);
      this.scheduleAmbient(now);
    }

    if (lineChanged) this.listener?.onLine();
  }

  /** For tests and the mod tool. */
  debugState() {
    return {
      line: this.line.map((e) => ({ playerId: e.playerId, front: !!e.front, quest: e.quest?.quest.id ?? null })),
      exiting: [...this.exiting.keys()],
      humansInLine: this.humansInLine(),
    };
  }

  formatWait(seconds: number) {
    return formatDuration(seconds);
  }
}
