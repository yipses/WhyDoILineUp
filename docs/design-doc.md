# The Line, Design Document

Working title. Version 0.2, September 2026. Supersedes v0.1.

Format: rulebook. Locked decisions are stated as rules. Open questions and parked ideas are listed at the end of each section. Tuning values live in the Google Sheet **The Line — Content & Tuning** (mirrored in `content/*.csv`) and are referenced by field name; the values quoted here are the current settings, not placeholders.

This version describes the game as built in v1 (text only, multiplayer, real time). Where v0.1 had an open question, the answer is now a rule.

---

## 1. Premise

People line up. The front of the line is never explained. That is the whole product.

**Rules**
1. The site never states what is at the front of the line. No copy, NPC, or UI element may explain it.
2. The world treats the line as normal. Nothing in the game acknowledges that lining up for nothing is absurd.
3. Satire comes from specificity, not from jokes. Present-day, mundane, slightly wrong.
4. The wait is the product. Every system exists to make waiting interesting, not to shorten it.

---

## 2. Core loop

**Rules**
1. A visitor joins the line by entering a display name and pressing one button. No account required.
2. On joining they receive a random text avatar (build, hair, top, bottom, item). A randomize button rerolls it. Free, unlimited.
3. The line advances when either: (a) the person at the front submits their message, or (b) `LINE_TICK_SECONDS` (60) elapses, whichever comes first. Front-of-line extensions (rule 10) extend the tick.
4. On reaching the front the player is granted `XP_FRONT_BONUS` (50) XP and told so. This is the hurrah for having waited.
5. At the front, the player reads one message left by a previous front-of-liner, together with the prompt that writer was answering, then writes one for a future front-of-liner.
6. After writing, the player picks one emoji from a fixed menu of twelve (each with an ASCII fallback). They have `EXIT_EMOJI_SECONDS` (20) to pick; otherwise they leave with none. Everyone in line sees "{name} walks through the door" with the emoji.
7. A text receipt (Section 7) is generated the moment the player reaches the front and saved to their identity. After the emoji, the player is shown it with share options, then returned to the landing page. All previous receipts remain available from the menu.
8. Leaving the site loses your spot. On tab close or navigation away, the player is removed from the line after `LEAVE_GRACE_SECONDS` (30) without a heartbeat. Progression persists; position does not.
9. A player may rejoin at any time. A rejoin always places the player at the back of the line. Lost positions are never restored. One identity holds at most one position; a second join replaces the first.
10. At the front, the player has `LINE_TICK_SECONDS` to submit. A visible countdown runs in the dialog. A "More time" button grants one additional interval and can be pressed at most `FRONT_EXTENSIONS_MAX` times (LOCKED: 2), for a maximum of three intervals at the front.
11. If the timer expires with no message submitted, the player is removed from the line, no message is left, and they are returned to the landing page with a one-line notice. No share screen is shown. The receipt still exists (it was created on reaching the front) and sits quietly in their gallery. The player may rejoin at the back.

**Throughput.** The line moves at most one person per tick, up to three ticks with extensions. Wait time grows linearly with headcount. This is intended. It will be scaled with real players or filled with content, not sped up.

---

## 3. The message system

**Rules**
1. Messages are text only, max `MESSAGE_MAX_CHARS` (140).
2. Every message is moderated before it enters the pool. Nothing is delivered live; a message written now is eligible for a later front-of-liner only after it passes. In practice the very next front-of-liner never receives it, because they are promoted before it is stored.
3. The message a player receives is drawn at random from the approved pool, weighted toward messages delivered fewer times: weight = 1 / (1 + deliveries) ^ `MESSAGE_DELIVERY_WEIGHT` (1.0).
4. A player never receives their own message.
5. A rotating prompt is shown above the text box, cycled in order from the `Prompts` tab. Prompts are optional to follow. The prompt is stored with the message and shown to whoever receives it ("Someone who stood here before you was asked: … They wrote: …"). Seed messages have no prompt and use plain wording.
6. The pool is seeded with the `Seed_Messages` tab (50), flagged as seeds. Seeds stop being drawn once approved non-seed messages exceed `SEED_RETIRE_THRESHOLD` (200). If the non-seed pool is ever empty, seeds are drawn regardless. If nothing at all is available, the player is told nobody left anything.
7. The existence of the message is never shown outside the front of the line: not on the landing page, not in the receipt, not in NPC dialogue, not in chat.
8. Moderation is two-stage. A classifier scores every message 0 to 1. Score ≥ `MOD_PASS_THRESHOLD` (0.7) enters the pool; score < `MOD_FAIL_THRESHOLD` (0.3) is discarded; anything between goes to the human review queue.
9. The classifier is pluggable. Default is a heuristic (word blocklist from the `Blocklist` tab with leetspeak normalisation, URLs, emails, phone numbers, shouting, repeated characters). When `ANTHROPIC_API_KEY` is set, a Claude classifier scores instead, with the heuristic as a floor and as fallback on API failure.
10. The human review tool lives at `/mod`, behind `MOD_PASSWORD`: pending messages with score and reason, approve, reject, and the prompt each was written to.
11. A player can report the message they received, once. At `MESSAGE_REPORT_THRESHOLD` (3) reports it is pulled from the pool into the review queue. Approval returns it with reports reset; rejection discards it.

