// One-time migration applying the corrections from the DeepSeek Huawei/
// ecosystem audit (see conversation history — no ticket). Confirmed first
// that parent_group does NOT contain Moroccan distributor strings (that was
// a misread of flattened pasted text; MoroccoListing is already a separate
// collection) before touching anything.
//
// Usage:
//   npm run fix-deepseek-audit -- --dry-run   (prints the diff, writes nothing)
//   npm run fix-deepseek-audit                (prints the diff, then applies it)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import Brand from "../models/Brand";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const DRY_RUN = process.argv.includes("--dry-run");

// Genuine Huawei HIMA alliance members (5 brands).
const HIMA_MEMBERS = ["AITO", "Luxeed", "Stelato", "Maestro", "Shangjie"];
// Real, but non-HIMA, Huawei technology partnerships.
const NON_HIMA_HUAWEI_PARTNERS = ["Yijing", "Qijing"];
// Had tech_partner: "Huawei" tagged with no relationship justifying it at
// that level — remove the field; some get a status_note instead.
const REMOVE_HUAWEI_TAG: Record<string, string | undefined> = {
  "Dongfeng eπ": "Supplier-level cooperation with Huawei on select components; not a co-development partnership.",
  "M-Hero": "Supplier-level cooperation with Huawei on select components; not a co-development partnership.",
  Voyah: "Supplier-level cooperation with Huawei on select components; not a co-development partnership.",
  "Dongfeng Liuzhou Motor": undefined,
  "Dongfeng Fengxing (Forthing)": undefined,
  "Dongfeng Nammi": undefined,
  Qingzhou: undefined,
};

// Matched against actual DB brand names. MG has no standalone Brand document
// (it's folded into "SAIC (Roewe/MG)"); FAW and Xinyuan have no top-level
// Brand document either (only sub-brands like FAW Jilin/Xiali/Yueyi exist) —
// skipped rather than guessed at.
const EXPORT_RELEVANT_TRUE = [
  "BYD",
  "GWM (Great Wall Motor)",
  "Geely",
  "Chery",
  "JAC Group",
  "JMC",
  "NIO",
  "Leapmotor",
  "Dongfeng",
  "SAIC (Roewe/MG)",
  "GAC Aion",
  "Xiaomi Auto",
];

async function main() {
  await mongoose.connect(MONGODB_URI!);
  console.log(DRY_RUN ? "DRY RUN — no writes will be made\n" : "APPLYING CHANGES\n");

  // --- Item 0: verify parent_group has no Moroccan distributor strings ---
  const suspicious = await Brand.find({
    parent_group: { $regex: /auto hall|comicom|smeia|sopriam|cfao|dealer|distribut/i },
  }).lean();
  if (suspicious.length > 0) {
    console.error("UNEXPECTED: found parent_group values matching distributor-like strings:");
    for (const b of suspicious) console.error(` - ${b.name}: ${b.parent_group}`);
    throw new Error("Aborting — parent_group contamination found, needs manual review.");
  }
  console.log("Verified: no Moroccan distributor strings in parent_group. Proceeding.\n");

  // --- Item 1: Geely — remove Renault Group reference ---
  const geely = await Brand.findOne({ name: "Geely" });
  if (geely) {
    const before = { parent_group: geely.parent_group, tech_partner: geely.tech_partner };
    let changed = false;
    if (geely.parent_group && /renault/i.test(geely.parent_group)) {
      geely.parent_group = undefined;
      changed = true;
    }
    if (geely.tech_partner && /renault/i.test(geely.tech_partner)) {
      geely.tech_partner = undefined;
      changed = true;
    }
    if (changed) {
      geely.status_note =
        "Horse Powertrain: 50/50 JV with Renault + Saudi Aramco (powertrain supply only, not an ownership/ecosystem relationship). Geely also holds a 26.4% minority stake in Renault do Brasil.";
      console.log(`Geely: ${JSON.stringify(before)} -> parent_group=${geely.parent_group}, tech_partner=${geely.tech_partner}, status_note set`);
      if (!DRY_RUN) await geely.save();
    } else {
      console.log("Geely: no Renault reference found, nothing to change.");
    }
  }

  // --- Item 2: Chery — remove top-level Huawei tech_partner ---
  const chery = await Brand.findOne({ name: "Chery" });
  if (chery && chery.tech_partner) {
    console.log(`Chery: removing tech_partner="${chery.tech_partner}"`);
    if (!DRY_RUN) {
      chery.tech_partner = undefined;
      await chery.save();
    }
  }

  // --- Item 3: HIMA members keep tech_partner=Huawei + note ---
  for (const name of HIMA_MEMBERS) {
    const b = await Brand.findOne({ name });
    if (!b) continue;
    const note = "HIMA (Harmony Intelligent Mobility Alliance) member.";
    if (b.tech_partner !== "Huawei" || b.status_note !== note) {
      console.log(`${name}: tech_partner -> "Huawei", status_note -> "${note}"`);
      if (!DRY_RUN) {
        b.tech_partner = "Huawei";
        b.status_note = note;
        await b.save();
      }
    }
  }

  // --- Item 3: Yijing/Qijing — real but non-HIMA Huawei partnerships ---
  for (const name of NON_HIMA_HUAWEI_PARTNERS) {
    const b = await Brand.findOne({ name });
    if (!b) continue;
    const note = "Separate Huawei technology partnership (not a HIMA alliance member).";
    if (b.tech_partner !== "Huawei" || b.status_note !== note) {
      console.log(`${name}: tech_partner -> "Huawei", status_note -> "${note}"`);
      if (!DRY_RUN) {
        b.tech_partner = "Huawei";
        b.status_note = note;
        await b.save();
      }
    }
  }

  // --- Item 4: remove unjustified Huawei tags ---
  for (const [name, note] of Object.entries(REMOVE_HUAWEI_TAG)) {
    const b = await Brand.findOne({ name });
    if (!b) continue;
    if (b.tech_partner) {
      console.log(`${name}: removing tech_partner="${b.tech_partner}"${note ? `, status_note -> "${note}"` : ""}`);
      if (!DRY_RUN) {
        b.tech_partner = undefined;
        if (note) b.status_note = note;
        await b.save();
      }
    }
  }

  // --- Item 5: remove HIMA as a standalone Brand document ---
  const hima = await Brand.findOne({ name: { $regex: /^HIMA/i } });
  if (hima) {
    console.log(`Deleting standalone Brand document: "${hima.name}" (alliance, not a vehicle brand)`);
    if (!DRY_RUN) await Brand.deleteOne({ _id: hima._id });
  }

  // --- Item 7: export_relevant flag ---
  for (const name of EXPORT_RELEVANT_TRUE) {
    const b = await Brand.findOne({ name });
    if (!b) continue;
    if (b.export_relevant !== true) {
      console.log(`${name}: export_relevant -> true`);
      if (!DRY_RUN) {
        b.export_relevant = true;
        await b.save();
      }
    }
  }
  // Uncertain brands are deliberately left untouched (undefined, not false).

  console.log("\nDone." + (DRY_RUN ? " Re-run without --dry-run to apply." : ""));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
