import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import type { Game, ChatLine, ReceiptView } from "./game.js";
import { buildCookie, hashToken, isPlausibleToken, mintPublicId, mintSecretToken, parseCookies } from "./identity.js";
import { renderModPage, handleModPost } from "./mod.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

interface ClientSocket extends WebSocket {
  playerId?: number;
  isAlive?: boolean;
}

export function createServer(game: Game) {
  const sockets = new Map<number, Set<ClientSocket>>();

  const send = (ws: WebSocket, payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };
  const sendTo = (playerId: number, payload: unknown) => {
    for (const ws of sockets.get(playerId) ?? []) send(ws, payload);
  };
  const broadcast = (payload: unknown, filter?: (playerId: number) => boolean) => {
    for (const [pid, set] of sockets) {
      if (filter && !filter(pid)) continue;
      for (const ws of set) send(ws, payload);
    }
  };

  game.setListener({
    onPlayer(playerId) {
      try {
        sendTo(playerId, { type: "view", view: game.view(playerId) });
      } catch (err) {
        console.error("[ws] view failed", err);
      }
    },
    onLine() {
      for (const pid of sockets.keys()) sendTo(pid, { type: "line", line: game.lineView(pid), serverTime: Date.now() });
    },
    onChat(line: ChatLine) {
      broadcast({ type: "chat", line }, (pid) => game.db.getPlayer(pid)?.muted !== 1);
    },
    onToast(text) {
      broadcast({ type: "toast", text });
    },
    onFinished(playerId, payload: { receipt: ReceiptView; timedOut: boolean }) {
      sendTo(playerId, { type: "finished", ...payload });
    },
    onError(playerId, text) {
      sendTo(playerId, { type: "error", text });
    },
  });

  // ---- identity ----------------------------------------------------------

  /** Returns [playerId, Set-Cookie header or null]. */
  function identify(req: http.IncomingMessage): [number, string | null] {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[config.cookieName];
    if (isPlausibleToken(token)) {
      const row = game.db.getPlayerByTokenHash(hashToken(token));
      if (row) return [row.id, null];
    }
    const fresh = mintSecretToken();
    let publicId = mintPublicId();
    while (game.db.getPlayerByPublicId(publicId)) publicId = mintPublicId();
    const row = game.createPlayer(publicId, hashToken(fresh));
    return [row.id, buildCookie(config.cookieName, fresh, config.cookieMaxAgeSeconds, config.secureCookies)];
  }

  // ---- http --------------------------------------------------------------

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (url.pathname === "/mod" || url.pathname.startsWith("/mod/")) {
        if (!config.modPassword) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("mod tool disabled (set MOD_PASSWORD)");
          return;
        }
        const auth = req.headers.authorization ?? "";
        const expected = "Basic " + Buffer.from(`mod:${config.modPassword}`).toString("base64");
        if (auth !== expected) {
          res.writeHead(401, { "www-authenticate": 'Basic realm="The Line moderation"', "content-type": "text/plain" });
          res.end("auth required");
          return;
        }
        if (req.method === "POST") {
          const body = await readBody(req);
          handleModPost(game, url.pathname, new URLSearchParams(body));
          res.writeHead(303, { location: "/mod" });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderModPage(game));
        return;
      }

      // Static files. "/" serves index.html and always sets the identity cookie.
      let file = url.pathname === "/" ? "/index.html" : url.pathname;
      file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
      const abs = path.join(config.publicDir, file);
      if (!abs.startsWith(config.publicDir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      const headers: Record<string, string> = {
        "content-type": MIME[path.extname(abs)] ?? "application/octet-stream",
        "cache-control": file === "/index.html" ? "no-store" : "public, max-age=300",
      };
      if (file === "/index.html") {
        const [, setCookie] = identify(req);
        if (setCookie) headers["set-cookie"] = setCookie;
      }
      res.writeHead(200, headers);
      fs.createReadStream(abs).pipe(res);
    } catch (err) {
      console.error("[http]", err);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("server error");
    }
  });

  // ---- websocket ---------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[config.cookieName];
    const row = isPlausibleToken(token) ? game.db.getPlayerByTokenHash(hashToken(token)) : undefined;
    if (!row) {
      // No identity yet: the client must load "/" first to get a cookie.
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as ClientSocket).playerId = row.id;
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: ClientSocket) => {
    const playerId = ws.playerId!;
    if (!sockets.has(playerId)) sockets.set(playerId, new Set());
    sockets.get(playerId)!.add(ws);
    ws.isAlive = true;
    game.connect(playerId);
    send(ws, { type: "view", view: game.view(playerId) });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      try {
        await handle(playerId, msg, ws);
      } catch (err) {
        console.error("[ws] handler error", err);
        send(ws, { type: "error", text: "Something went wrong on our end." });
      }
    });

    ws.on("close", () => {
      sockets.get(playerId)?.delete(ws);
      if (sockets.get(playerId)?.size === 0) sockets.delete(playerId);
      game.disconnect(playerId);
    });
  });

  async function handle(playerId: number, msg: Record<string, unknown>, ws: WebSocket) {
    const str = (k: string) => (typeof msg[k] === "string" ? (msg[k] as string) : "");
    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong", serverTime: Date.now() });
        break;
      case "join":
        await game.join(playerId, str("name"));
        break;
      case "leave":
        game.leave(playerId);
        break;
      case "reroll":
        game.reroll(playerId);
        break;
      case "chat":
        await game.chat(playerId, str("text"));
        break;
      case "quest": {
        const option = str("option");
        if (option === "a" || option === "b" || option === "ignore") {
          game.chooseQuest(playerId, Number(msg.instanceId), option);
        }
        break;
      }
      case "quest_dismiss":
        game.dismissQuestResult(playerId);
        break;
      case "levelup":
        game.levelUp(playerId, str("stat"));
        break;
      case "more_time":
        game.moreTime(playerId);
        break;
      case "submit":
        await game.submitMessage(playerId, str("text"));
        break;
      case "emoji":
        game.chooseEmoji(playerId, str("emoji"));
        break;
      case "report":
        game.report(playerId);
        break;
      case "mute":
        game.setMuted(playerId, Boolean(msg.on));
        break;
      case "leaderboard":
        send(ws, { type: "leaderboard", ...game.leaderboard(playerId) });
        break;
      case "receipts":
        send(ws, { type: "receipts", list: game.receipts(playerId), siteUrl: config.siteUrl });
        break;
      case "view":
        send(ws, { type: "view", view: game.view(playerId) });
        break;
      default:
        break;
    }
  }

  // Heartbeat: dead sockets are closed so the grace period can start.
  const heartbeat = setInterval(() => {
    for (const set of sockets.values()) {
      for (const ws of set) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 10_000);

  server.on("close", () => clearInterval(heartbeat));
  return server;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
