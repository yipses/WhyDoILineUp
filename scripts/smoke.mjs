#!/usr/bin/env node
/**
 * Multiplayer smoke test. Spawns N bot players against a running server,
 * has them join, chat, answer quests, reach the front, leave messages and
 * pick emojis. Run the server with TIME_SCALE=20 (or so) first:
 *
 *   TIME_SCALE=20 SECURE_COOKIES=0 PORT=3000 npm start
 *   BOTS=5 npm run smoke
 */
import WebSocket from "ws";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const BOTS = Number(process.env.BOTS ?? 4);
const DURATION_MS = Number(process.env.DURATION_MS ?? 45000);

const NAMES = ["Mara", "Jun", "Priya", "Dev", "Oli", "Sam", "Kit", "Ana", "Bo", "Lou"];

async function getCookie() {
  const res = await fetch(BASE + "/", { redirect: "manual" });
  const set = res.headers.get("set-cookie");
  if (!set) throw new Error("no cookie from /");
  return set.split(";")[0];
}

const summary = { joined: 0, quests: 0, questsAnswered: 0, fronts: 0, submitted: 0, emojis: 0, finished: 0, errors: [], chat: 0, toasts: 0 };

async function bot(i) {
  const cookie = await getCookie();
  const ws = new WebSocket(WS, { headers: { cookie } });
  const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? i : "");
  let view = null;
  let answered = new Set();
  let submitted = false;
  const send = (o) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));

  ws.on("open", () => {
    send({ type: "join", name });
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === "view") {
      view = msg.view;
      const me = view.me;
      if (me.phase === "inline" && me.name === name && !summary[`joined_${i}`]) {
        summary[`joined_${i}`] = true;
        summary.joined++;
        send({ type: "chat", text: `hi from ${name}` });
      }
      if (me.quest && !answered.has(me.quest.instanceId)) {
        answered.add(me.quest.instanceId);
        summary.quests++;
        setTimeout(() => {
          send({ type: "quest", instanceId: me.quest.instanceId, option: Math.random() < 0.5 ? "a" : "b" });
          summary.questsAnswered++;
        }, 200);
      }
      if (me.questResult) setTimeout(() => send({ type: "quest_dismiss" }), 100);
      if (me.pendingPoints > 0) send({ type: "levelup", stat: ["CHARM", "INTELLIGENCE", "STRENGTH"][i % 3] });
      if (me.phase === "front" && !submitted) {
        submitted = true;
        summary.fronts++;
        // First bot uses an extension, then submits. Everyone lingers so the
        // people behind accrue enough wait for the quest scheduler to fire.
        if (i === 0) send({ type: "more_time" });
        setTimeout(() => {
          send({ type: "submit", text: `${name} was here. It was fine. Bring a snack.` });
          summary.submitted++;
        }, Number(process.env.FRONT_LINGER_MS ?? 2000));
      }
      if (me.phase === "exiting") {
        setTimeout(() => {
          send({ type: "emoji", emoji: me.exiting.emojis[i % me.exiting.emojis.length].emoji });
          summary.emojis++;
        }, 200);
      }
    } else if (msg.type === "finished") {
      summary.finished++;
      summary.lastReceipt = msg.receipt.text;
      // Rejoin at the back to keep the line moving.
      submitted = false;
      setTimeout(() => send({ type: "join", name }), 300);
    } else if (msg.type === "error") {
      summary.errors.push(`${name}: ${msg.text}`);
    } else if (msg.type === "chat") {
      summary.chat++;
    } else if (msg.type === "toast") {
      summary.toasts++;
    }
  });
  ws.on("error", (e) => summary.errors.push(`${name}: ws ${e.message}`));
  return ws;
}

const sockets = [];
for (let i = 0; i < BOTS; i++) sockets.push(await bot(i));
await new Promise((r) => setTimeout(r, DURATION_MS));
for (const ws of sockets) ws.close();

// Ask one more client for the leaderboard and receipts.
{
  const cookie = await getCookie();
  const ws = new WebSocket(WS, { headers: { cookie } });
  await new Promise((resolve) => {
    ws.on("open", () => send2(ws, { type: "leaderboard" }));
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "leaderboard") {
        summary.leaderboardAll = msg.all.length;
        summary.leaderboardWeekly = msg.weekly.length;
        ws.close();
        resolve();
      }
    });
  });
}
function send2(ws, o) {
  ws.send(JSON.stringify(o));
}

console.log(JSON.stringify(summary, null, 2));
const ok = summary.joined === BOTS && summary.fronts >= 1 && summary.submitted >= 1 && summary.finished >= 1 && summary.quests >= 1;
console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
