# THE LINE

People line up. The front of the line is never explained.

This is the v1 build of the design doc: multiplayer, real-time, text only. A Node
server owns the line, the message pool, quests, chat, NPCs, progression and the
leaderboards. A browser client renders all of it as monospace text with
keyboard-driven menus. No graphics anywhere.

## Run it

Requires Node 22.13 or newer (the database is Node's built-in SQLite).

```sh
npm install
npm run build
SECURE_COOKIES=0 npm start        # local dev over plain http
```

Open http://localhost:3000. Open it in a second browser (or a private window)
to be a second person in line.

### Environment

| Variable            | Default                | What it does |
| ------------------- | ---------------------- | ------------ |
| `PORT`              | `3000`                 | HTTP port. |
| `DB_PATH`           | `data/the-line.sqlite` | SQLite file. Created on first run. |
| `SECURE_COOKIES`    | `1`                    | Set to `0` when serving over plain http (local dev). |
| `TIME_SCALE`        | `1`                    | Divides every timed duration. `TIME_SCALE=20` makes the 60s tick take 3s. Playtesting only. |
| `MOD_PASSWORD`      | unset                  | Enables the human review tool at `/mod` (basic auth, user `mod`). |
| `ANTHROPIC_API_KEY` | unset                  | Turns on the AI moderation classifier. Without it a heuristic classifier runs. |
| `MOD_MODEL`         | `claude-opus-5`        | Model used by the AI classifier. |
| `SITE_URL`          | request origin         | Public URL placed in share text. |

### Bots

To playtest with a real line, start the server, then in a second terminal:

```sh
npm run bots              # 8 bots join, wait, chat, do quests, leave messages, rejoin
BOTS=20 npm run bots      # a longer line
REJOIN=0 npm run bots     # each bot leaves for good after its turn at the front
```

Bots follow the server's `TIME_SCALE`, so with `TIME_SCALE=20` on the server
the line cycles in seconds. Other knobs (`FRONT_FRACTION`, `CHAT_EVERY`,
`LEAVE_CHANCE`, `STAGGER_MS`, `BASE_URL`) are documented at the top of
`scripts/bots.mjs`. Ctrl+C removes them; the server drops them after the
grace period.

### Scripts

```sh
npm test            # engine tests with a fake clock (node --test)
npm run bots        # playtest bots (see above)
npm run smoke       # short automated bot run that asserts the loop works; use TIME_SCALE=20 on the server
npm run content:pull   # pull every tab of the Google Sheet into content/*.csv
npm run content:build  # regenerate content/*.csv from scripts/build_content.py (initial authoring only)
```

## Content and tuning

Everything the game says and every number it uses lives in `content/*.csv`, one
file per tab of the Google Sheet **The Line — Content & Tuning**. The `Quests`
tab is large, so it was uploaded as its own sheet, **The Line — Quests**. The
sheets are the source of truth. To take changes live:

1. Share both sheets as "Anyone with the link can view".
2. `npm run content:pull`. The sheet ids are read from `content/SHEET_ID` and
   `content/QUESTS_SHEET_ID` (or the `SHEET_ID` / `QUESTS_SHEET_ID` env vars).
   If you copy the Quests tab into the main sheet, delete `content/QUESTS_SHEET_ID`.
3. Restart the server.

Tabs: `Tuning`, `XP_Curve`, `Quest_Tiers`, `Odds_Bands`, `Titles`, `Avatar_Parts`,
`Emojis`, `NPCs`, `NPC_Lines`, `Announcements`, `Prompts`, `Seed_Messages`,
`Blocklist`, `Quests`. The README tab in the sheet explains each column.

The roll formula is `p = ROLL_BASE + (stat - difficulty) * ROLL_STEP`, clamped to
`ROLL_FLOOR..ROLL_CEILING`. Players only ever see the qualitative band from
`Odds_Bands`.

Stats grow on level-up automatically: each new level raises whichever stat the
player chose most often in quests since their previous level-up. Ties, including
"no quests answered", pick at random. There is no manual stat point.

## Layout

```
src/server/
  index.ts       boot
  config.ts      env + TIME_SCALE helpers
  content.ts     CSV loader + typed content
  db.ts          SQLite schema and queries
  identity.ts    secret token / public id / cookies (Section 11)
  moderation.ts  heuristic + optional Claude classifier, pass/fail/review
  progression.ts xp curve, titles, rolls, text avatars, weekly keys
  receipts.ts    the text receipt
  game.ts        the line, front-of-line flow, quests, chat, NPCs, boards
  server.ts      http + websocket transport, /mod
  mod.ts         human review queue page
src/test/        engine tests
public/          text client (index.html, app.js, style.css)
content/         CSV mirror of the Google Sheet
scripts/         content build/pull, smoke bots
```

## What v1 deliberately leaves out

Let-through (removed from the design), image generation and platform share
sheets (the receipt is text; sharing is copy / X intent link / mailto), account
sign-in, coins, prestige, and every parking-lot item. The AI classifier is
optional and off by default.
