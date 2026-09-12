// Shared by lib/techSpecResearch.ts and lib/modelDiscovery.ts (Tier 2): the
// confirmed Tier-1 brand-identity facts (see lib/brandResearch.ts), fed into
// their prompts as established context rather than left for each model-level
// research call to re-derive. Lets Tier 2 focus entirely on the model itself
// — assume the manufacturer/ownership context is settled — instead of
// spending part of every call re-establishing "who owns this brand".

export interface BrandContext {
  parentGroup?: string;
  relationshipType?: string;
  stakePercentage?: number;
  techPartner?: string;
  status?: string;
}

/** Renders confirmed brand context as a prompt fragment, or "" if there's nothing worth stating (e.g. Tier 1 hasn't run yet for this brand — Tier 2 still works without it, just without this framing). */
export function buildBrandContextBlock(ctx?: BrandContext): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.parentGroup) {
    const relation = ctx.relationshipType ? ` (${ctx.relationshipType}${ctx.stakePercentage ? `, ${ctx.stakePercentage}% stake` : ""})` : "";
    parts.push(`parent/controlling company: ${ctx.parentGroup}${relation}`);
  }
  if (ctx.techPartner) parts.push(`technology partner: ${ctx.techPartner}`);
  if (ctx.status && ctx.status !== "active") parts.push(`brand status: ${ctx.status}`);
  if (parts.length === 0) return "";
  return `\nConfirmed brand context (already researched — treat as established, do not re-derive or question it): ${parts.join("; ")}. Use this so you can focus entirely on this specific model rather than re-establishing who owns or manufactures the brand — e.g. if relevant, consider what's specifically sold under this brand's positioning versus its parent's other brands.`;
}
