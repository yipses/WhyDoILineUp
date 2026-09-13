#!/usr/bin/env node
/**
 * Pull every content tab from the Google Sheet into content/*.csv.
 *
 * The sheet must be shared as "Anyone with the link can view".
 * Usage:
 *   SHEET_ID=<id from the sheet URL> npm run content:pull
 *
 * Each tab is fetched as CSV via the public export endpoint and written to
 * content/<TabName>.csv. The server reads those files at startup.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(here, "..", "content");

const TABS = [
  "Tuning",
  "XP_Curve",
  "Quest_Tiers",
  "Odds_Bands",
  "Titles",
  "Avatar_Parts",
  "Emojis",
  "NPCs",
  "NPC_Lines",
  "Announcements",
  "Prompts",
  "Seed_Messages",
  "Blocklist",
  "Quests",
];

const sheetId = process.env.SHEET_ID || readSheetIdFile();
if (!sheetId) {
  console.error("Set SHEET_ID (or put the id in content/SHEET_ID) and share the sheet as 'anyone with the link can view'.");
  process.exit(1);
}

function readSheetIdFile() {
  try {
    return fs.readFileSync(path.join(contentDir, "SHEET_ID"), "utf8").trim();
  } catch {
    return "";
  }
}

let failed = 0;
for (const tab of TABS) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<")) throw new Error("empty or HTML response (is the sheet shared and the tab name right?)");
    const rows = text.split("\n").length - 1;
    fs.writeFileSync(path.join(contentDir, `${tab}.csv`), text.endsWith("\n") ? text : text + "\n");
    console.log(`${tab.padEnd(14)} ${rows} rows`);
  } catch (err) {
    failed++;
    console.error(`${tab.padEnd(14)} FAILED: ${err.message}`);
  }
}
if (failed) {
  console.error(`${failed} tab(s) failed; existing CSVs for those tabs were left untouched.`);
  process.exit(1);
}
console.log("content updated. restart the server to load it.");