---

## 4. Progression

Waiting earns XP. XP earns levels. Levels raise stats. Stats make quests interesting.

**Rules**
1. XP accrues per full minute in line at `XP_IDLE_PER_MINUTE` (2). Idling is allowed.
2. Quests award XP per Section 5. This is the main XP source.
3. Reaching the front awards `XP_FRONT_BONUS` (50).
4. Level thresholds follow the `XP_Curve` tab: cumulative XP per level, 30 rows, roughly `50 × 1.18^(level−1)` per step. Levels are never lost.
5. On each level-up, one stat rises by 1 automatically: whichever of CHARM, INTELLIGENCE, STRENGTH the player chose most often in quest answers since their previous level-up. Ties, including having answered no quests, are broken at random. Ignored quests count for nothing. The player is told which stat rose and why. This is the only way stats change. There is no manual stat point.
6. All players start at level 1 with all stats at `STAT_BASE` (1).
7. Level gates quest tiers (Section 5). Nothing else is level-gated.
8. Progression persists across visits via an anonymous identity (Section 9). Losing your spot never affects progression.
9. The level cap is the last row of `XP_Curve`. At cap the display reads LVL MAX. XP continues to accrue for leaderboards.

**Player-facing display**
- The whole interface is framed as an SNES-era JRPG menu system rendered in text: double-bordered boxes, a cursor-driven menu, numbered hotkeys, a blinking cursor in inputs.
- A strip under the menu is always visible: name and title, an XP bar showing progress through the current level with the count to the next, and the three stats (CHA / INT / STR).
- The status screen adds the avatar description, lifetime time in line, and stat bars.
- Titles are cosmetic and derived from the dominant stat, in tiers by level (`Titles` tab, `min_level` column). Ties resolve to the most recently raised stat. When every stat is equal and none has been raised (a fresh player), the title is the `NONE` row: "Person in Line".
- Each title carries a text accessory ("with a clipboard", "with a folding chair under one arm") appended to the avatar description. It is how other people in line read your build. Clicking a name in the line shows that player's level, title, and description.

---

## 5. Quests

NPCs approach the player privately with a two-option decision. Each option is a stat check with a roll.

**Rules**
1. The first quest arrives `QUEST_FIRST_DELAY_MINUTES` (1) after joining; after that one per `QUEST_INTERVAL_MINUTES` (4) ± `QUEST_INTERVAL_JITTER_MINUTES` (1). A player never has more than one quest pending. Quests are never delivered while the player is at the front.
2. A quest is a dialog box addressed to the player. It is not visible in global chat.
3. Every quest presents exactly two options, each keyed to a different stat.
4. Each option has a difficulty from the quest's tier band (`Quest_Tiers` tab).
5. Resolution is always a roll. `p = ROLL_BASE (0.5) + (stat − difficulty) × ROLL_STEP (0.08)`, clamped to `ROLL_FLOOR` (0.05) and `ROLL_CEILING` (0.95). No outcome is certain.
6. Player-facing odds are qualitative only, from the `Odds_Bands` tab: Long shot (< 20%), Risky, Even, Likely, Sure thing (≥ 80%). Percentages are never shown.
7. XP payout is per tier (`xp_success`) and identical for both options. Failed checks pay `QUEST_XP_FAIL` (5), never zero.
8. Tiers unlock by level. Current table: tier 1 at level 1 (difficulty 0–2, 20 XP), tier 2 at 4 (2–5, 40), tier 3 at 8 (4–8, 70), tier 4 at 14 (7–12, 110), tier 5 at 20 (10–18, 160). Quests are drawn from all unlocked tiers with weight `tier ^ QUEST_TIER_WEIGHT_BIAS` (2), and never repeat any of the player's last `QUEST_RECENT_MEMORY` (8) quests.
9. Every option has two outcome texts, success and failure. Both must be specific and funny. Failure is content, not punishment.
10. A quest that goes unanswered for `QUEST_TIMEOUT_SECONDS` (180) expires silently. A player may also decline it outright ("Ignore them"). Neither carries a penalty.
11. Quests may reference the front of the line or the door and may speculate in character, but never state or imply what happens there. The message is never mentioned.
12. Every quest belongs to a specific NPC and is themed to that character. NPCs recur, so players learn what each tends to ask and which stats they lean on.

