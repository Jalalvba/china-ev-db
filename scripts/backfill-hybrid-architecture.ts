// One-off backfill for existing PHEV/HEV/REEV trims (Part 3 of the tech-spec
// enhancement task): extracts hybrid_system_name and displacement_l from
// trim_name text, then maps hybrid_architecture from hybrid_system_name via
// lib/hybridArchitecture.ts. Deliberately does NOT touch engineTorqueNm,
// motorTorqueNm, evOnlyRangeKm, or combinedSystemHp — those stay null until
// sourced from manufacturer spec sheets, per the task's explicit "do not
// estimate/calculate these" instruction.
//
// Usage:
//   pnpm tsx scripts/backfill-hybrid-architecture.ts           # dry run
//   pnpm tsx scripts/backfill-hybrid-architecture.ts --write   # apply

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import Powertrain from "../models/Powertrain";
import { extractHybridSystemName, extractDisplacementL, architectureForSystemName } from "../lib/hybridArchitecture";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

async function run() {
  const write = process.argv.includes("--write");

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. ${write ? "WRITE mode" : "DRY RUN (pass --write to apply)"}.\n`);

  // Hybrid/PHEV/REEV trims only — mild hybrids and pure ICE/BEV trims have no
  // hybrid_architecture to classify (see HybridArchitecture's doc comment).
  const trims = await Powertrain.find({ energy_type: { $in: ["HEV", "PHEV", "REEV/EREV"] } }).lean();
  console.log(`Found ${trims.length} HEV/PHEV/REEV trim(s).\n`);

  let systemNameFound = 0;
  let architectureMapped = 0;
  let unverified = 0;
  let displacementFound = 0;

  for (const trim of trims) {
    const update: Record<string, unknown> = {};

    if (!trim.hybrid_system_name) {
      const systemName = extractHybridSystemName(trim.trim_name);
      if (systemName) {
        update.hybrid_system_name = systemName;
        systemNameFound++;
      }
    }

    const systemName = (update.hybrid_system_name as string | undefined) ?? trim.hybrid_system_name;
    if (trim.hybrid_architecture == null && !trim.architecture_unverified) {
      const { architecture, verified } = architectureForSystemName(systemName);
      if (architecture) {
        update.hybrid_architecture = architecture;
        update.architecture_unverified = !verified;
        architectureMapped++;
      } else {
        // FALLBACK METHOD (task spec Part 2): no known hybridSystemName, or an
        // unmapped one — never guess from battery size, flag for manual
        // verification against manufacturer spec sheets instead.
        update.architecture_unverified = true;
        unverified++;
      }
    }

    if (!trim.engine?.displacement_l) {
      const displacement = extractDisplacementL(trim.trim_name);
      if (displacement) {
        update["engine.displacement_l"] = displacement;
        displacementFound++;
      }
    }

    if (Object.keys(update).length === 0) continue;

    console.log(`  ${trim.trim_name}: ${JSON.stringify(update)}`);
    if (write) {
      await Powertrain.updateOne({ _id: trim._id }, { $set: update });
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`hybrid_system_name extracted: ${systemNameFound}`);
  console.log(`hybrid_architecture mapped: ${architectureMapped}`);
  console.log(`flagged architecture_unverified (unmapped): ${unverified}`);
  console.log(`displacement_l extracted: ${displacementFound}`);
  if (!write) console.log(`\nDry run only — re-run with --write to apply.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
