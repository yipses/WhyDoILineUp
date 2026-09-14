/* THE LINE - text client. No frameworks, no graphics. */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const S = {
    ws: null,
    connected: false,
    reconnectDelay: 1000,
    clockOffset: 0, // serverTime - Date.now()
    view: null, // last full view from the server
    chat: [],
    toast: "",
    toastUntil: 0,
    peek: null, // line entry being looked at
    overlay: null, // { kind, data }
    finished: null, // { receipt, timedOut }
    menuIndex: 0,
    dialogIndex: 0,
    overlayIndex: 0,
    focus: "menu", // "menu" | "dialog" | "overlay"
    leaderboardTab: "weekly",
    leaderboard: null,
    receipts: null,
    siteUrl: "",
    errorText: "",
    errorUntil: 0,
    noticeText: "",
    noticeUntil: 0,
    draftMessage: "",
    lastLineSig: "",
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    header: $("header"),
    lineview: $("lineview"),
    peek: $("peek"),
    toast: $("toast"),
    chatlog: $("chatlog"),
    chatinput: $("chatinput"),
    chatfield: $("chatfield"),
    chatbox: $("chatbox"),
    menu: $("menu"),
    dialog: $("dialog"),
    overlay: $("overlay"),
    status: $("status"),
    left: $("left"),
  };

  const now = () => Date.now() + S.clockOffset;
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${m}m ${pad(sec)}s`;
  }
  function fmtCountdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      scheduleReconnect();
      return;
    }
    S.ws = ws;
    ws.onopen = () => {
      S.connected = true;
      S.reconnectDelay = 1000;
      setStatus("");
      send({ type: "ping" });
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      handle(msg);
    };
    ws.onclose = (ev) => {
      S.connected = false;
      if (ev.code === 1006 && !S.view) {
        // Probably no identity cookie yet; reload once to get one.
        if (!sessionStorage.getItem("tl_reloaded")) {
          sessionStorage.setItem("tl_reloaded", "1");
          location.reload();
          return;
        }
      }
      setStatus("connection lost. reconnecting...");
      scheduleReconnect();
    };
    ws.onerror = () => {};
  }
  function scheduleReconnect() {
    setTimeout(connect, S.reconnectDelay);
    S.reconnectDelay = Math.min(15000, S.reconnectDelay * 1.6);
  }
  function send(obj) {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(obj));
  }
  function setStatus(text) {
    el.status.textContent = text;
  }

  function handle(msg) {
    switch (msg.type) {
      case "pong":
        S.clockOffset = msg.serverTime - Date.now();
        break;
      case "view": {
        const prevPhase = S.view ? S.view.me.phase : null;
        S.clockOffset = msg.view.serverTime - Date.now();
        S.view = msg.view;
        S.chat = msg.view.chat || [];
        if (prevPhase !== S.view.me.phase) {
          S.dialogIndex = 0;
          S.menuIndex = 0;
          // A new turn at the front starts with an empty message box.
          if (S.view.me.phase === "front" || prevPhase === "front") S.draftMessage = "";
          if (S.view.me.phase === "front" || S.view.me.phase === "exiting") S.focus = "dialog";
          else if (S.focus === "dialog") S.focus = "menu";
        }
        if (S.view.me.quest && S.focus === "menu" && !S.overlay) S.focus = "dialog";
        renderAll();
        break;
      }
      case "line":
        if (S.view) {
          S.view.line = msg.line;
          if (msg.serverTime) S.clockOffset = msg.serverTime - Date.now();
          renderLine();
          renderHeader();
        }
        break;
      case "chat":
        S.chat.push(msg.line);
        if (S.chat.length > 200) S.chat.splice(0, S.chat.length - 200);
        renderChat();
        break;
      case "toast":
        S.toast = msg.text;
        S.toastUntil = Date.now() + 8000;
        renderToast();
        break;
      case "finished":
        if (msg.timedOut) {
          // Ran out of time at the door: no message, no share screen. Back to the street.
          S.finished = null;
          S.overlay = null;
          S.focus = "menu";
          S.errorText = "Time ran out at the door. No message left. You can rejoin at the back.";
          S.errorUntil = Date.now() + 10000;
          renderAll();
          break;
        }
        S.finished = { receipt: msg.receipt, timedOut: false };
        S.overlay = { kind: "finished" };
        S.overlayIndex = 0;
        S.focus = "overlay";
        renderAll();
        break;
      case "error":
        S.errorText = msg.text;
        S.errorUntil = Date.now() + 5000;
        renderDialog();
        renderMenu();
        break;
      case "notice":
        S.noticeText = msg.text;
        S.noticeUntil = Date.now() + 12000;
        renderMenu();
        break;
      case "leaderboard":
        S.leaderboard = msg;
        if (S.overlay && S.overlay.kind === "leaderboard") renderOverlay();
        break;
      case "receipts":
        S.receipts = msg.list;
        S.siteUrl = msg.siteUrl || "";
        if (S.overlay && S.overlay.kind === "receipts") renderOverlay();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderAll() {
    document.body.classList.toggle("landing", !!(S.view && S.view.me.phase === "landing"));
    renderHeader();
    renderLine();
    renderChat();
    renderMenu();
    renderDialog();
    renderOverlay();
    renderToast();
  }

  function renderHeader() {
    const v = S.view;
    if (!v) {
      el.header.innerHTML = `<span>THE LINE</span><span class="dim">connecting...</span>`;
      return;
    }
    const count = v.line.count;
    const parts = [`${count} in line`];
    if (v.me.phase === "inline" || v.me.phase === "front") {
      const scale = (v.tuning && v.tuning.timeScale) || 1;
      const waited = v.me.joinedAt ? ((now() - v.me.joinedAt) * scale) / 1000 : v.me.waitedSeconds;
      parts.push(v.me.phase === "front" ? "you're at the front" : `you're #${v.me.position}`);
      parts.push(`waited ${fmtDuration(waited)}`);
    }
    el.header.innerHTML = `<span>THE LINE</span><span class="dim">${esc(parts.join("  ·  "))}</span>`;
  }

  function renderLine() {
    const v = S.view;
    if (!v) {
      el.lineview.textContent = "";
      return;
    }
    const entries = v.line.entries;
    if (entries.length === 0) {
      el.lineview.innerHTML = `<span class="dim">[door]</span>\n\n<span>${esc(v.line.emptyCopy)}</span>`;
      return;
    }
    const WINDOW = 14;
    const youIdx = entries.findIndex((e) => e.isYou);
    let start = 0;
    if (youIdx >= WINDOW) start = Math.max(0, youIdx - Math.floor(WINDOW / 2));
    const shown = entries.slice(start, start + WINDOW);
    const bits = shown.map((e, i) => {
      const idx = start + i;
      const label = e.isYou ? `>${e.name}<` : e.name;
      const cls = e.isYou ? "you" : "name";
      return `<span class="clicky ${cls}" data-peek="${idx}">${esc(label)}</span>`;
    });
    const before = start > 0 ? `<span class="dim">(+${start})  </span>` : "";
    const after = entries.length > start + WINDOW ? `<span class="dim">  ... (+${entries.length - start - WINDOW})</span>` : "";
    el.lineview.innerHTML = `<span class="dim">[door]</span> ${before}${bits.join("  ")}${after}`;
    renderPeek();
  }

  function renderPeek() {
    const v = S.view;
    if (!v || S.peek === null) {
      el.peek.textContent = "";
      return;
    }
    const e = v.line.entries[S.peek];
    if (!e) {
      S.peek = null;
      el.peek.textContent = "";
      return;
    }
    el.peek.innerHTML = `<span class="k">${esc(e.name)}</span> · LVL ${e.level} · ${esc(e.title)} · ${esc(e.avatarText)}   <span class="clicky dim" data-action="unpeek">[x]</span>`;
  }

  function renderToast() {
    if (S.toast && Date.now() < S.toastUntil) el.toast.textContent = `* ${S.toast}`;
    else el.toast.textContent = "";
  }

  function renderChat() {
    const v = S.view;
    const inLine = v && (v.me.phase === "inline" || v.me.phase === "front");
    el.left.style.display = v && v.me.phase !== "landing" && v.me.phase !== "exiting" ? "" : "none";
    if (!inLine) return;
    if (v.me.muted) {
      el.chatlog.innerHTML = `<span class="dim">chat is muted.</span>`;
      el.chatinput.style.display = "none";
      return;
    }
    el.chatinput.style.display = "";
    const nearBottom = el.chatlog.scrollHeight - el.chatlog.scrollTop - el.chatlog.clientHeight < 40;
    el.chatlog.innerHTML = S.chat
      .map((l) => {
        if (l.kind === "npc") return `<span class="npc">${esc(l.name)}:</span> ${esc(l.text)}`;
        if (l.kind === "announce") return `<span class="announce">${esc(l.name)}: ${esc(l.text)}</span>`;
        if (l.kind === "system") return `<span class="system">${esc(l.text)}</span>`;
        const you = v && l.publicId === v.me.publicId;
        return `<span class="${you ? "you" : "name"}">${esc(l.name)}:</span> ${esc(l.text)}`;
      })
      .join("\n");
    if (nearBottom) el.chatlog.scrollTop = el.chatlog.scrollHeight;
  }

  // ---- menus -------------------------------------------------------------

  function menuItems() {
    const v = S.view;
    if (!v) return [];
    const items = [];
    if (v.me.phase === "landing") {
      items.push({ label: "JOIN THE LINE", action: "join" });
      items.push({ label: "STATUS", action: "status" });
      items.push({ label: "LEADERBOARD", action: "leaderboard" });
      items.push({ label: "RECEIPTS", action: "receipts" });
      items.push({ label: "RANDOMIZE LOOK", action: "reroll" });
    } else if (v.me.phase === "inline") {
      if (v.me.quest) items.push({ label: `QUEST from ${v.me.quest.npcName}`, action: "quest", hot: true });
      items.push({ label: "STATUS", action: "status" });
      items.push({ label: v.me.muted ? "UNMUTE CHAT" : "SAY SOMETHING", action: v.me.muted ? "unmute" : "say" });
      items.push({ label: "LEADERBOARD", action: "leaderboard" });
      items.push({ label: "RECEIPTS", action: "receipts" });
      items.push({ label: "RANDOMIZE LOOK", action: "reroll" });
      if (!v.me.muted) items.push({ label: "MUTE CHAT", action: "mute" });
      items.push({ label: "LEAVE THE LINE", action: "leave" });
    } else if (v.me.phase === "front") {
      items.push({ label: "STATUS", action: "status" });
      items.push({ label: "RECEIPTS", action: "receipts" });
      items.push({ label: "LEAVE THE LINE", action: "leave" });
    } else if (v.me.phase === "exiting") {
      items.push({ label: "STATUS", action: "status" });
    }
    return items;
  }

  /** "LVL 3 [#######.......] 120/250" with progress through the current level. */
  function xpBar(m, width) {
    const w = width || 16;
    if (m.xpLevelEnd === null) {
      return `<span class="k">LVL MAX</span> [${"#".repeat(w)}] ${m.xp} XP`;
    }
    const span = Math.max(1, m.xpLevelEnd - m.xpLevelStart);
    const into = Math.max(0, m.xp - m.xpLevelStart);
    const filled = Math.max(0, Math.min(w, Math.floor((into / span) * w)));
    return `<span class="k">LVL ${m.level}</span> [${"#".repeat(filled)}${".".repeat(w - filled)}] ${into}/${span} <span class="dim">to LVL ${m.level + 1}</span>`;
  }

  function renderMenuList(items, index, focused, prefix) {
    return items
      .map((it, i) => {
        const sel = i === index && focused;
        const cur = sel ? `<span class="cursor">&gt;</span>` : " ";
        const cls = ["menuitem", sel ? "selected" : "", it.disabled ? "disabled" : ""].join(" ");
        const hot = it.hot ? ` <span class="k">(!)</span>` : "";
        const num = i < 9 ? `<span class="dimmer">${i + 1}</span>` : " ";
        return `<span class="${cls}" data-${prefix}="${i}">${cur} ${num} ${esc(it.label)}${hot}</span>`;
      })
      .join("\n");
  }

  function renderMenu() {
    const items = menuItems();
    if (S.menuIndex >= items.length) S.menuIndex = Math.max(0, items.length - 1);
    let html = renderMenuList(items, S.menuIndex, S.focus === "menu", "menu");
    if (S.view) {
      const m = S.view.me;
      html += `\n\n<span class="dim">${esc(m.name || "(no name yet)")} · ${esc(m.title)}</span>`;
      html += `\n${xpBar(m)}`;
      html += `\n<span class="dim">CHA</span> ${m.stats.CHARM}  <span class="dim">INT</span> ${m.stats.INTELLIGENCE}  <span class="dim">STR</span> ${m.stats.STRENGTH}`;
    }
    if (S.noticeText && Date.now() < S.noticeUntil) html += `\n<span class="ok">${esc(S.noticeText)}</span>`;
    if (S.errorText && Date.now() < S.errorUntil) html += `\n<span class="danger">${esc(S.errorText)}</span>`;
    el.menu.innerHTML = html;
  }

  // ---- dialog (quest / front / exiting) -------------------------------------

  function dialogItems() {
    const v = S.view;
    if (!v) return [];
    if (v.me.phase === "front" && v.me.front) {
      const f = v.me.front;
      const items = [{ label: "SEND IT", action: "submit" }];
      items.push({ label: `MORE TIME (${f.extensionsLeft} left)`, action: "more_time", disabled: f.extensionsLeft <= 0 });
      if (f.canReport) items.push({ label: f.reported ? "REPORTED" : "REPORT THAT MESSAGE", action: "report", disabled: f.reported });
      return items;
    }
    if (v.me.phase === "exiting" && v.me.exiting) {
      return v.me.exiting.emojis.map((e) => ({ label: `${e.emoji}  ${e.ascii}  ${e.label}`, action: "emoji", emoji: e.emoji }));
    }
    if (v.me.phase === "inline" && v.me.quest) {
      const q = v.me.quest;
      return [
        { label: `[${q.a.stat}] ${q.a.label}  ·  ${q.a.band}`, action: "quest_a" },
        { label: `[${q.b.stat}] ${q.b.label}  ·  ${q.b.band}`, action: "quest_b" },
        { label: "Ignore them", action: "quest_ignore" },
      ];
    }
    if (v.me.phase === "inline" && v.me.questResult) {
      return [{ label: "OK", action: "quest_dismiss" }];
    }
    return [];
  }

  function box(title, bodyHtml) {
    return `<div class="box"><div class="box-title">${esc(title)}</div>${bodyHtml}</div>`;
  }

  function renderDialog() {
    const v = S.view;
    if (!v) {
      el.dialog.innerHTML = "";
      return;
    }
    const items = dialogItems();
    if (S.dialogIndex >= items.length) S.dialogIndex = Math.max(0, items.length - 1);
    const focused = S.focus === "dialog" && !S.overlay;
    let html = "";

    if (v.me.phase === "front" && v.me.front) {
      const f = v.me.front;
      const left = fmtCountdown(f.deadline - now());
      let msg;
      if (!f.messageText) {
        msg = `<pre class="wrap">Nobody left anything for you. That happens.</pre>`;
      } else if (f.messagePrompt) {
        msg = `<pre class="wrap">Someone who stood here before you was asked:\n  <span class="dim">${esc(f.messagePrompt)}</span>\n\nThey wrote:\n  <span class="name">"${esc(f.messageText)}"</span></pre>`;
      } else {
        msg = `<pre class="wrap">Someone who stood here before you left this:\n\n  <span class="name">"${esc(f.messageText)}"</span></pre>`;
      }
      const hurrah = f.bonusXp > 0 ? `<pre class="ok">You made it. +${f.bonusXp} XP.\n</pre>` : "";
      html = box(
        `YOU'RE AT THE FRONT  ·  ${left}`,
        `${hurrah}${msg}
<pre class="wrap">\n\nLeave one for whoever's next.${f.prompt ? `\n<span class="dim">${esc(f.prompt)}</span>` : ""}</pre>
<div class="inputrow"><span class="prompt">&gt;</span><textarea id="msgfield" maxlength="${f.maxChars}" placeholder="up to ${f.maxChars} characters" spellcheck="true"></textarea></div>
<pre class="dim" id="msgcount" style="text-align:right">0/${f.maxChars}</pre>
<pre>${renderMenuList(items, S.dialogIndex, focused, "dialog")}</pre>
${S.errorText && Date.now() < S.errorUntil ? `<pre class="danger">${esc(S.errorText)}</pre>` : ""}`,
      );
    } else if (v.me.phase === "exiting" && v.me.exiting) {
      const left = fmtCountdown(v.me.exiting.deadline - now());
      html = box(
        `THE DOOR  ·  ${left}`,
        `<pre class="wrap">Your message is in. The door's open. Pick something to leave with:\n</pre><pre>${renderMenuList(items, S.dialogIndex, focused, "dialog")}</pre>`,
      );
    } else if (v.me.phase === "inline" && v.me.quest) {
      const q = v.me.quest;
      const left = fmtCountdown(q.expiresAt - now());
      html = box(
        `${q.npcName}  ·  ${left}`,
        `<pre class="wrap">${esc(q.setup)}\n</pre><pre>${renderMenuList(items, S.dialogIndex, focused, "dialog")}</pre>`,
      );
    } else if (v.me.phase === "inline" && v.me.questResult) {
      const r = v.me.questResult;
      html = box(
        `${r.npcName}`,
        `<pre class="wrap"><span class="dim">You chose: [${esc(r.stat)}] ${esc(r.label)} (${esc(r.band)})</span>\n\n${esc(r.text)}\n\n<span class="${r.success ? "ok" : "dim"}">${r.success ? "SUCCESS" : "FAILURE"}  ·  +${r.xp} XP</span>\n</pre><pre>${renderMenuList(items, S.dialogIndex, focused, "dialog")}</pre>`,
      );
    } else if (v.me.phase === "inline") {
      html = "";
    } else if (v.me.phase === "landing") {
      const nameMax = v.tuning.nameMaxChars;
      html = box(
        "THE STREET",
        `<pre class="wrap">${esc(v.line.count === 0 ? v.line.emptyCopy : `${v.line.count} ${v.line.count === 1 ? "person is" : "people are"} in line.`)}\n</pre>
<div class="inputrow"><span class="prompt">name:</span><input id="namefield" type="text" maxlength="${nameMax}" autocomplete="off" spellcheck="false" placeholder="what should the line call you?" value="${esc(v.me.name)}"></div>
<pre class="dim">press enter, or pick JOIN THE LINE from the menu.</pre>`,
      );
    }

    // Preserve the draft message across re-renders.
    const prev = document.getElementById("msgfield");
    if (prev && v.me.phase === "front") S.draftMessage = prev.value;
    el.dialog.innerHTML = html;
    const field = document.getElementById("msgfield");
    if (field) {
      field.value = S.draftMessage;
      updateCount();
      field.addEventListener("input", () => {
        S.draftMessage = field.value;
        updateCount();
      });
      field.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          act({ action: "submit" });
        }
        ev.stopPropagation();
      });
      if (focused && document.activeElement !== field && !document.activeElement.matches("input, textarea")) field.focus();
    }
    const namefield = document.getElementById("namefield");
    if (namefield) {
      namefield.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          act({ action: "join" });
        }
        ev.stopPropagation();
      });
      if (!v.me.name && document.activeElement !== el.chatfield) namefield.focus();
    }
  }

  function updateCount() {
    const field = document.getElementById("msgfield");
    const count = document.getElementById("msgcount");
    if (field && count && S.view && S.view.me.front) count.textContent = `${field.value.length}/${S.view.me.front.maxChars}`;
  }

  // ---- overlays --------------------------------------------------------------

  function overlayItems() {
    const o = S.overlay;
    if (!o || !S.view) return [];
    switch (o.kind) {
      case "status":
        return [{ label: "BACK", action: "close" }];
      case "leaderboard":
        return [
          { label: S.leaderboardTab === "weekly" ? "[x] WEEKLY" : "[ ] WEEKLY", action: "lb_weekly" },
          { label: S.leaderboardTab === "all" ? "[x] ALL-TIME" : "[ ] ALL-TIME", action: "lb_all" },
          { label: "BACK", action: "close" },
        ];
      case "receipts": {
        const items = (S.receipts || []).map((r, i) => ({
          label: `${new Date(r.createdAt).toLocaleString()}  ·  waited ${fmtDuration(r.waitedSeconds)}  ·  ${r.behind} behind`,
          action: "receipt_open",
          index: i,
        }));
        items.push({ label: "BACK", action: "close" });
        return items;
      }
      case "receipt":
      case "finished":
        return [
          { label: "COPY TEXT", action: "copy" },
          { label: "SHARE ON X", action: "share_x" },
          { label: "SEND BY EMAIL", action: "share_email" },
          { label: o.kind === "finished" ? "BACK TO THE STREET" : "BACK", action: o.kind === "finished" ? "close_finished" : "receipts" },
        ];
      default:
        return [{ label: "BACK", action: "close" }];
    }
  }

  function statBar(n, cap) {
    const width = 20;
    const filled = Math.max(0, Math.min(width, Math.round((n / cap) * width)));
    return "#".repeat(filled) + ".".repeat(width - filled);
  }

  function renderOverlay() {
    const o = S.overlay;
    const v = S.view;
    if (!o || !v) {
      el.overlay.innerHTML = "";
      return;
    }
    const items = overlayItems();
    if (S.overlayIndex >= items.length) S.overlayIndex = Math.max(0, items.length - 1);
    const menu = `<pre>\n${renderMenuList(items, S.overlayIndex, S.focus === "overlay", "overlay")}</pre>`;
    let html = "";
    if (o.kind === "status") {
      const m = v.me;
      const cap = Math.max(10, m.levelCap);
      html = box(
        "STATUS",
        `<pre class="wrap"><span class="name">${esc(m.name || "(no name yet)")}</span>
${esc(m.avatarText)}

${xpBar(m, 24)}
XP     ${m.xp} total
TITLE  ${esc(m.title)}${m.accessory ? `  <span class="dim">(${esc(m.accessory)})</span>` : ""}

CHARM         ${statBar(m.stats.CHARM, cap)} ${m.stats.CHARM}
INTELLIGENCE  ${statBar(m.stats.INTELLIGENCE, cap)} ${m.stats.INTELLIGENCE}
STRENGTH      ${statBar(m.stats.STRENGTH, cap)} ${m.stats.STRENGTH}

TIME IN LINE  ${fmtDuration(m.lifetimeSeconds)} lifetime

<span class="dim">Each level raises the stat you leaned on most in quests since the last one.</span></pre>${menu}`,
      );
    } else if (o.kind === "leaderboard") {
      let body = `<pre class="dim">loading...</pre>`;
      if (S.leaderboard) {
        const lb = S.leaderboard;
        const rows = S.leaderboardTab === "weekly" ? lb.weekly : lb.all;
        const mine = S.leaderboardTab === "weekly" ? lb.myWeekly : lb.myAll;
        const line = (r) =>
          `<span class="${r.isYou ? "you" : ""}">${String(r.rank).padStart(3)}  ${esc(r.name).padEnd(20)}  LVL ${String(r.level).padStart(2)}  ${S.leaderboardTab === "weekly" ? `${String(r.xp).padStart(6)} xp` : `${String(r.minutes).padStart(6)} min`}  ${esc(r.title)}</span>\n     <span class="dim">${esc(r.avatarShort || "")}</span>`;
        const head = S.leaderboardTab === "weekly" ? `WEEKLY  (week of ${lb.weekKey})  ·  XP earned this week, minutes as tiebreak` : "ALL-TIME  ·  level, minutes waited as tiebreak";
        body = `<pre class="wrap"><span class="dim">${esc(head)}</span>\n\n${rows.length ? rows.map(line).join("\n") : '<span class="dim">Nobody yet.</span>'}${mine ? `\n  ...\n${line(mine)}` : ""}</pre>`;
      }
      html = box("LEADERBOARD", body + menu);
    } else if (o.kind === "receipts") {
      const body = S.receipts === null ? `<pre class="dim">loading...</pre>` : S.receipts.length === 0 ? `<pre class="dim">No receipts yet. Reach the front and you'll get one.</pre>` : `<pre class="dim">Everything you've been given for your trouble:</pre>`;
      html = box("RECEIPTS", body + menu);
    } else if (o.kind === "receipt" || o.kind === "finished") {
      const r = o.kind === "finished" ? S.finished.receipt : S.receipts[o.index];
      const note = o.kind === "finished" ? `<pre class="dim">That's it. That's the whole thing.\n</pre>` : "";
      html = box(o.kind === "finished" ? "YOU DID IT" : "RECEIPT", `${note}<pre class="receipt">${esc(r.text)}</pre>${menu}`);
    } else if (o.kind === "peek") {
      html = "";
    }
    el.overlay.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function openOverlay(kind, extra) {
    S.overlay = Object.assign({ kind }, extra || {});
    S.overlayIndex = 0;
    S.focus = "overlay";
    if (kind === "leaderboard") send({ type: "leaderboard" });
    if (kind === "receipts") send({ type: "receipts" });
    renderAll();
  }
  function closeOverlay() {
    S.overlay = null;
    S.focus = S.view && (S.view.me.phase === "front" || S.view.me.phase === "exiting" || S.view.me.quest || S.view.me.questResult) ? "dialog" : "menu";
    renderAll();
  }

  function receiptShareText(r) {
    const url = S.siteUrl || location.origin;
    return `${r.text}\n\n${url}`;
  }

  function act(item) {
    if (!item || item.disabled) return;
    const v = S.view;
    switch (item.action) {
      case "join": {
        const field = document.getElementById("namefield");
        const name = field ? field.value : v.me.name;
        send({ type: "join", name });
        break;
      }
      case "leave":
        send({ type: "leave" });
        break;
      case "status":
        openOverlay("status");
        break;
      case "leaderboard":
        openOverlay("leaderboard");
        break;
      case "receipts":
        openOverlay("receipts");
        break;
      case "reroll":
        send({ type: "reroll" });
        break;
      case "say":
        el.chatfield.focus();
        break;
      case "mute":
        send({ type: "mute", on: true });
        break;
      case "unmute":
        send({ type: "mute", on: false });
        break;
      case "quest":
        S.focus = "dialog";
        S.dialogIndex = 0;
        renderAll();
        break;
      case "quest_a":
      case "quest_b":
        if (v.me.quest) send({ type: "quest", instanceId: v.me.quest.instanceId, option: item.action === "quest_a" ? "a" : "b" });
        break;
      case "quest_ignore":
        if (v.me.quest) send({ type: "quest", instanceId: v.me.quest.instanceId, option: "ignore" });
        S.focus = "menu";
        break;
      case "quest_dismiss":
        send({ type: "quest_dismiss" });
        S.focus = "menu";
        break;
      case "submit": {
        const field = document.getElementById("msgfield");
        const text = field ? field.value : S.draftMessage;
        send({ type: "submit", text });
        S.draftMessage = "";
        break;
      }
      case "more_time":
        send({ type: "more_time" });
        break;
      case "report":
        send({ type: "report" });
        break;
      case "emoji":
        send({ type: "emoji", emoji: item.emoji });
        break;
      case "lb_weekly":
        S.leaderboardTab = "weekly";
        renderOverlay();
        break;
      case "lb_all":
        S.leaderboardTab = "all";
        renderOverlay();
        break;
      case "receipt_open":
        openOverlay("receipt", { index: item.index });
        break;
      case "copy": {
        const r = S.overlay.kind === "finished" ? S.finished.receipt : S.receipts[S.overlay.index];
        const text = receiptShareText(r);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => flash("copied."),
            () => flash("couldn't copy. select it and copy by hand."),
          );
        } else flash("couldn't copy. select it and copy by hand.");
        break;
      }
      case "share_x": {
        const r = S.overlay.kind === "finished" ? S.finished.receipt : S.receipts[S.overlay.index];
        const url = S.siteUrl || location.origin;
        const text = `I did this and all I got was this lousy image.\n\nWAITED ${fmtDuration(r.waitedSeconds)}\n${r.behind} people behind me.`;
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
        break;
      }
      case "share_email": {
        const r = S.overlay.kind === "finished" ? S.finished.receipt : S.receipts[S.overlay.index];
        const subject = "I did this and all I got was this lousy image.";
        location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(receiptShareText(r))}`;
        break;
      }
      case "close_finished":
        S.finished = null;
        closeOverlay();
        break;
      case "close":
        closeOverlay();
        break;
      case "unpeek":
        S.peek = null;
        renderPeek();
        break;
      default:
        break;
    }
  }

  function flash(text) {
    S.errorText = text;
    S.errorUntil = Date.now() + 3000;
    renderMenu();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function activeList() {
    if (S.overlay) return { items: overlayItems(), key: "overlayIndex" };
    if (S.focus === "dialog") return { items: dialogItems(), key: "dialogIndex" };
    return { items: menuItems(), key: "menuIndex" };
  }

  document.addEventListener("keydown", (ev) => {
    const target = ev.target;
    const typing = target && target.matches && target.matches("input, textarea");
    if (typing) {
      if (ev.key === "Escape") {
        target.blur();
        ev.preventDefault();
      }
      return;
    }
    const { items, key } = activeList();
    if (ev.key === "ArrowDown" || ev.key === "j") {
      if (items.length) S[key] = (S[key] + 1) % items.length;
      ev.preventDefault();
      renderAll();
    } else if (ev.key === "ArrowUp" || ev.key === "k") {
      if (items.length) S[key] = (S[key] - 1 + items.length) % items.length;
      ev.preventDefault();
      renderAll();
    } else if (ev.key === "Enter" || ev.key === " ") {
      if (items.length) act(items[S[key]]);
      ev.preventDefault();
    } else if (ev.key === "Escape") {
      if (S.overlay) {
        if (S.overlay.kind === "finished") act({ action: "close_finished" });
        else closeOverlay();
      } else if (S.focus === "dialog" && S.view && S.view.me.phase === "inline") {
        S.focus = "menu";
        renderAll();
      }
      ev.preventDefault();
    } else if (ev.key === "Tab") {
      if (!S.overlay && S.view && S.view.me.phase === "inline" && (S.view.me.quest || S.view.me.questResult)) {
        S.focus = S.focus === "menu" ? "dialog" : "menu";
        ev.preventDefault();
        renderAll();
      }
    } else if (/^[1-9]$/.test(ev.key)) {
      const i = Number(ev.key) - 1;
      if (i < items.length) {
        S[key] = i;
        act(items[i]);
        ev.preventDefault();
      }
    }
  });

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-menu],[data-dialog],[data-overlay],[data-peek],[data-action]");
    if (!t) return;
    if (t.dataset.action) {
      act({ action: t.dataset.action });
      return;
    }
    if (t.dataset.peek !== undefined) {
      S.peek = Number(t.dataset.peek);
      renderPeek();
      return;
    }
    if (t.dataset.menu !== undefined) {
      S.focus = "menu";
      S.menuIndex = Number(t.dataset.menu);
      act(menuItems()[S.menuIndex]);
      renderAll();
    } else if (t.dataset.dialog !== undefined) {
      S.focus = "dialog";
      S.dialogIndex = Number(t.dataset.dialog);
      act(dialogItems()[S.dialogIndex]);
      renderAll();
    } else if (t.dataset.overlay !== undefined) {
      S.focus = "overlay";
      S.overlayIndex = Number(t.dataset.overlay);
      act(overlayItems()[S.overlayIndex]);
    }
  });

  el.chatfield.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const text = el.chatfield.value.trim();
      if (text) send({ type: "chat", text });
      el.chatfield.value = "";
      ev.preventDefault();
    }
    ev.stopPropagation();
  });

  // Countdown and header refresh.
  setInterval(() => {
    if (!S.view) return;
    renderHeader();
    const m = S.view.me;
    if (m.phase === "front" || m.phase === "exiting" || m.quest) {
      // Re-render only the title line countdowns to avoid stealing focus from the textarea.
      const title = el.dialog.querySelector(".box-title");
      if (title) {
        if (m.phase === "front" && m.front) title.textContent = `YOU'RE AT THE FRONT  ·  ${fmtCountdown(m.front.deadline - now())}`;
        else if (m.phase === "exiting" && m.exiting) title.textContent = `THE DOOR  ·  ${fmtCountdown(m.exiting.deadline - now())}`;
        else if (m.quest) title.textContent = `${m.quest.npcName}  ·  ${fmtCountdown(m.quest.expiresAt - now())}`;
      }
    }
    if (S.toast && Date.now() >= S.toastUntil) renderToast();
    if (S.errorText && Date.now() >= S.errorUntil) {
      S.errorText = "";
      renderMenu();
    }
    if (S.noticeText && Date.now() >= S.noticeUntil) {
      S.noticeText = "";
      renderMenu();
    }
  }, 500);

  // Keep the socket warm; also re-syncs the clock.
  setInterval(() => send({ type: "ping" }), 25000);

  // Leaving the page loses your spot (after the server's grace period).
  window.addEventListener("pagehide", () => {
    if (S.ws) S.ws.close();
  });

  renderAll();
  connect();
})();
