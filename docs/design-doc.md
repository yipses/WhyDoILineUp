# The Line, Design Document

Working title. Version 0.1, September 2026.

Format: rulebook. Locked decisions are stated as rules. Open questions and parked ideas are listed at the end of each section. Tuning values live in the tuning sheet and are referenced by field name; numbers in this doc are placeholders unless marked LOCKED.

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
2. On joining they receive a random pixel avatar. A randomize button rerolls it. Free, unlimited.
3. The line advances when either: (a) the person at the front submits their message, or (b) `LINE_TICK_SECONDS` elapses (placeholder: 60), whichever comes first. Front-of-line extensions (rule 10) pause the tick.
4. At the front, the player reads one message left by a previous front-of-liner, then writes one for a future front-of-liner.
5. After writing, the player picks one emoji. Their avatar exits through the door and the emoji appears above it as it leaves. Everyone in line sees this.
6. A share image is generated (see Section 8) and saved to the player's identity. The player is shown it, then returned to the landing page. All previously generated share images remain available from the status window and can be shared at any time.
7. Leaving the site loses your spot. On tab close or navigation away, the player is removed from the line after `LEAVE_GRACE_SECONDS` (placeholder: 30) without a heartbeat. Progression (level, stats, XP) persists; position does not.
8. A player may rejoin at any time. A rejoin always places the player at the back of the line, regardless of how recently they left or where they were. Lost positions are never restored.

9. At the front, the player has `LINE_TICK_SECONDS` to submit their message. A visible countdown runs in the dialog box.
10. A "More time" button grants one additional `LINE_TICK_SECONDS`. It can be pressed at most `FRONT_EXTENSIONS_MAX` times (LOCKED: 2), for a maximum of three intervals at the front. While an extension is active, the line does not advance on the tick.
11. If the timer expires with no message submitted, the player is removed from the line. No message is left. The share image is still generated, since it is created on reaching the front (Section 8), and the player may rejoin at the back per rule 8.

---

## 3. The message system

**Rules**
1. Messages are text only, max `MESSAGE_MAX_CHARS` (placeholder: 140).
2. Every message is moderated before it enters the pool. Nothing is delivered live; a message written now is eligible for a later front-of-liner only after it passes.
3. The message a player receives is drawn at random from the approved pool, weighted toward messages that have been delivered fewer times (`MESSAGE_DELIVERY_WEIGHT`).
4. A player never receives their own message.
5. A rotating light prompt is shown above the text box (e.g. "Tell the next person one thing you're looking forward to"). Prompts are optional to follow. Prompt list lives in the content sheet.
6. The pool is seeded with `SEED_MESSAGE_COUNT` (placeholder: 50) hand-written messages, flagged as seeds. Seeds stop being drawn once the approved pool exceeds `SEED_RETIRE_THRESHOLD` (placeholder: 200).
7. The existence of the message is never shown outside the front of the line: not on the landing page, not in the share image, not in NPC dialogue.

8. Moderation is two-stage. An AI classifier scores every message. Clear passes enter the pool; clear failures are discarded. Borderline results go to a human review queue.
9. A moderation tool is built for the human queue: view pending messages, approve, reject, and see classifier score and reasoning. Messages in the queue are not eligible for delivery until approved.

10. A player can report the message they received. When a message reaches `MESSAGE_REPORT_THRESHOLD` (placeholder: 3) reports, it is pulled from the pool and placed in the human review queue. Approved messages return to the pool with their report count reset; rejected messages are discarded. One report per player per message.

**Open questions**
- Classifier thresholds for pass, fail, and borderline live in the tuning sheet (`MOD_PASS_THRESHOLD`, `MOD_FAIL_THRESHOLD`); initial values to be set once the classifier is chosen.

---

## 4. Progression

Waiting earns XP. XP earns levels. Levels earn stats. Stats make quests interesting.

**Rules**
1. XP accrues per minute in line at `XP_IDLE_PER_MINUTE`. Idling is allowed. This rate is tuned low.
2. Quests award XP per Section 5. This is the main XP source.
3. Letting someone go first (Section 6) awards `XP_LET_THROUGH`, subject to `LET_THROUGH_COOLDOWN_SECONDS`.
4. Level thresholds follow the `XP_CURVE` table. Levels are never lost.
5. On each level-up, the player chooses one of three stats to increase by 1: CHARM, INTELLIGENCE, STRENGTH. This is the only way stats change.
6. All players start at level 1 with all stats at `STAT_BASE` (placeholder: 1).
7. Level gates quest tiers (Section 5, rule 8). Nothing else is level-gated in v1.
8. Progression persists across visits via an anonymous identity (Section 10). Losing your spot in line never affects progression.
9. The level cap is the last row of the `XP_CURVE` table. At cap, the status screen displays "LVL: MAX". XP continues to accrue for leaderboard and lifetime totals but no further level-ups or stat points are granted.

