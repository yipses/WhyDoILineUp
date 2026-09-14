#!/usr/bin/env node
/**
 * Bots that line up. For playtesting with a full line.
 *
 * Start the server, then in another terminal:
 *   npm run bots                 # 8 bots against http://localhost:3000
 *   BOTS=20 npm run bots         # more of them
 *   BASE_URL=https://example.com npm run bots
 *
 * Options (env vars):
 *   BOTS            how many                                   (default 8)
 *   BASE_URL        server                                     (default http://127.0.0.1:3000)
 *   REJOIN          rejoin the back after reaching the front   (default 1; 0 = leave for good)
 *   FRONT_FRACTION  share of the front timer a bot uses before sending, as "min,max" (default 0.2,0.7)
 *   CHAT_EVERY      seconds between chat lines per bot, "min,max" (default 40,120; 0,0 = never)
 *   STAGGER_MS      gap between bot joins                      (default 1500)
 *   LEAVE_CHANCE    chance per minute that a bot wanders off and comes back (default 0.05)
 *
 * Bots read the server's TIME_SCALE from the view, so their timing follows it.
 * Ctrl+C disconnects them all; the server drops them after the grace period.
 */
import WebSocket from "ws";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
const BOTS = Number(process.env.BOTS ?? 8);
const REJOIN = (process.env.REJOIN ?? "1") !== "0";
const STAGGER_MS = Number(process.env.STAGGER_MS ?? 1500);
const LEAVE_CHANCE = Number(process.env.LEAVE_CHANCE ?? 0.05);
const [FRONT_MIN, FRONT_MAX] = (process.env.FRONT_FRACTION ?? "0.2,0.7").split(",").map(Number);
const [CHAT_MIN, CHAT_MAX] = (process.env.CHAT_EVERY ?? "40,120").split(",").map(Number);

const NAMES = [
  "Mara", "Jun", "Priya", "Dev", "Oli", "Sam", "Kit", "Ana", "Bo", "Lou", "Theo", "Nia", "Ravi", "Elle", "Moss",
  "Ida", "Cass", "Rui", "Wren", "Tam", "Zed", "Faye", "Otto", "Juno", "Beck", "Hal", "Noor", "Pip", "Gus", "Vee",
];

const MESSAGES = [
  "The person in front of me hummed the whole time. Not badly.",
  "I brought a snack. I ate the snack. I regret nothing.",
  "It's colder than it looks out here. Or warmer. Depends when you read this.",
  "Somebody dropped a glove near the post. It's still there if it's yours.",
  "I counted the bricks on the wall opposite. Lost count. Started again. Good bricks.",
  "You're closer than you think. That's not a metaphor, the line just moves weird.",
  "Whoever you are: I hope your shoes are better than mine.",
  "I told three people I'd be five minutes. That was a while ago.",
  "Nothing happened while I waited and honestly it was lovely.",
  "The awning drips on the left. Stand right.",
  "Say hi to the person behind you. They've been quiet.",
  "I had a whole speech planned. It's gone. Good luck.",
  "A pigeon looked at me for a solid minute. Keep an eye out.",
  "My phone died at some point and I didn't notice for ages.",
  "There's a bakery two streets over. Don't go. But it's there.",
  "This is the longest I've stood still in years.",
];

const CHAT = [
  "hi", "anyone know how long this usually takes", "the vendor is selling a single sock today", "lol", "nice day for it",
  "is the line moving or is it me", "my feet hurt", "who's at the front", "brb no im not", "this is fine",
  "the auditor asked me for ID", "someone behind me is explaining football to nobody", "good luck up there",
  "i think the streamer just got a viewer", "hello from the back", "ok", "same", "long day", "is it raining", "it moved!",
];

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { joined: 0, quests: 0, fronts: 0, messages: 0, emojis: 0, finished: 0, chats: 0, errors: 0, leaves: 0 };

async function getCookie() {
  const res = await fetch(BASE + "/", { redirect: "manual" });
  const set = res.headers.get("set-cookie");
  if (!set) throw new Error(`no identity cookie from ${BASE}/ (is the server running?)`);
  return set.split(";")[0];
}

class Bot {
  constructor(i) {
    this.i = i;
    this.name = NAMES[i % NAMES.length] + (i >= NAMES.length ? String(Math.floor(i / NAMES.length) + 1) : "");
    this.stat = ["CHARM", "INTELLIGENCE", "STRENGTH"][i % 3];
    this.view = null;
    this.answered = new Set();
    this.frontHandled = false;
    this.exitHandled = false;
    this.timers = new Set();
    this.stopped = false;
  }

  log(msg) {
    console.log(`${new Date().toISOString().slice(11, 19)} ${this.name.padEnd(8)} ${msg}`);
  }

  later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(t);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  async start() {
    this.cookie = await getCookie();
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(WS_URL, { headers: { cookie: this.cookie } });
    this.ws.on("open", () => this.send({ type: "join", name: this.name }));
    this.ws.on("message", (raw) => this.onMessage(JSON.parse(String(raw))));
    this.ws.on("close", () => {
      if (!this.stopped) this.later(3000, () => this.connect());
    });
    this.ws.on("error", (e) => {
      stats.errors++;
      this.log(`ws error: ${e.message}`);
    });
  }

