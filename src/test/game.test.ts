import assert from "node:assert/strict";
import { test } from "node:test";
import { loadContent } from "../server/content.js";
import { Db } from "../server/db.js";
import { Game, type ChatLine, type Listener, type ReceiptView } from "../server/game.js";
import { hashToken } from "../server/identity.js";
import { levelForXp, successProbability, oddsBand, weekKey, titleFor } from "../server/progression.js";
import { Tuning } from "../server/content.js";
import { renderReceipt } from "../server/receipts.js";

function setup(tuningOverrides: Record<string, string> = {}) {
  const content = loadContent();
  Object.assign(content.tuning, tuningOverrides);
  const db = new Db(":memory:");
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const game = new Game(db, content, clock.now);
  const events = {
    finished: [] as { playerId: number; receipt: ReceiptView; timedOut: boolean }[],
    chat: [] as ChatLine[],
    toasts: [] as string[],
    errors: [] as { playerId: number; text: string }[],
    notices: [] as { playerId: number; text: string }[],
    lineChanges: 0,
  };
  const listener: Listener = {
    onPlayer() {},
    onLine() {
      events.lineChanges++;
    },
    onChat(line) {
      events.chat.push(line);
    },
    onToast(text) {
      events.toasts.push(text);
    },
    onFinished(playerId, payload) {
      events.finished.push({ playerId, ...payload });
    },
    onError(playerId, text) {
      events.errors.push({ playerId, text });
    },
    onNotice(playerId, text) {
      events.notices.push({ playerId, text });
    },
  };
  game.setListener(listener);
  const mk = (n: number) => {
    const p = game.createPlayer(`pub${n}`, hashToken(`tok${n}`.padEnd(64, "0")));
    game.connect(p.id);
    return p.id;
  };
  return { content, db, game, clock, events, mk };
}

test("content loads and is internally consistent", () => {
  const c = loadContent();
  assert.ok(c.quests.length >= 40);
  assert.ok(c.seedMessages.length >= 50);
  assert.equal(c.npcs.length, 5);
  for (const q of c.quests) {
    const tier = c.questTiers.find((t) => t.tier === q.tier)!;
    assert.ok(tier, `tier for ${q.id}`);
    for (const o of [q.a, q.b]) {
      assert.ok(o.difficulty >= tier.difficultyMin && o.difficulty <= tier.difficultyMax, `${q.id} difficulty ${o.difficulty} outside tier band`);
      assert.ok(o.success.length > 20 && o.failure.length > 20, `${q.id} outcome text`);
    }
  }
});

test("progression maths", () => {
  const c = loadContent();
  const tuning = new Tuning(c.tuning);
  assert.equal(levelForXp(0, c.xpCurve), 1);
  assert.equal(levelForXp(c.xpCurve[1], c.xpCurve), 2);
  assert.equal(levelForXp(1e9, c.xpCurve), c.xpCurve.length);
  assert.equal(successProbability(1, 1, tuning), 0.5);
  assert.equal(successProbability(1, 20, tuning), tuning.num("ROLL_FLOOR", 0.05));
  assert.equal(successProbability(30, 1, tuning), tuning.num("ROLL_CEILING", 0.95));
  assert.equal(oddsBand(0.05, c.oddsBands), "Long shot");
  assert.equal(oddsBand(0.5, c.oddsBands), "Even");
  assert.equal(oddsBand(0.95, c.oddsBands), "Sure thing");
  // Monday reset, computed in UTC.
  assert.equal(weekKey(Date.UTC(2026, 8, 13, 12), "Monday"), "2026-09-07"); // Sunday 13 Sep -> Monday 7 Sep
  assert.equal(weekKey(Date.UTC(2026, 8, 14, 0), "Monday"), "2026-09-14");
  // Titles: level 1 with equal stats -> the NONE title; ties resolve to last raised.
  assert.equal(titleFor(1, { CHARM: 1, INTELLIGENCE: 1, STRENGTH: 1 }, "", c.titles).stat, "NONE");
  assert.equal(titleFor(3, { CHARM: 2, INTELLIGENCE: 2, STRENGTH: 1 }, "CHARM", c.titles).stat, "CHARM");
  assert.equal(titleFor(12, { CHARM: 1, INTELLIGENCE: 9, STRENGTH: 1 }, "INTELLIGENCE", c.titles).title, "Has a Spreadsheet");
});

