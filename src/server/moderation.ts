import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

export interface Verdict {
  /** 0 = clearly harmful, 1 = clearly fine. */
  score: number;
  reason: string;
}

export interface Classifier {
  name: string;
  classify(text: string, context: "message" | "chat" | "name"): Promise<Verdict>;
}

// ---------------------------------------------------------------------------
// Heuristic classifier. Always available. Synchronous under the hood.
// ---------------------------------------------------------------------------

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

function normalise(text: string): string {
  let out = text.toLowerCase();
  out = out.replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  out = out.replace(/(.)\1{2,}/g, "$1$1"); // collapse runs of 3+ to 2
  out = out.replace(/[^a-z\s']/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

export class HeuristicClassifier implements Classifier {
  name = "heuristic";
  private patterns: RegExp[];

  constructor(blocklist: string[]) {
    this.patterns = blocklist
      .map((w) => normalise(w))
      .filter(Boolean)
      .map((w) => new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`));
  }

  scoreSync(text: string, context: "message" | "chat" | "name"): Verdict {
    const trimmed = text.trim();
    if (!trimmed) return { score: 0, reason: "empty" };
    const norm = normalise(trimmed);
    for (const p of this.patterns) {
      if (p.test(norm)) return { score: 0.05, reason: "blocklist" };
    }
    const flags: string[] = [];
    let score = 0.92;
    if (/https?:\/\/|www\.|\.(com|net|org|io|gg|xyz)(\/|\s|$)/i.test(trimmed)) {
      score = Math.min(score, 0.45);
      flags.push("url");
    }
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(trimmed)) {
      score = Math.min(score, 0.4);
      flags.push("email");
    }
    if (/(\+?\d[\d\s().-]{7,}\d)/.test(trimmed)) {
      score = Math.min(score, 0.45);
      flags.push("phone");
    }
    const letters = trimmed.replace(/[^a-zA-Z]/g, "");
    if (letters.length > 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) {
      score = Math.min(score, 0.6);
      flags.push("shouting");
    }
    if (/(.)\1{5,}/.test(trimmed)) {
      score = Math.min(score, 0.55);
      flags.push("repeated characters");
    }
    if (context === "name" && !/[a-zA-Z0-9]/.test(trimmed)) {
      score = Math.min(score, 0.2);
      flags.push("no letters");
    }
    return { score, reason: flags.length ? flags.join(", ") : "no flags" };
  }

  async classify(text: string, context: "message" | "chat" | "name"): Promise<Verdict> {
    return this.scoreSync(text, context);
  }
}

// ---------------------------------------------------------------------------
// Claude classifier. Used when ANTHROPIC_API_KEY is set. Falls back to the
// heuristic score on any API failure so moderation never blocks the game.
// ---------------------------------------------------------------------------

const SYSTEM = `You moderate short anonymous text for a public, all-ages web game about standing in a line.
Score each text from 0 to 1 for whether it is acceptable to show to strangers.
1.0 = clearly fine (mundane, kind, funny, odd, boring are all fine).
0.0 = clearly unacceptable: slurs, harassment, threats, sexual content, self-harm encouragement, doxxing, phone numbers, emails, URLs, advertising, or spam.
Use values in between when it is borderline (mild profanity, ambiguous insults, edgy jokes).
Respond with JSON: {"score": number, "reason": short string}.`;

export class ClaudeClassifier implements Classifier {
  name = "claude";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
    private fallback: HeuristicClassifier,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
  }

  async classify(text: string, context: "message" | "chat" | "name"): Promise<Verdict> {
    const local = this.fallback.scoreSync(text, context);
    if (local.reason === "blocklist" || local.reason === "empty") return local;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM,
        messages: [{ role: "user", content: `Context: ${context}\nText: ${JSON.stringify(text)}` }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { score: { type: "number" }, reason: { type: "string" } },
              required: ["score", "reason"],
              additionalProperties: false,
            },
          },
        },
      });
      if (response.stop_reason === "refusal") return { score: 0.1, reason: "classifier refused" };
      let raw = "";
      for (const block of response.content) if (block.type === "text") raw += block.text;
      const parsed = JSON.parse(raw) as { score: number; reason: string };
      const score = Math.max(0, Math.min(1, Number(parsed.score)));
      if (!Number.isFinite(score)) throw new Error("bad score");
      // Heuristic flags (urls, contact info) still cap the score.
      const capped = local.score < 0.7 ? Math.min(score, local.score) : score;
      const reason = local.score < 0.7 ? `${parsed.reason} (${local.reason})` : String(parsed.reason ?? "");
      return { score: capped, reason };
    } catch (err) {
      console.warn("[moderation] claude classifier failed, using heuristic:", (err as Error).message);
      return { ...local, reason: `heuristic fallback: ${local.reason}` };
    }
  }
}

export function buildClassifier(blocklist: string[]): Classifier {
  const heuristic = new HeuristicClassifier(blocklist);
  if (config.anthropicApiKey) {
    console.log(`[moderation] using Claude classifier (${config.modModel}) with heuristic fallback`);
    return new ClaudeClassifier(config.anthropicApiKey, config.modModel, heuristic);
  }
  console.log("[moderation] using heuristic classifier (set ANTHROPIC_API_KEY to enable the AI classifier)");
  return heuristic;
}

export type Decision = "approved" | "rejected" | "review";

export function decide(score: number, passThreshold: number, failThreshold: number): Decision {
  if (score >= passThreshold) return "approved";
  if (score < failThreshold) return "rejected";
  return "review";
}