  scale() {
    return (this.view && this.view.tuning && this.view.tuning.timeScale) || 1;
  }

  onMessage(msg) {
    if (msg.type === "notice") this.log(msg.text);
    if (msg.type === "view") this.onView(msg.view);
    else if (msg.type === "finished") this.onFinished(msg);
    else if (msg.type === "error") {
      stats.errors++;
      this.log(`server says: ${msg.text}`);
    }
  }

  onView(view) {
    const prevPhase = this.view ? this.view.me.phase : null;
    this.view = view;
    const me = view.me;

    if (me.phase === "inline" && prevPhase !== "inline") {
      stats.joined++;
      this.log(`joined at #${me.position} of ${view.line.count}`);
      this.scheduleChat();
      this.scheduleWander();
    }

    if (me.quest && !this.answered.has(me.quest.instanceId)) {
      this.answered.add(me.quest.instanceId);
      const q = me.quest;
      this.later(rand(2000, 8000) / this.scale(), () => {
        // Prefer the option keyed to our build; otherwise the better odds.
        const order = ["Long shot", "Risky", "Even", "Likely", "Sure thing"];
        let option = q.a.stat === this.stat ? "a" : q.b.stat === this.stat ? "b" : order.indexOf(q.a.band) >= order.indexOf(q.b.band) ? "a" : "b";
        if (Math.random() < 0.1) option = "ignore";
        stats.quests++;
        this.log(`quest from ${q.npcName}: ${option === "ignore" ? "ignored" : `[${(option === "a" ? q.a : q.b).stat}] ${(option === "a" ? q.a : q.b).label} (${(option === "a" ? q.a : q.b).band})`}`);
        this.send({ type: "quest", instanceId: q.instanceId, option });
      });
    }
    if (me.questResult) this.later(1500, () => this.send({ type: "quest_dismiss" }));

    if (me.phase === "front" && !this.frontHandled) {
      this.frontHandled = true;
      stats.fronts++;
      const tickMs = (view.tuning.lineTickSeconds * 1000) / this.scale();
      const wait = tickMs * rand(FRONT_MIN, FRONT_MAX);
      this.log(`at the front. got: "${me.front.messageText ?? "(nothing)"}". sending in ${Math.round(wait / 1000)}s`);
      if (Math.random() < 0.15) this.later(wait * 0.5, () => this.send({ type: "more_time" }));
      this.later(wait, () => {
        stats.messages++;
        this.send({ type: "submit", text: pick(MESSAGES) });
      });
    }
    if (me.phase !== "front") this.frontHandled = false;

    if (me.phase === "exiting" && !this.exitHandled) {
      this.exitHandled = true;
      this.later(rand(500, 4000) / this.scale(), () => {
        stats.emojis++;
        this.send({ type: "emoji", emoji: pick(me.exiting.emojis).emoji });
      });
    }
    if (me.phase !== "exiting") this.exitHandled = false;
  }

  onFinished(msg) {
    stats.finished++;
    this.log(`through the door. waited ${msg.receipt.waitedSeconds}s, ${msg.receipt.behind} behind`);
    this.clearTimers();
    if (REJOIN) {
      const delay = rand(3000, 15000) / this.scale();
      this.later(delay, () => this.send({ type: "join", name: this.name }));
    }
  }

  scheduleChat() {
    if (CHAT_MAX <= 0) return;
    this.later((rand(CHAT_MIN, CHAT_MAX) * 1000) / this.scale(), () => {
      if (this.view && this.view.me.phase === "inline") {
        stats.chats++;
        this.send({ type: "chat", text: pick(CHAT) });
      }
      this.scheduleChat();
    });
  }

  scheduleWander() {
    if (LEAVE_CHANCE <= 0) return;
    this.later(60000 / this.scale(), () => {
      if (this.view && this.view.me.phase === "inline" && Math.random() < LEAVE_CHANCE) {
        stats.leaves++;
        this.log("wandered off (closing the tab)");
        this.clearTimers();
        this.ws.close(); // no heartbeat -> loses the spot after the grace period, then reconnects and rejoins
        return;
      }
      this.scheduleWander();
    });
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) this.ws.close();
  }
}

const bots = [];
console.log(`starting ${BOTS} bots against ${BASE} (rejoin=${REJOIN ? "yes" : "no"})`);
for (let i = 0; i < BOTS; i++) {
  const b = new Bot(i);
  bots.push(b);
  try {
    await b.start();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  await sleep(STAGGER_MS);
}

const report = setInterval(() => {
  const inLine = bots.filter((b) => b.view && (b.view.me.phase === "inline" || b.view.me.phase === "front")).length;
  const count = bots.find((b) => b.view)?.view.line.count ?? "?";
  console.log(`--- ${inLine}/${BOTS} bots in line · line length ${count} · ${JSON.stringify(stats)}`);
}, 30000);

function shutdown() {
  clearInterval(report);
  console.log("\nstopping bots...");
  for (const b of bots) b.stop();
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
