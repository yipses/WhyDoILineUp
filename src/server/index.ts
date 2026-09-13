import { config } from "./config.js";
import { loadContent } from "./content.js";
import { Db } from "./db.js";
import { Game } from "./game.js";
import { createServer } from "./server.js";

const content = loadContent();
console.log(
  `[content] ${content.quests.length} quests, ${content.seedMessages.length} seeds, ${content.npcs.length} NPCs, ${content.xpCurve.length} levels`,
);

const db = new Db(config.dbPath);
const game = new Game(db, content);
const server = createServer(game);

game.start();
server.listen(config.port, config.host, () => {
  console.log(`[server] THE LINE listening on http://${config.host}:${config.port}`);
  if (config.timeScale !== 1) console.log(`[server] TIME_SCALE=${config.timeScale} (durations divided by this)`);
  if (!config.modPassword) console.log("[server] /mod disabled; set MOD_PASSWORD to enable the review tool");
});

function shutdown() {
  console.log("[server] shutting down");
  game.stop();
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
