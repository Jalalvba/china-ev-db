// Write-time rule for Brand.parent_group — the un-bypassable backstop behind CLAUDE.md's "Data model
// conventions (Brand ownership/grouping)".
//
// Why this exists (2026-09-21): parent_group is a free-text string that lib/brandGrouping.ts matches by EXACT
// equality (against other brands' `name`, or as a literal group key). Nothing validated it, so the same real
// group drifted into different spellings — Chery/Jaecoo/Jetour/Lepas each carried a different prose string and
// fell into "Independent brands"; Changan/Nevo/Avatr, GAC/Trumpchi, WEY/Haval/TANK, Dongfeng/Yijing/M-Hero and
// SAIC/Huajing split the same way. Prompt wording never prevented it, so — same principle as
// lib/powertrainScope.ts — the rule lives in code, enforced by hooks on the Brand schema (models/Brand.ts).
//
// Rule: a non-empty parent_group must EITHER equal the `name` of an existing brand OTHER than the brand itself
// (the chain form: Nevo -> "Changan"), OR be one of KNOWN_PARENT_GROUP_KEYS below (a corporate group with no
// brand of its own name: "Chery Automobile Co., Ltd."). It fires only when parent_group is being WRITTEN, so an
// existing doc with a legacy value is never made un-saveable by an unrelated edit — `npm run audit-brand-groups`
// reports those instead.
//
// ADDING A NEW GROUP is deliberate: append its exact key here in the same change that first uses it. The
// friction is the point — the alternative is another silently-split group.
//
// Not covered by design (same as the Powertrain guard): bulkWrite and raw-driver writes (one-off reviewed
// scripts). Opt-out for a deliberate case: BRAND_PARENT_GROUP_OVERRIDE=1 for a process, or
// `.setOptions({ allowUnknownParentGroup: true })` on a query / `doc.$locals.allowUnknownParentGroup = true`.
// A hook change needs a dev-server restart (stale-schema rule, CLAUDE.md "Write safety").

/** Exact, canonical corporate-group keys that are NOT the name of a brand. Keep sorted. */
export const KNOWN_PARENT_GROUP_KEYS: readonly string[] = [
  "BAIC Group",
  "BYD Group",
  "Chery Automobile Co., Ltd.",
  "China Changan Automobile Group",
  "China FAW Group",
  "Chongqing Shaci Zhiyuan",
  "Dongfeng Motor Corporation",
  "Geely Holding Group",
  "Guangzhou Automobile Industry Group Co., Ltd.",
  "Rox Motor",
  "SAIC Motor",
  "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
  "Seres Group",
  "Xiaomi Auto",
];

export class InvalidParentGroupError extends Error {
  readonly value: string;
  constructor(value: string, reason: string, context = "Brand write") {
    super(`${context} rejected: parent_group ${JSON.stringify(value)} ${reason}`);
    this.name = "InvalidParentGroupError";
    this.value = value;
  }
}

export function parentGroupOverrideActive(): boolean {
  return process.env.BRAND_PARENT_GROUP_OVERRIDE === "1";
}

export interface ParentGroupCheck {
  ok: boolean;
  reason?: string;
}

/** Pure check. `brandNames` = every existing Brand.name; `ownName` = the brand being written, when known. */
export function checkParentGroup(value: unknown, brandNames: ReadonlySet<string>, ownName?: string): ParentGroupCheck {
  if (value === undefined || value === null || value === "") return { ok: true }; // clearing/absent is always fine
  if (typeof value !== "string") return { ok: false, reason: "must be a string" };
  if (ownName !== undefined && value === ownName) return { ok: false, reason: "cannot be the brand's own name" };
  if (KNOWN_PARENT_GROUP_KEYS.includes(value)) return { ok: true };
  if (brandNames.has(value)) return { ok: true };
  return {
    ok: false,
    reason:
      "matches no existing brand name and is not a known group key. Use the exact `name` of the parent brand (e.g. \"Changan\"), " +
      "or an exact key from KNOWN_PARENT_GROUP_KEYS in lib/brandParentGroup.ts — a NEW group must be added to that list in the same change. " +
      "Ownership nuance belongs in status_note/relationship_type, never in parent_group.",
  };
}

/** Pulls parent_group out of a Mongoose update (top-level, $set, or $setOnInsert). Returns {present:false} if not written. */
export function parentGroupFromUpdate(update: unknown): { present: boolean; value?: unknown } {
  if (typeof update !== "object" || update === null) return { present: false };
  const u = update as Record<string, unknown>;
  for (const holder of [u, u.$set, u.$setOnInsert] as unknown[]) {
    if (typeof holder === "object" && holder !== null && "parent_group" in (holder as object)) {
      return { present: true, value: (holder as Record<string, unknown>).parent_group };
    }
  }
  return { present: false };
}
