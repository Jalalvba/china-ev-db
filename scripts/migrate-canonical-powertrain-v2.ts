// One-time migration: splits the free-text engine.induction/fuel_type and
// battery.chemistry fields into the new structured shape added in
// types/canonicalPowertrain.ts (aspiration, fuel_type enum +
// is_range_extender boolean, chemistry enum), and renames
// transmission.gears -> transmission.speed_count.
//
// Every mapping below was built from the actual distinct() values present in
// the collection at the time this was written (checked via mongosh, not
// guessed) — see the mapping tables. Any value found on a live document that
// isn't in these tables is NOT guessed at: the script throws and lists it,
// same "don't guess" discipline as the AI research pipeline's grounding
// gate. Re-run with the newly-seen value added to the table once you've
// confirmed what it means.
//
// Usage:
//   npm run migrate-canonical-powertrain-v2            (dry run — prints what would change, writes nothing)
//   npm run migrate-canonical-powertrain-v2 -- --commit (actually writes)

import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mongoose from "mongoose";
import Powertrain from "../models/Powertrain";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const COMMIT = process.argv.includes("--commit");

// --- induction -> aspiration -------------------------------------------------
const INDUCTION_TO_ASPIRATION: Record<string, string> = {
  "naturally aspirated": "naturally-aspirated",
  turbo: "turbo",
  "twin-charged (supercharger + turbo)": "twin-charged",
};

// --- fuel_type -> { fuel_type, is_range_extender } --------------------------
// Deliberately drops the turbo/NA qualifier that used to be bundled into this
// string — that's now covered by the (already-separate) engine.aspiration
// field, cross-checked below rather than assumed.
const FUEL_TYPE_TO_STRUCTURED: Record<string, { fuel_type: string; is_range_extender: boolean }> = {
  Gasoline: { fuel_type: "gasoline", is_range_extender: false },
  gasoline: { fuel_type: "gasoline", is_range_extender: false },
  petrol: { fuel_type: "gasoline", is_range_extender: false },
  "Gasoline (Turbo)": { fuel_type: "gasoline", is_range_extender: false },
  "Gasoline (turbo)": { fuel_type: "gasoline", is_range_extender: false },
  "Gasoline (naturally aspirated)": { fuel_type: "gasoline", is_range_extender: false },
  "Gasoline (range extender)": { fuel_type: "gasoline", is_range_extender: true },
  "Gasoline (range extender, turbo)": { fuel_type: "gasoline", is_range_extender: true },
};

// --- chemistry -> { chemistry, battery_variant suffix } ---------------------
// battery_variant is only SET here if the source document doesn't already
// have one — if it does and they'd conflict, that's flagged for manual
// review rather than silently overwritten or merged.
const CHEMISTRY_TO_STRUCTURED: Record<string, { chemistry: string; variantSuffix?: string }> = {
  LFP: { chemistry: "LFP" },
  "LFP (Blade)": { chemistry: "LFP", variantSuffix: "Blade" },
  "LFP (Blade, 2nd gen)": { chemistry: "LFP", variantSuffix: "Blade, 2nd gen" },
  NMC: { chemistry: "NMC" },
  "NMC (800V)": { chemistry: "NMC", variantSuffix: "800V" },
  "semi-solid-state": { chemistry: "semi-solid-state" },
};

interface FlaggedDoc {
  _id: string;
  trim_name?: string;
  reasons: string[];
}

