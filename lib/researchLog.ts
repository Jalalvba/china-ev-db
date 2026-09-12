// Durable audit trail for the UI's tech-spec research/apply round trip
// (app/api/models/[id]/update-specs and apply-specs). Unlike
// scripts/tech-spec-agent.ts's batch file, the UI flow is interactive and
// per-model, so this appends one JSON line per event to a single rolling log
// instead of one file per run — cheap to grep/tail, and never silently loses
// what was actually shown on the review screen or actually sent to be
// applied. Fixes the exact gap that made a mis-applied Soueast S06 DM
// dc_charge_kw/ac_charge_kw correction impossible to trace after the fact.

import fs from "fs";
import path from "path";

const LOG_PATH = path.resolve("raw-data/ui-tech-spec-log.jsonl");

export type ResearchLogEvent =
  | { kind: "research"; modelDbId: string; modelName?: string; result: unknown }
  | { kind: "apply"; modelDbId: string; requestedUpdates: unknown; requestedNotableFacts: unknown; result: unknown }
  | {
      kind: "manual-apply";
      modelDbId: string;
      /** Distinguishes a hand-carried Kimi/DeepSeek round trip from the Gemini-automated "research" / "apply" events above. */
      source: "manual-kimi-import" | "manual-deepseek-import";
      modelDiff: unknown;
      powertrainResults: unknown;
      result: unknown;
    };

/** Best-effort: a logging failure must never break the research/apply request itself. */
export function appendResearchLog(event: ResearchLogEvent): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch (err) {
    console.error("appendResearchLog failed (non-fatal):", err);
  }
}