test("receipt has exactly the three required facts", () => {
  const r = renderReceipt(3723, "[door] >Mara<  Jun  Dev", 2);
  assert.match(r, /I did this and all I got was this lousy image\./);
  assert.match(r, /WAITED {2}1h 02m 03s/);
  assert.match(r, /\[door\] >Mara< {2}Jun {2}Dev/);
  assert.match(r, /PEOPLE BEHIND YOU {2}2/);
  assert.doesNotMatch(r, /LVL|level|message/i);
});

test("join, front, submit, emoji, receipt", async () => {
  const { game, clock, events, db, mk, content } = setup();
  const a = mk(1);
  const b = mk(2);
  await game.join(a, "Mara");
  await game.join(b, "Jun");
  let va = game.view(a);
  assert.equal(va.me.phase, "front");
  assert.equal(va.me.position, 1);
  assert.ok(va.me.front?.messageText, "front player gets a message");
  assert.equal(va.me.front!.bonusXp, 50, "front bonus reported to the client");
  assert.equal(va.me.xp, 50, "front bonus granted on arrival");
  assert.equal(va.me.level, 2, "50 xp is exactly level 2");
  assert.equal(va.me.xpLevelStart, content.xpCurve[1]);
  assert.equal(va.me.xpLevelEnd, content.xpCurve[2]);
  assert.equal(game.view(b).me.xp, 0, "no bonus for waiting behind");
  assert.equal(game.view(b).me.position, 2);
  assert.equal(db.receiptsFor(a).length, 1, "receipt generated on reaching the front");

  // Extensions: two allowed, third refused.
  const deadline0 = va.me.front!.deadline;
  game.moreTime(a);
  game.moreTime(a);
  game.moreTime(a);
  va = game.view(a);
  assert.equal(va.me.front!.extensionsLeft, 0);
  assert.equal(va.me.front!.deadline, deadline0 + 2 * 60_000);
  assert.ok(events.errors.some((e) => e.text.includes("No more time")));

  await game.submitMessage(a, "Bring a snack. Trust me.");
  va = game.view(a);
  assert.equal(va.me.phase, "exiting");
  assert.equal(game.view(b).me.phase, "front", "line advanced on submit");
  game.chooseEmoji(a, "🎉");
  assert.equal(game.view(a).me.phase, "landing");
  assert.equal(events.finished.length, 1);
  assert.equal(events.finished[0].timedOut, false);
  // Snapshot is taken the moment a reached the front, before b joined.
  assert.match(events.finished[0].receipt.text, /PEOPLE BEHIND YOU {2}0/);
  const bReceipt = db.receiptsFor(b)[0];
  assert.equal(bReceipt.behind, 0);
  assert.ok(events.toasts.some((t) => t.includes("Mara walks through the door") && t.includes("🎉")));

  // The message was moderated and approved by the heuristic classifier.
  await new Promise((r) => setTimeout(r, 10));
  const msgs = db.recentMessages(1);
  assert.equal(msgs[0].status, "approved");
  assert.equal(msgs[0].author_id, a);

  // A player never receives their own message: rejoin, become front, check.
  await game.submitMessage(b, "Jun was here.");
  game.chooseEmoji(b, "o/");
  await game.join(a, "Mara");
  clock.advance(1);
  game.tick(clock.now());
  const front = game.view(a).me.front!;
  assert.notEqual(front.messageText, "Bring a snack. Trust me.");
  // Player-written messages carry the prompt their author was shown; seeds do not.
  const jun = db.recentMessages(5).find((m) => m.text === "Jun was here.")!;
  assert.ok(jun.prompt.length > 0, "prompt stored with the message");
  if (front.messageText === "Jun was here.") assert.equal(front.messagePrompt, jun.prompt);
  else assert.equal(front.messagePrompt, null, "seeds have no prompt");
});

