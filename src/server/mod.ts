import type { Game } from "./game.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** The human review queue. Text-only, like everything else. */
export function renderModPage(game: Game): string {
  const queue = game.db.reviewQueue();
  const stats = game.db.messageStats();
  const recent = game.db.recentMessages(30);
  const state = game.debugState();
  const row = (m: (typeof queue)[number]) => `
<tr>
  <td>#${m.id}</td>
  <td>${m.mod_score === null ? "-" : m.mod_score.toFixed(2)}</td>
  <td>${esc(m.mod_reason)}</td>
  <td>${m.reports}</td>
  <td class="t">${esc(m.text)}</td>
  <td>
    <form method="post" action="/mod/approve" style="display:inline"><input type="hidden" name="id" value="${m.id}"><button>approve</button></form>
    <form method="post" action="/mod/reject" style="display:inline"><input type="hidden" name="id" value="${m.id}"><button>reject</button></form>
  </td>
</tr>`;
  const recentRow = (m: (typeof recent)[number]) => `
<tr>
  <td>#${m.id}</td>
  <td>${esc(m.status)}${m.is_seed ? " (seed)" : ""}</td>
  <td>${m.mod_score === null ? "-" : m.mod_score.toFixed(2)}</td>
  <td>${esc(m.mod_reason)}</td>
  <td>${m.deliveries}</td>
  <td>${m.reports}</td>
  <td class="t">${esc(m.text)}</td>
  <td>
    ${m.status !== "approved" ? `<form method="post" action="/mod/approve" style="display:inline"><input type="hidden" name="id" value="${m.id}"><button>approve</button></form>` : ""}
    ${m.status !== "rejected" ? `<form method="post" action="/mod/reject" style="display:inline"><input type="hidden" name="id" value="${m.id}"><button>reject</button></form>` : ""}
  </td>
</tr>`;
  return `<!doctype html>
<meta charset="utf-8">
<title>THE LINE / moderation</title>
<style>
  body { font-family: ui-monospace, Menlo, Consolas, monospace; background:#111; color:#ddd; padding: 16px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
  td, th { border: 1px solid #444; padding: 4px 8px; vertical-align: top; text-align: left; }
  td.t { white-space: pre-wrap; }
  button { font-family: inherit; background:#222; color:#eee; border:1px solid #666; padding:2px 8px; cursor:pointer; }
  h1, h2 { font-weight: normal; }
  .muted { color:#888; }
</style>
<h1>THE LINE / moderation</h1>
<p class="muted">classifier: ${esc(game.classifier.name)} · pending ${stats.pending ?? 0} · review ${stats.review ?? 0} · approved ${stats.approved ?? 0} · rejected ${stats.rejected ?? 0} · in line now: ${state.line.length}</p>
<h2>Review queue (${queue.length})</h2>
${queue.length === 0 ? "<p class=\"muted\">Nothing waiting.</p>" : `<table><tr><th>id</th><th>score</th><th>reason</th><th>reports</th><th>message</th><th></th></tr>${queue.map(row).join("")}</table>`}
<h2>Recent messages</h2>
<table><tr><th>id</th><th>status</th><th>score</th><th>reason</th><th>delivered</th><th>reports</th><th>message</th><th></th></tr>${recent.map(recentRow).join("")}</table>
`;
}

export function handleModPost(game: Game, pathname: string, form: URLSearchParams) {
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;
  const m = game.db.getMessage(id);
  if (!m) return;
  if (pathname === "/mod/approve") {
    game.db.setMessageStatus(id, "approved");
    game.db.resetReports(id);
  } else if (pathname === "/mod/reject") {
    game.db.setMessageStatus(id, "rejected");
  }
}