**Content structure (one row of the `Quests` tab)**
id, tier, npc_id, setup, a_label, a_stat, a_difficulty, a_success, a_failure, b_label, b_stat, b_difficulty, b_success, b_failure.

**NPC roster** (`NPCs` tab). Fifty quests exist: two per NPC per tier.
- The Regular: has been here since a product launch nobody remembers. Leans STRENGTH, INTELLIGENCE.
- The Streamer: broadcasting the line to zero viewers. Leans CHARM, STRENGTH.
- The Placeholder: holding a spot for a friend who is obviously not coming. Leans CHARM, INTELLIGENCE.
- The Vendor: sells one item, changes daily, never has change. Leans INTELLIGENCE, STRENGTH.
- The Auditor: convinced they are in the wrong line, needs help proving it. Leans INTELLIGENCE, CHARM.

---

## 6. Chat and NPCs

**Rules**
1. One global chat room, visible to everyone in line. Humans and NPCs post in the same room. Players not in line do not see chat.
2. NPCs are openly NPCs. They never claim to be human and are coloured differently in the log.
3. NPC voice is earnest. NPCs never wink at the premise, never explain the line, never break character.
4. NPCs have three jobs: (a) deliver quests privately, (b) post ambient lines from the `NPC_Lines` tab so the room never looks dead, (c) announce player achievements from the `Announcements` tab.
5. Ambient lines post every `NPC_AMBIENT_INTERVAL_SECONDS` (45) ± `NPC_AMBIENT_JITTER_SECONDS` (30), only while at least one human is in line, avoiding the last dozen lines used.
6. Announcements cover wins only. Eligible events: Long shot successes, and level-ups listed in `ANNOUNCE_LEVEL_MILESTONES` (5, 10, 15, 20, 25, 30). Templates substitute `{name}` and `{level}`.
7. Announcements are rate-limited to one per `ANNOUNCE_MIN_INTERVAL_SECONDS` (90) globally. Events that miss the window are dropped, not queued.
8. NPC chat is pre-written with light templating. No live model calls.
9. Human chat is moderated by the same classifier as messages, in real time: a line posts after `CHAT_MOD_DELAY_SECONDS` (2) if it scores at or above the pass threshold, otherwise it is dropped and the sender told "That didn't go through." Max `CHAT_MAX_CHARS` (200); at most one line per `CHAT_RATE_LIMIT_SECONDS` (3) per player.
10. Chat history shown to a joining player is the last `CHAT_HISTORY_LINES` (50).
11. Players can mute chat. Muted players see nothing and post nothing until they unmute.

---

## 7. Growth and sharing

**Rules**
1. On reaching the front, a text receipt is generated, captioned "I did this and all I got was this lousy image."
2. The receipt contains exactly three things: total wait time, a text snapshot of the line at the moment the player reached the front (`[door] >You<  Name  Name …`, up to `RECEIPT_SNAPSHOT_NAMES`), and the number of people behind them. Nothing else. No level, no hint of the message.
3. Receipts are saved to the player's identity, unlimited, and viewable from the RECEIPTS menu at any time.
4. The landing page shows the live line, a live headcount, and the name field. No explanation, no feature list, no chat.
5. The empty-state landing copy: "You're first in line. Someone has to be."
6. Sharing is done from the receipt view via three options: copy text, share on X (intent link), and send by email (mailto). Each includes the receipt text and the site link (`SITE_URL`, or the page origin).
7. The exit emoji appears in the world only, not on the receipt.

---

## 8. Art direction

v1 is text only. Everything below the top bar is monospace text in bordered boxes on a dark ground. The SNES-era JRPG framing from v0.1 (pixel avatars, side-scrolling street, restricted palette, stiff motion) remains the intended direction for a later graphical version and is not part of v1. The server and its state model do not change when that happens; only `public/` does.

---

## 9. Leaderboards and identity

**Rules**
1. Two leaderboards: Weekly (resets `LEADERBOARD_RESET_DAY`, Monday, 00:00 UTC) and All-time.
2. All-time ranks by level, with total seconds waited as the tiebreaker.
3. Weekly ranks by XP earned during the week, with seconds waited that week as the tiebreaker. Level is displayed alongside.
4. Identity is anonymous and persistent (Section 10). The record holds name, avatar, level, stats, XP, lifetime seconds, weekly counters, mute preference, and all receipts.
5. Display names are not unique. Rows show name, level, the ranking figure, title, and a short avatar signature (hair, top) to tell namesakes apart.
6. Display names pass the heuristic blocklist check at join (kept synchronous so joining is instant). Max `NAME_MAX_CHARS` (20).
7. Both boards show the top `LEADERBOARD_SIZE` (100). The player's own row and rank are shown beneath if they fall outside the list.

---

## 10. Infrastructure