**Player-facing display**
- The whole interface is framed as an SNES-era JRPG. Status, quests, chat, leaderboards, share images, and level-up all live in the same family of pop-up windows and menus a player would recognise from that era: bordered boxes, cursor-driven menus, blinking prompt arrows. A JRPG-style status screen (avatar, name, level, three stat bars, current title) is the home view of this menu system.
- Titles are cosmetic and derived from the dominant stat (e.g. CHARM-dominant: "Local Sweetheart"). Title list lives in the content sheet. Ties resolve to the most recently raised stat.
- Each title comes with a visible accessory on the avatar, either a head item or a hand-held item, specific to the dominant stat (e.g. sunglasses or a distinctive haircut for CHARM builds, a clipboard for INTELLIGENCE, a folding chair carried under one arm for STRENGTH). Accessories are how other people in line can read your build at a glance. The title accessory occupies its own sprite layer and is not affected by the randomize button. Accessory list lives in the content sheet alongside titles.
- Title accessories may change as the player crosses `TITLE_TIER_LEVELS` within the same stat, so a level 20 CHARM build looks different from a level 5 one.

**Open questions**
- Level-up choice: forced modal on the spot, or a persistent "you have a stat point" prompt the player can resolve later? (Recommendation: persistent prompt, so waiting is never interrupted.)

**Parking lot**
- Coins as a secondary currency: stakes or gated options in quests, and potentially an item store (cosmetics, accessory variants). Removed from v1 to keep the system clean.
- Prestige: at level cap, the option to reset to level 1 with a prestige rank. Each prestige rank unlocks something new (accessory variants, NPC lines, quest tiers).

---

## 5. Quests

NPCs approach the player privately with a two-option decision. Each option is a stat check with a roll.

**Rules**
1. Quests arrive while the player is in line, at a cadence of one per `QUEST_INTERVAL_MINUTES` (placeholder: 4), with jitter. A player never has more than one quest pending.
2. A quest is delivered as a dialog box addressed to the player. It is not visible in global chat.
3. Every quest presents exactly two options. Each option is keyed to a stat. The two options always use different stats.
4. Each option has a difficulty value from the quest's tier band.
5. Resolution is always a roll. Probability of success is a function of (player stat, option difficulty), defined in `ROLL_FORMULA`, clamped to `ROLL_FLOOR` (placeholder: 5%) and `ROLL_CEILING` (placeholder: 95%). No outcome is ever certain.
6. Player-facing odds are qualitative only. Five bands, mapped from probability in the tuning sheet: Long shot, Risky, Even, Likely, Sure thing. Percentages are never shown.
7. XP payout is set per quest by its tier (`QUEST_XP_BY_TIER`) and is the same whichever option the player chooses. Option difficulty affects only the odds of success, never the reward. The player's choice is therefore purely about which check suits their build. Failed checks pay `QUEST_XP_FAIL` (placeholder: a small consolation, never zero).
8. Quests belong to tiers. Tier N unlocks at level `TIER_UNLOCK_LEVEL[N]`. Higher tiers have higher difficulty bands and higher payouts. Once unlocked, quests are drawn from all unlocked tiers with weight toward the highest.
9. Every option has two outcome texts: success and failure. Both must be specific and funny. Failure is content, not punishment.
10. A quest that goes unanswered for `QUEST_TIMEOUT_SECONDS` (placeholder: 180) expires silently. No penalty.
11. Quests may reference the front of the line or the door, and may speculate about them in character, but must never state or imply what actually happens there. The message is never mentioned.

12. Every quest is authored for a specific NPC and themed to that NPC's character. NPCs are recurring, so players can learn what a given NPC tends to ask and which stats their quests lean on. Quest assignment lives in the content sheet (`npc_id` on each quest).

**Content structure (one quest)**
- id, tier, npc_id
- setup text (2 to 3 lines, NPC voice)
- option A: label, stat, difficulty, success text, failure text
- option B: label, stat, difficulty, success text, failure text

**NPC archetypes for v1** (content sheet holds the full roster)
- The Regular: has been here since a product launch nobody remembers
- The Streamer: broadcasting the line to zero viewers
- The Placeholder: holding a spot for a friend who is obviously not coming
- The Vendor: sells one item, changes daily, never has change
- The Auditor: convinced they are in the wrong line, needs help proving it

**Open questions**
- Can a player decline a quest outright, or only let it expire?

---

