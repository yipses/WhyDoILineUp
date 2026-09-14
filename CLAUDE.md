# THE LINE

Read first: `README.md` (how to run) and `docs/design-doc.md` (the spec,
kept in step with the build). When a rule changes, change the design doc
in the same commit. It describes the game as it is, not as it was.

## Commands

```sh
npm install && npm run build        # compile src/ -> dist/
SECURE_COOKIES=0 npm start          # server on :3000 (plain http locally)
npm test                            # engine tests, fake clock
npm run bots                        # playtest bots against a running server
TIME_SCALE=20 SECURE_COOKIES=0 npm start   # every timer 20x faster
```

## Ground rules from the design doc

- Never state or hint at what is at the front of the line. Not in copy,
  NPC lines, quests, or UI.
- NPCs are earnest and never break character.
- The message a player receives is never shown outside the front-of-line
  dialog.
- The receipt contains exactly three things: wait time, line snapshot,
  people behind. Nothing else.
- Text only. No images, no modern web UI elements in the game view.

## Where things are

- `src/server/game.ts` is the engine: line, front flow, quests, XP, chat,
  NPCs, boards. It knows nothing about sockets; `server.ts` is transport.
- `public/app.js` is the whole client. State in `S`, render functions per
  region, keyboard and click handlers at the bottom.
- `content/*.csv` mirrors the Google Sheets. Do not hand-edit long-term;
  change the sheet and run `npm run content:pull`. Adding a tuning key means
  adding it to the sheet, the CSV, `scripts/build_content.py`, and a default
  in code.
- Database schema changes must be additive; use `ensureColumn` in `db.ts`.

## Conventions

- Push to `main`. (The original work branch `claude/sharp-rubin-wughko`
  mirrors it; keeping both in sync is fine, `main` is what matters.)
- Verify server changes with `npm test` and, for anything the player sees,
  a quick browser run. Bots plus a browser window is the fastest way to see
  a full line.
- Commit messages: what changed and why, plain prose.
