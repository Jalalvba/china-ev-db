import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { parseManualImport } from "@/lib/manualResearchImport";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "@/lib/schemaGuard";
import { appendResearchLog } from "@/lib/researchLog";
import { getCnyPerUsdRate } from "@/lib/deepseekNormalize";
import type { PowertrainLean } from "@/lib/techSpecResearch";

type ManualSource = "manual-kimi-import" | "manual-deepseek-import";

// Write path for the manual Kimi/DeepSeek round-trip. Deliberately does NOT
// trust the diff the client already saw from the validate route — re-parses
// the same raw JSON from scratch (same rule as lib/applySpecUpdates.ts never
// trusting that a write call not throwing means the fields landed), then
// writes and re-fetches to verify, exactly like applySpecUpdates.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;

  const body = await req.json().catch(() => null);
  const rawText = body?.json;
  const source = body?.source as ManualSource | undefined;
  if (typeof rawText !== "string" || rawText.trim() === "") {
    return NextResponse.json({ error: "Missing \"json\" (the pasted Kimi/DeepSeek response text) in request body." }, { status: 400 });
  }
  if (source !== "manual-kimi-import" && source !== "manual-deepseek-import") {
    return NextResponse.json({ error: 'Missing/invalid "source" — must be "manual-kimi-import" or "manual-deepseek-import".' }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const existingPowertrains = (await Powertrain.find({ model_id: modelId }).lean()) as unknown as (PowertrainLean & Record<string, unknown>)[];

  const parseResult = parseManualImport(rawText, modelDoc as unknown as Record<string, unknown>, existingPowertrains);
  if (!parseResult.valid) {
    return NextResponse.json({ error: "Validation failed — nothing was written.", errors: parseResult.errors }, { status: 422 });
  }

  const errors: string[] = [];
  let modelApplied = false;
  const powertrainOutcomes: { trimName?: string; status: string; applied: boolean; error?: string }[] = [];

  // --- model fields ---
  if (parseResult.modelDiff.length > 0) {
    const expected: Record<string, unknown> = {};
    for (const entry of parseResult.modelDiff) {
      // price_range.min_usd/max_usd/exchange_rate_used are never something
      // the researcher was asked to fill in (buildExportDocument only ever
      // sends min/max/currency_local/unverified) and never something we
      // trust even if one slips through anyway — always computed fresh
      // below from a live rate, the same rule scripts/backfill-price-usd.ts
      // and the import pipeline already follow.
      if (entry.path === "price_range.min_usd" || entry.path === "price_range.max_usd" || entry.path === "price_range.exchange_rate_used") {
        continue;
      }
      expected[entry.path] = entry.after;
    }

    const priceChanged = parseResult.modelDiff.some((e) => e.path === "price_range.min" || e.path === "price_range.max");
    if (priceChanged) {
      const currencyEntry = parseResult.modelDiff.find((e) => e.path === "price_range.currency_local");
      const existingCurrency = (modelDoc as Record<string, unknown> & { price_range?: { currency_local?: string } }).price_range?.currency_local;
      const currency = (currencyEntry?.after as string | undefined) ?? existingCurrency;
      const minEntry = parseResult.modelDiff.find((e) => e.path === "price_range.min");
      const maxEntry = parseResult.modelDiff.find((e) => e.path === "price_range.max");
      const min = (minEntry?.after as number | undefined) ?? (modelDoc as Record<string, unknown> & { price_range?: { min?: number } }).price_range?.min;
      const max = (maxEntry?.after as number | undefined) ?? (modelDoc as Record<string, unknown> & { price_range?: { max?: number } }).price_range?.max;
      if (currency === "CNY" && typeof min === "number" && typeof max === "number") {
        const { rate: cnyPerUsd } = await getCnyPerUsdRate();
        expected["price_range.min_usd"] = Math.round(min / cnyPerUsd);
        expected["price_range.max_usd"] = Math.round(max / cnyPerUsd);
        expected["price_range.exchange_rate_used"] = cnyPerUsd;
      }
      // A non-CNY currency_local (e.g. an AED-priced model) is left without
      // a computed USD figure here, same as scripts/backfill-price-usd.ts —
      // converting at the CNY rate would be wrong.
    }

    assertSchemaKnowsFields(ModelSchema, Object.keys(expected), "Model");
    await ModelSchema.findByIdAndUpdate(modelId, { $set: expected });
    const persisted = (await ModelSchema.findById(modelId).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(expected, persisted);
    if (badFields.length > 0) {
      errors.push(`Model fields did not verify after write: [${badFields.join(", ")}]. Check for a stale cached Mongoose schema.`);
    } else {
      modelApplied = true;
    }
  }

  // --- powertrains ---
  for (const pt of parseResult.powertrainResults) {
    if (pt.status === "rejected_out_of_scope") {
      // Out-of-scope trims are skipped, not errors — the rest of the import still applies (lib/powertrainScope.ts).
      powertrainOutcomes.push({ trimName: (pt.variant.trim_name as string | undefined) ?? pt.trimName, status: "rejected_out_of_scope", applied: false, error: pt.rejectedReason });
      continue;
    }
    try {
    if (pt.status === "update" && pt.existingId) {
      if (pt.diff.length === 0) {
        powertrainOutcomes.push({ trimName: pt.trimName, status: "unchanged", applied: true });
        continue;
      }
      assertSchemaKnowsFields(Powertrain, Object.keys(pt.variant), "Powertrain");
      await Powertrain.findByIdAndUpdate(pt.existingId, { $set: pt.variant });
      const persisted = (await Powertrain.findById(pt.existingId).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(pt.variant, persisted);
      if (badFields.length > 0) {
        const msg = `Trim "${pt.trimName}" (${pt.existingId}) did not verify after write: [${badFields.join(", ")}].`;
        errors.push(msg);
        powertrainOutcomes.push({ trimName: pt.trimName, status: "update", applied: false, error: msg });
      } else {
        powertrainOutcomes.push({ trimName: pt.trimName, status: "update", applied: true });
      }
    } else {
      assertSchemaKnowsFields(Powertrain, Object.keys(pt.variant), "Powertrain");
      const created = await Powertrain.create({ ...pt.variant, model_id: modelId });
      const persisted = (await Powertrain.findById(created._id).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(pt.variant, persisted);
      if (badFields.length > 0) {
        const msg = `New trim "${pt.variant.trim_name}" did not verify after insert: [${badFields.join(", ")}].`;
        errors.push(msg);
        powertrainOutcomes.push({ trimName: pt.variant.trim_name as string | undefined, status: "new", applied: false, error: msg });
      } else {
        powertrainOutcomes.push({ trimName: pt.variant.trim_name as string | undefined, status: "new", applied: true });
      }
    }
    } catch (err) {
      // The Powertrain schema hooks (models/Powertrain.ts) are the backstop behind the parse-time gate above: if one
      // fires, record it as this trim's outcome instead of failing the whole request with a 500.
      const msg = `Trim "${(pt.variant.trim_name as string | undefined) ?? pt.trimName}" was refused by the write layer: ${(err as Error).message}`;
      errors.push(msg);
      powertrainOutcomes.push({ trimName: (pt.variant.trim_name as string | undefined) ?? pt.trimName, status: pt.status, applied: false, error: msg });
    }
  }

  const result = { modelApplied, powertrainOutcomes, errors };

  appendResearchLog({
    kind: "manual-apply",
    modelDbId: modelId,
    source,
    modelDiff: parseResult.modelDiff,
    powertrainResults: parseResult.powertrainResults,
    result,
  });

  return NextResponse.json(result);
}