## 6. Letting someone go first

**Rules**
1. Any player not at the front may press "Let them through" to swap positions with the player directly behind them.
2. The gesture is free, instant, and requires no acceptance from the other player.
3. Both avatars animate: the giver steps aside and bows; the receiver does a thank-you emote as they pass.
4. The giver receives `XP_LET_THROUGH`. The receiver receives nothing beyond the position.
5. Cooldown: `LET_THROUGH_COOLDOWN_SECONDS` (placeholder: 20) per player, so the animation always completes and the line does not churn.
6. Consecutive let-throughs form a streak. Streaks unlock nothing and cost nothing when broken; they exist only for NPC announcements (Section 7) and the leaderboard.

**Open questions**
- Should the player at the very front be able to let people through indefinitely? (Recommendation: yes. Someone farming XP by being endlessly polite is doing the thing the site is about.)

---

## 7. Chat and NPCs

**Rules**
1. One global chat room, visible to everyone in line. Humans and NPCs post in the same room.
2. NPCs are openly NPCs. They never claim to be human and are visually distinct (Section 9).
3. NPC voice is earnest. NPCs never wink at the premise, never explain the line, never break character.
4. NPCs have three jobs: (a) deliver quests privately, (b) post ambient lines in global chat so the room never looks dead, (c) announce player achievements in global chat.
5. Announcements cover wins only, never failures. Eligible events: Long shot successes, level-ups at `ANNOUNCE_LEVEL_MILESTONES`, let-through streaks of `ANNOUNCE_STREAK_THRESHOLD` or more.
6. Announcements are rate-limited to one per `ANNOUNCE_MIN_INTERVAL_SECONDS` globally. Events that miss the window are dropped, not queued.
7. Announcements are written in the NPC's voice as a bystander impressed by something mundane.
8. Human chat messages pass through the same moderation as line messages, but in real time with a short delay rather than a review queue.
9. Chat history shown to a joining player is limited to the last `CHAT_HISTORY_LINES`.

**Open questions**
- NPC chat generation: live model calls with a persona prompt, or a large pre-written pool with light templating? This is the single largest cost and moderation variable in the project.
- Can players mute chat?

---

## 8. Growth and sharing

**Rules**
1. On reaching the front, a share image is generated and captioned "I did this and all I got was this lousy image."
2. The image contains exactly three things: total wait time, a screenshot of the line at the moment the player reached the front, and the number of people lined up behind them. Nothing else. No level, no hint of the message.
3. Share images are saved to the player's identity (Section 10). A player can view and share any of their previous images at any time.
4. The landing page shows the live line and a live headcount. No explanation, no feature list, no screenshot of the front.
5. The empty-state landing copy when nobody is in line: "You're first in line. Someone has to be."

6. Sharing is done from within the site via three options: X (Twitter), message, and email. Each share includes the image and the site link, so the link does not need to appear on the image itself.
7. The share flow uses the platform share sheet where available (mobile) and pre-filled links where not.

**Open questions**
- Does the chosen exit emoji appear on the image, or only in the world?
- Storage: cap on saved images per identity, or unlimited?

---

## 9. Art direction

Full art bible is a separate document. Locked calls:

**Rules**
1. Reference era: SNES-era JRPG town scenes. Not NES. Enough pixels for readable faces.
2. Fixed internal canvas (placeholder 480x270), scaled with nearest-neighbour. Pixels are always crisp.
3. One restricted palette for the whole game (placeholder: 32 colours). Avatars draw from a defined subset.
4. Avatars: layered sprites (skin, hair, top, bottom, accessory), two-frame idle, plus a separate title-accessory layer driven by progression (Section 4). Randomize rerolls the first five layers only. Present-day clothing only.
5. NPCs use the same sprite system but with a visible marker (e.g. a nameplate style or outline colour) so they are never mistaken for players.
6. Backdrop: one long side-scrolling present-day street. The front of the line is a plain door with an awning and no sign.
7. Motion is stiff by design: low frame rate idles, one-slot hop when the line advances. No smooth tweening.
8. Text: a single pixel font. Quests and messages appear in JRPG dialog boxes with a blinking cursor.
9. Every UI surface (status screen, quests, chat, leaderboards, share image gallery, level-up) uses the same SNES-era JRPG menu language. No modern web UI elements appear anywhere in the game view. Detailed in the art bible.

---

## 10. Leaderboards and identity

