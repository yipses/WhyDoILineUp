export const RECEIPT_CAPTION = "I did this and all I got was this lousy image.";

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  return `${m}m ${pad(sec)}s`;
}

/**
 * The line as text at the moment the player reached the front.
 * The player is at the door; everyone else trails behind.
 */
export function lineSnapshot(names: string[], youIndex: number, maxNames: number): string {
  const shown = names.slice(0, maxNames).map((n, i) => (i === youIndex ? `>${n}<` : n));
  const extra = names.length - shown.length;
  return `[door] ${shown.join("  ")}${extra > 0 ? `  ... (+${extra})` : ""}`;
}

/**
 * The receipt contains exactly three things: total wait time, the snapshot,
 * and the number of people behind. Nothing else (Section 8, rule 2).
 */
export function renderReceipt(waitedSeconds: number, snapshot: string, behind: number): string {
  const width = 60;
  const bar = "+" + "-".repeat(width - 2) + "+";
  const line = (s = "") => {
    const inner = width - 4;
    const chunks = wrap(s, inner);
    return chunks.map((c) => `| ${c.padEnd(inner)} |`).join("\n");
  };
  return [
    bar,
    line(RECEIPT_CAPTION),
    line(),
    line(`WAITED  ${formatDuration(waitedSeconds)}`),
    line(),
    line(snapshot),
    line(),
    line(`PEOPLE BEHIND YOU  ${behind}`),
    bar,
  ].join("\n");
}

export function wrap(text: string, width: number): string[] {
  if (!text) return [""];
  if (text.length <= width) return [text]; // keep spacing intact when it fits
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (w.length > width) {
      if (cur) lines.push(cur);
      cur = "";
      for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
      continue;
    }
    if ((cur + (cur ? " " : "") + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