test("front timeout removes the player without a message", async () => {
  const { game, clock, events, db, mk } = setup();
  const a = mk(1);
  await game.join(a, "Mara");
  clock.advance(60_000 + 1);
  game.tick(clock.now());
  assert.equal(game.view(a).me.phase, "landing");
  assert.equal(events.finished.length, 1);
  assert.equal(events.finished[0].timedOut, true);
  assert.equal(db.recentMessages(5).filter((m) => !m.is_seed).length, 0);
});

test("leaving the site loses the spot after the grace period; rejoin goes to the back", async () => {
  const { game, clock, mk } = setup();
  const a = mk(1);
  const b = mk(2);
  const c = mk(3);
  await game.join(a, "Mara");
  await game.join(b, "Jun");
  await game.join(c, "Dev");
  game.disconnect(b);
  clock.advance(29_000);
  game.tick(clock.now());
  assert.equal(game.view(b).me.position, 2, "still in line during grace");
  clock.advance(2_000);
  game.tick(clock.now());
  assert.equal(game.view(b).me.phase, "landing");
  assert.equal(game.view(c).me.position, 2);
  game.connect(b);
  await game.join(b, "Jun");
  assert.equal(game.view(b).me.position, 3, "rejoin lands at the back");
});

test("idle xp, quests, level up, stat choice, titles", async () => {
  // A very long tick keeps a at the front so b stays second for the whole test.
  const { game, clock, events, db, mk, content } = setup({ LINE_TICK_SECONDS: "100000" });
  const a = mk(1);
  const b = mk(2);
  await game.join(a, "Mara");
  await game.join(b, "Jun"); // b is second, so b gets quests; a is at the front and never does.
  clock.advance(60_000);
  game.tick(clock.now());
  let vb = game.view(b);
  assert.equal(vb.me.xp, 2, "idle xp per minute");
  assert.ok(vb.me.quest, "first quest after QUEST_FIRST_DELAY_MINUTES");
  assert.equal(game.view(a).me.quest, null, "no quests at the front");
  const q = vb.me.quest!;
  assert.notEqual(q.a.stat, q.b.stat);
  assert.ok(["Long shot", "Risky", "Even", "Likely", "Sure thing"].includes(q.a.band));

  // Decline outright is allowed and costs nothing.
  game.chooseQuest(b, q.instanceId, "ignore");
  vb = game.view(b);
  assert.equal(vb.me.quest, null);
  assert.equal(vb.me.xp, 2);

  // Next quest arrives within interval + jitter; answer it.
  clock.advance(5 * 60_000 + 1);
  game.tick(clock.now());
  vb = game.view(b);
  assert.ok(vb.me.quest, "second quest");
  const xpBefore = vb.me.xp;
  game.chooseQuest(b, vb.me.quest!.instanceId, "a");
  vb = game.view(b);
  assert.ok(vb.me.questResult);
  assert.ok(vb.me.xp > xpBefore, "failed checks still pay something");
  assert.equal(db.recentQuestIds(b, 5).length, 1);

  // Quests expire silently.
  clock.advance(5 * 60_000 + 1);
  game.tick(clock.now());
  const q3 = game.view(b).me.quest!;
  assert.ok(q3);
  clock.advance(180_000 + 1);
  game.tick(clock.now());
  assert.equal(game.view(b).me.quest, null);

  // Level-ups raise the stat used most in quests since the last level-up.
  // b has answered one quest so far (option a of the second quest); seed the
  // log with two more CHARM answers so CHARM is the clear leader.
  const questStat = db.recentQuestIds(b, 1).length ? (db.sql.prepare("SELECT stat FROM quest_log WHERE player_id = ? ORDER BY id DESC LIMIT 1").get(b) as { stat: string }).stat : "";
  const lean = questStat === "CHARM" ? "INTELLIGENCE" : "CHARM";
  for (let i = 0; i < 3; i++) db.logQuest({ playerId: b, questId: "x", option: "a", stat: lean, success: true, probability: 0.5, xp: 1, now: clock.now() });
  assert.equal(vb.me.title, "Person in Line", "no dominant stat yet");
  const statsBefore = { ...vb.me.stats };
  db.updatePlayer(b, { xp: 0 });
  clock.advance(30 * 60_000);
  game.tick(clock.now());
  vb = game.view(b);
  assert.ok(vb.me.level >= 2, `level ${vb.me.level}`);
  assert.equal(vb.me.stats[lean as "CHARM" | "INTELLIGENCE"], statsBefore[lean as "CHARM" | "INTELLIGENCE"] + (vb.me.level - 1), "each level raised the most-used stat");
  assert.ok(events.notices.some((n) => n.playerId === b && n.text.includes(`${lean} +1`)));
  assert.notEqual(vb.me.title, "Person in Line");
  // With no quests since the last level-up, the raise is random but still happens.
  const total = () => vb.me.stats.CHARM + vb.me.stats.INTELLIGENCE + vb.me.stats.STRENGTH;
  const before = total();
  db.updatePlayer(b, { xp: content.xpCurve[vb.me.level] - 1 });
  clock.advance(60_000);
  game.tick(clock.now());
  vb = game.view(b);
  assert.equal(total(), before + 1, "tie still raises exactly one stat");
  assert.equal(game.view(a).me.phase, "front", "a stayed at the front the whole time");
  assert.equal(events.finished.length, 0);
});