**Rules**
1. All progression state is server-authoritative. The client only displays what the server sends.
2. Each player has a secret token (256 bits, cryptographically random, minted by the server, stored hashed) and a separate public id. The public id is the only identifier other players ever see.
3. The token lives in a cookie with `HttpOnly`, `SameSite=Lax`, and `Secure` (disable `Secure` with `SECURE_COOKIES=0` for plain-http local development). It is never in localStorage, URLs, receipts, logs, or realtime payloads.
4. The cookie is long-lived (1 year). Clearing cookies loses the identity; recovery via optional sign-in is parked.
5. One process. Node 22 with the built-in SQLite module and a WebSocket server. The line itself is in memory and empties on restart; players, messages, receipts, chat history, and the quest log are in SQLite. Schema changes are additive.
6. The server must run as exactly one instance behind HTTPS. Suitable hosts: any Node host with a persistent disk (Fly.io, Railway, Render, a VPS). It cannot be served statically.
7. `TIME_SCALE` divides every timer for playtesting. Bots and the client follow it.

**Known limits**
- A token can be taken from the player's own machine. Accounts would not prevent this.
- Determined players can create many identities to farm a leaderboard. Accepted for v1.
- Token rotation is not implemented.

---

## 11. Content and tuning workflow

- Two Google Sheets: **The Line — Content & Tuning** (tabs: Tuning, XP_Curve, Quest_Tiers, Odds_Bands, Titles, Avatar_Parts, Emojis, NPCs, NPC_Lines, Announcements, Prompts, Seed_Messages, Blocklist) and **The Line — Quests** (one tab, Quests). The split exists only because the combined upload was too large; the Quests tab can be moved into the main sheet.
- The sheets are the source of truth. `npm run content:pull` fetches every tab into `content/*.csv` (sheet ids in `content/SHEET_ID` and `content/QUESTS_SHEET_ID`; both sheets must be shared as "anyone with the link can view"). Restart the server to load.
- Adding a tuning key means adding it to the sheet, the CSV, `scripts/build_content.py`, and a default in code. `XP_FRONT_BONUS` was added after the sheet upload and must be added to the Tuning tab by hand before the next pull.
- Tuning fields: LINE_TICK_SECONDS, FRONT_EXTENSIONS_MAX, EXIT_EMOJI_SECONDS, LEAVE_GRACE_SECONDS, MESSAGE_MAX_CHARS, MESSAGE_DELIVERY_WEIGHT, SEED_RETIRE_THRESHOLD, MOD_PASS_THRESHOLD, MOD_FAIL_THRESHOLD, MESSAGE_REPORT_THRESHOLD, XP_IDLE_PER_MINUTE, XP_FRONT_BONUS, STAT_BASE, QUEST_FIRST_DELAY_MINUTES, QUEST_INTERVAL_MINUTES, QUEST_INTERVAL_JITTER_MINUTES, QUEST_TIMEOUT_SECONDS, QUEST_TIER_WEIGHT_BIAS, QUEST_RECENT_MEMORY, ROLL_BASE, ROLL_STEP, ROLL_FLOOR, ROLL_CEILING, QUEST_XP_FAIL, ANNOUNCE_LEVEL_MILESTONES, ANNOUNCE_MIN_INTERVAL_SECONDS, NPC_AMBIENT_INTERVAL_SECONDS, NPC_AMBIENT_JITTER_SECONDS, CHAT_HISTORY_LINES, CHAT_MAX_CHARS, CHAT_MOD_DELAY_SECONDS, CHAT_RATE_LIMIT_SECONDS, LEADERBOARD_RESET_DAY, LEADERBOARD_SIZE, NAME_MAX_CHARS, RECEIPT_SNAPSHOT_NAMES, LINE_VIEW_NAMES.

---

## 12. Testing

- `npm test`: engine tests against a fake clock (join, front, extensions, submit, emoji, receipt, timeout, grace period, idle XP, quests, level-ups and stat raises, chat moderation, reports, leaderboards).
- `npm run bots`: bots that join, wait, chat, answer quests, linger at the front, leave messages, pick emoji, rejoin, and occasionally wander off. The way to see a full line.
- Player-facing changes get a quick browser run on top of the tests.

---

## 13. Parking lot

- Let-through (removed in v0.2; the v0.1 version could be farmed by two players swapping. If it returns, cooldown per pair, not per player.)
- Graphical client per Section 8.
- Coins as a secondary currency (quest stakes, item store).
- Spatial (neighbour-only) chat.
- Prestige system at level cap.
- Optional sign-in for progression recovery.
- Token rotation.
- Weekly leaderboard archive (past weeks are not kept).
- Hosting config (Dockerfile, Fly.io).
- Ambient street events (pigeon, passing vendor, weather).
- Seasonal backdrops.
- Player-to-player emotes.