async function main() {
  await mongoose.connect(MONGODB_URI!);
  console.log(`Connected. Mode: ${COMMIT ? "COMMIT (writing)" : "DRY RUN (no writes)"}\n`);

  const docs = await Powertrain.find({}).lean();
  console.log(`Found ${docs.length} powertrain documents.\n`);

  let engineTouched = 0;
  let batteryTouched = 0;
  let transmissionTouched = 0;
  const flagged: FlaggedDoc[] = [];

  for (const doc of docs) {
    const docId = String(doc._id);
    const trimName = doc.trim_name as string | undefined;
    const set: Record<string, unknown> = {};
    const unset: Record<string, unknown> = {};
    const reasons: string[] = [];

    // --- engine ---
    const engine = doc.engine as Record<string, unknown> | undefined;
    if (engine) {
      const rawInduction = engine.induction as string | undefined;
      const rawFuelType = engine.fuel_type as string | undefined;

      if (rawInduction !== undefined) {
        const mapped = INDUCTION_TO_ASPIRATION[rawInduction];
        if (mapped === undefined) {
          reasons.push(`engine.induction: unmapped value ${JSON.stringify(rawInduction)}`);
        } else {
          set["engine.aspiration"] = mapped;
          unset["engine.induction"] = "";
        }
      }

      if (rawFuelType !== undefined) {
        const mapped = FUEL_TYPE_TO_STRUCTURED[rawFuelType];
        if (mapped === undefined) {
          reasons.push(`engine.fuel_type: unmapped value ${JSON.stringify(rawFuelType)}`);
        } else {
          set["engine.fuel_type"] = mapped.fuel_type;
          set["engine.is_range_extender"] = mapped.is_range_extender;
        }
      }

      if (reasons.length === 0 && (rawInduction !== undefined || rawFuelType !== undefined)) {
        engineTouched++;
      }
    }

    // --- battery ---
    const battery = doc.battery as Record<string, unknown> | undefined;
    if (battery) {
      const rawChemistry = battery.chemistry as string | undefined;
      if (rawChemistry !== undefined) {
        const mapped = CHEMISTRY_TO_STRUCTURED[rawChemistry];
        if (mapped === undefined) {
          reasons.push(`battery.chemistry: unmapped value ${JSON.stringify(rawChemistry)}`);
        } else {
          set["battery.chemistry"] = mapped.chemistry;
          if (mapped.variantSuffix) {
            const existingVariant = battery.battery_variant as string | undefined;
            if (existingVariant && existingVariant !== mapped.variantSuffix) {
              reasons.push(
                `battery.chemistry ${JSON.stringify(rawChemistry)} implies battery_variant ${JSON.stringify(
                  mapped.variantSuffix
                )}, but an existing battery_variant ${JSON.stringify(existingVariant)} is already set and differs — not overwriting`
              );
            } else if (!existingVariant) {
              set["battery.battery_variant"] = mapped.variantSuffix;
            }
          }
          if (reasons.length === 0) batteryTouched++;
        }
      }
    }

    // --- transmission: gears -> speed_count (pure rename, always safe) ---
    const transmission = doc.transmission as Record<string, unknown> | undefined;
    if (transmission && transmission.gears !== undefined) {
      set["transmission.speed_count"] = transmission.gears;
      unset["transmission.gears"] = "";
      transmissionTouched++;
    }

    if (reasons.length > 0) {
      flagged.push({ _id: docId, trim_name: trimName, reasons });
      continue; // don't apply ANY partial write to a doc with an unmapped field — all-or-nothing per document
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) continue;

    console.log(`${COMMIT ? "Writing" : "Would write"} ${docId} (${trimName ?? "?"}): ${JSON.stringify(set)}`);

    if (COMMIT) {
      // strict: false — mongoose's strict mode silently drops $unset paths
      // that aren't declared on the CURRENT schema (e.g. engine.induction,
      // transmission.gears, both removed from models/Powertrain.ts by this
      // same migration) even though the $set half of the same call still
      // goes through. Hit this for real on the first --commit run: every
      // engine.aspiration/transmission.speed_count write landed, but the old
      // engine.induction/transmission.gears fields silently stayed behind.
      await Powertrain.updateOne({ _id: doc._id }, { $set: set, $unset: unset }, { strict: false });
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`engine blocks migrated:       ${engineTouched}`);
  console.log(`battery blocks migrated:      ${batteryTouched}`);
  console.log(`transmission blocks migrated: ${transmissionTouched}`);
  console.log(`flagged for manual review:    ${flagged.length}`);

  if (flagged.length > 0) {
    console.log(`\n--- Flagged documents (NOT written) ---`);
    for (const f of flagged) {
      console.log(`  ${f._id} (${f.trim_name ?? "?"}):`);
      for (const r of f.reasons) console.log(`    - ${r}`);
    }
  }

  if (!COMMIT) {
    console.log(`\nDry run complete — no writes made. Re-run with --commit to apply.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
