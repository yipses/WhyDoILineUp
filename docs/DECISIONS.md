# Decisions and deviations from the design doc

The spec is `docs/design-doc.md` (v0.1, September 2026). This file records
where the build departs from it and why, plus decisions the doc left open.
Newest at the bottom. Add to it whenever a rule changes.

## Scope decisions at kickoff

- **Multiplayer and real-time from v1.** The owner did not want to rebuild
  later. One Node process owns the line; browsers connect over WebSocket.
- **Text only.** "Dopewars" was only ever a reference for text-based, not for
  turn-based or terminal. The client is a browser page rendered as monospace
  text with keyboard menus, so it can be shared as a link and later swapped
  for pixel art without touching the server.
- **Stack: TypeScript on Node 22, SQLite via `node:sqlite`, `ws`.** No
  native modules, no framework, no bundler. Engine (`src/server/game.ts`) is
  separable from transport (`src/server/server.ts`) and testable with a fake
  clock.
- **Content and tuning live in Google Sheets**, mirrored into `content/*.csv`
  by `npm run content:pull`. Two sheets because the combined workbook was too
  large for a single upload: "The Line — Content & Tuning" and "The Line —
  Quests". Ids are in `content/SHEET_ID` and `content/QUESTS_SHEET_ID`.
- **All tuning values and formulas were proposed by the builder** and can be
  changed in the sheet. Roll formula:
  `p = ROLL_BASE + (stat - difficulty) * ROLL_STEP`, clamped. XP curve is
  `50 * 1.18^(level-1)` per level over 30 levels.

## Deviations from the doc

| Doc says | Build does | Why |
| --- | --- | --- |
| Section 6, let-through | Removed entirely. No swap, no streak, no XP. | Owner decision. The doc also contradicted itself (rule 6.1 vs the open question) and two players could farm XP by swapping back and forth. |
| 2.11: timeout at the front still generates a share image and shows it | Receipt is saved quietly; the player is dropped to the landing page with a one-line notice. No share screen. | Owner decision: "you shouldn't be sharing" on a timeout. |
| 4.5: on level-up the player chooses a stat | Stats rise automatically. Each level raises the stat chosen most in quests since the previous level-up; ties (including no quests) are random. No pending point, no LEVEL UP menu. | Owner decision to simplify. Persisted via `players.last_levelup_at` and `quest_log.stat`. |
| 4, titles derived from dominant stat | Added a default title (stat `NONE`, "Person in Line") for the all-equal, nothing-raised state. | At level 1 all stats are equal so no title could be derived. |
| 8.1–8.2: share *image* | A text receipt with exactly the three required facts (wait time, ASCII line snapshot, people behind). Sharing is copy, an X intent link, and mailto. | Text-only v1. |
| 3.8–3.9: AI classifier + human review tool | Pluggable classifier. Default is a heuristic (blocklist, URLs, contact info, shouting). A Claude classifier turns on when `ANTHROPIC_API_KEY` is set. `/mod` is the review queue, behind `MOD_PASSWORD`. | Keep v1 runnable with no keys. |
| 3.5: prompt shown above the text box | Also stored with the message and shown to the reader ("was asked: … They wrote: …"). Seeds have no prompt. | Owner: the message lost impact without the question. |
| 2.5: emoji picked on exit | Fixed menu of 12 emoji from the sheet, each with an ASCII fallback. 20s to pick (`EXIT_EMOJI_SECONDS`) before a default. | Terminals and fonts vary. |
| Not in doc | `XP_FRONT_BONUS` (50) granted on reaching the front, announced in the front dialog. | Owner asked for a "hurrah". Note: 50 XP is exactly level 2, so a first front visit levels you up immediately and the raise is usually random. Raise the level 2 threshold if that's unwanted. |
| Not in doc | XP bar and the three stats are always visible under the menu. | Owner request. |
| 7 open question: NPC chat generation | Pre-written pool with light templating (`NPC_Lines`, `Announcements`). No model calls. | Cost and moderation. |
| 5 open question: decline a quest | Yes, "Ignore them" is an option. No penalty. | Expiry already had none. |
| 7 open question: mute chat | Yes, per player. | |
| 11: identity | Secret token in an HttpOnly cookie, stored hashed; public id broadcast. `SECURE_COOKIES=0` for plain-http dev. | As specified. Token rotation not implemented. |
| 10.5: leaderboard rows show name plus avatar | Rows show name, level, xp or minutes, title, and a dim "hair, top" signature line. | Text substitute for the avatar. |

## Things a new session should know

- **Branches.** Work was done on `claude/sharp-rubin-wughko` and mirrored to
  `main`; they are identical. `main` is the default branch.
- **The line is in memory.** A server restart empties it. Everything else
  (players, messages, receipts, chat, quest log) is in SQLite. Schema changes
  are additive via `ensureColumn` in `src/server/db.ts`.
- **Throughput is bounded by the front player** (one person per tick, up to
  three ticks with extensions). Owner is aware and wants it that way for now.
- **Messages are never delivered to the very next person.** The next front is
  promoted before the message is inserted, so a message written now reaches a
  later front-of-liner. This matches doc rule 3.2.
- **Own messages are never delivered** (3.4), so a single player alone only
  ever sees seeds.
- **TIME_SCALE** divides every timer. Bots and the client read it from the
  view. Use it for playtesting only.
- **Testing.** `npm test` runs engine tests with a fake clock. `npm run bots`
  fills the line. Browser flows were verified with Playwright during
  development but those scripts are not in the repo.
- **Google Sheet caveat.** The `XP_FRONT_BONUS` row was added to the CSV
  after the sheet was uploaded. Add it to the Tuning tab before the next
  `content:pull`, or the pull will drop it (the code then falls back to 50).
- **Not built.** Hosting config (Dockerfile, Fly.io). Token rotation. Weekly
  board is keyed by ISO week start (`LEADERBOARD_RESET_DAY`) but has no
  archive of past weeks. Nothing from the parking lot.

## Log

- 2026-09-13: v1 built and pushed. Sheets created. Let-through removed.
- 2026-09-14: draft clearing fix; timeout returns to landing; bots script;
  XP bar, stats strip, front bonus; automatic stat raise on level-up;
  prompt shown with received messages; this file and `CLAUDE.md` added.