**Rules**
1. Two leaderboards: Weekly (resets `LEADERBOARD_RESET_DAY`) and All-time.
2. All-time ranks by level, with total minutes waited as the tiebreaker. Level cap players are ordered among themselves by minutes waited.
3. Weekly ranks by XP earned during the week, with minutes waited that week as the tiebreaker. Level is displayed alongside. (Level itself does not reset weekly, so ranking the weekly board by level would freeze it around the highest-level players; XP earned this week is the weekly equivalent of "how much did you level".)
4. Identity is anonymous and persistent. See Section 11 for how it is implemented. The identity record holds name, avatar, level, stats, XP, lifetime minutes, and all generated share images.
5. Display names are not unique. Leaderboard rows show name plus avatar to disambiguate.
6. Display names pass moderation.

7. Both boards show the top `LEADERBOARD_SIZE` (placeholder: 100). No minimum activity threshold; the cutoff is the size itself. The player's own row and rank are always shown at the bottom if they fall outside the list.

**Parking lot**
- Optional sign-in to claim an anonymous identity and recover progression after a cleared cache. Not in v1.

---

## 11. Infrastructure

Identity and state handling. Follows the standard session-token pattern recommended by OWASP and MDN; the only difference from a normal logged-in site is that the session is not tied to an email or password in v1.

**Rules**
1. All progression state (level, stats, XP, lifetime minutes, line position) is server-authoritative. The client never computes or stores a progression value; it only displays what the server sends. Progression changes only in response to events the server itself observed (ticks it ran, quests it resolved, let-throughs it processed).
2. Each player has two identifiers:
   - A **secret token**: minted by the server using a cryptographically secure random generator, at least 128 bits of entropy (OWASP minimum is 64). Never sequential, never timestamp-based, never derived from the display name. The client never chooses its own.
   - A **public ID**: a separate identifier with no mathematical relationship to the secret. Used for everything other players can see.
3. The secret token is stored in a cookie with the `HttpOnly`, `Secure`, and `SameSite` attributes. It is never stored in localStorage, never placed in a URL or query string, never included in a share image or link, never written to logs, and never included in any realtime channel payload.
4. The secret token travels only between the player's browser and the server. Line state, chat, leaderboards, announcements, and quest events all carry public IDs only.
5. Server functions authenticate by secret token, then emit only the public ID.
6. The cookie is long-lived (placeholder: 1 year). This is a deliberate departure from OWASP's default of session-length cookies, chosen because the worst outcome of a lost cookie is a lost level, and forcing re-identification every visit would break the site.
7. One identity may hold at most one position in the line at a time. A second join from the same identity replaces the first.
8. Where the platform provides anonymous sessions natively (e.g. Supabase Auth anonymous sign-in), use that rather than a custom implementation. It should support upgrading the anonymous identity to a full account later without losing state.

**Known limits**
- A token can still be taken from the player's own machine (malware, physical access). Accounts do not prevent this either.
- Clearing cookies loses the identity. Recovery requires the optional sign-in parked in Section 10.
- Determined players can create many identities to farm a leaderboard. Anonymous identity only raises the cost slightly; treat this as accepted for v1.

**Open questions**
- Token rotation: rotate the secret on each visit, or keep it fixed for the cookie lifetime?

---

## 12. Tuning sheet fields referenced

LINE_TICK_SECONDS, FRONT_EXTENSIONS_MAX, LEAVE_GRACE_SECONDS, MESSAGE_MAX_CHARS, MESSAGE_DELIVERY_WEIGHT, SEED_MESSAGE_COUNT, SEED_RETIRE_THRESHOLD, MOD_PASS_THRESHOLD, MOD_FAIL_THRESHOLD, MESSAGE_REPORT_THRESHOLD, XP_IDLE_PER_MINUTE, XP_LET_THROUGH, XP_CURVE, STAT_BASE, TITLE_TIER_LEVELS, QUEST_INTERVAL_MINUTES, ROLL_FORMULA, ROLL_FLOOR, ROLL_CEILING, QUEST_XP_BY_TIER, QUEST_XP_FAIL, TIER_UNLOCK_LEVEL, QUEST_TIMEOUT_SECONDS, LET_THROUGH_COOLDOWN_SECONDS, ANNOUNCE_LEVEL_MILESTONES, ANNOUNCE_STREAK_THRESHOLD, ANNOUNCE_MIN_INTERVAL_SECONDS, CHAT_HISTORY_LINES, LEADERBOARD_RESET_DAY, LEADERBOARD_SIZE

---

## 13. Parking lot

- Coins as a secondary currency (quest stakes, item store)
- Spatial (neighbour-only) chat
- Prestige system at level cap (see Section 4 parking lot)
- Optional sign-in for progression recovery (see Section 10 parking lot)
- Ambient street events (pigeon, passing vendor, weather)
- Seasonal backdrops
- Player-to-player emotes beyond let-through