test("chat is moderated, rate limited and NPCs fill silence", async () => {
  const { game, clock, events, mk } = setup();
  const a = mk(1);
  await game.join(a, "Mara");
  game.moreTime(a);
  game.moreTime(a); // stay at the front for 180s so the line is never empty
  await game.chat(a, "hello there");
  await game.chat(a, "too fast");
  assert.ok(events.errors.some((e) => e.text === "Slow down."));
  await new Promise((r) => setTimeout(r, 2100));
  assert.ok(events.chat.some((c) => c.kind === "human" && c.text === "hello there"));
  clock.advance(4_000);
  await game.chat(a, "visit http://example.com now");
  assert.ok(events.errors.some((e) => e.text === "That didn't go through."));
  clock.advance(4_000);
  await game.chat(a, "this is fucking great");
  assert.ok(events.errors.filter((e) => e.text === "That didn't go through.").length >= 2);
  // Ambient NPC line eventually.
  for (let i = 0; i < 150 && !events.chat.some((c) => c.kind === "npc"); i++) {
    clock.advance(1_000);
    game.tick(clock.now());
  }
  assert.ok(events.chat.some((c) => c.kind === "npc"));
});

test("reports pull a message into review at the threshold", async () => {
  const { game, db, mk } = setup();
  const ids = [mk(1), mk(2), mk(3), mk(4)];
  // Make exactly one non-seed approved message so every front draws it.
  db.sql.exec("UPDATE messages SET status = 'rejected' WHERE is_seed = 1");
  const mid = db.insertMessage({ text: "report me", authorId: null, status: "approved", isSeed: false, modScore: 1, modReason: "", now: 1 });
  for (const id of ids) await game.join(id, `P${id}`);
  for (let i = 0; i < 3; i++) {
    const front = ids[i];
    assert.equal(game.view(front).me.phase, "front");
    assert.equal(game.view(front).me.front!.messageText, "report me");
    game.report(front);
    game.report(front); // second report from the same player is ignored
    // A URL sends this to review, so "report me" stays the only approved message.
    await game.submitMessage(front, "fine, see http://example.com");
    game.chooseEmoji(front, "🙂");
  }
  assert.equal(db.getMessage(mid)!.status, "review");
  assert.equal(db.getMessage(mid)!.reports, 3);
});

test("leaderboards rank and show the player's own row", async () => {
  const { game, db, mk } = setup();
  const a = mk(1);
  const b = mk(2);
  await game.join(a, "Mara");
  await game.join(b, "Jun");
  db.updatePlayer(a, { level: 5, lifetime_seconds: 100, week_key: weekKey(game["now"](), "Monday"), week_xp: 10 });
  db.updatePlayer(b, { level: 5, lifetime_seconds: 200, week_key: weekKey(game["now"](), "Monday"), week_xp: 20 });
  const lb = game.leaderboard(a);
  assert.equal(lb.all[0].name, "Jun", "minutes waited breaks the level tie");
  assert.equal(lb.weekly[0].name, "Jun");
  assert.ok(lb.all.some((r) => r.isYou));
});
