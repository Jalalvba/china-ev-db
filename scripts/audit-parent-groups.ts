// Read-only audit of Brand.parent_group against the write-time rule in lib/brandParentGroup.ts.
// Reports brands whose CURRENT parent_group would be rejected if written today (legacy drift — the hooks
// only fire on writes, so these are never caught otherwise) as findings (exit 1), and lists valid-but-
// siblingless parents as info. Never writes.
//   npm run audit-brand-groups
import "dotenv/config";
import mongoose from "mongoose";
import { checkParentGroup, KNOWN_PARENT_GROUP_KEYS } from "../lib/brandParentGroup";
import { groupBrands } from "../lib/brandGrouping";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI");

async function main() {
  await mongoose.connect(MONGODB_URI as string);
  const rows = (await mongoose.connection.db!.collection("brands").find({}).toArray()).map((b) => ({ ...b, _id: String(b._id) })) as unknown as Parameters<typeof groupBrands>[0];
  const names = new Set(rows.map((b) => b.name));

  let findings = 0;
  for (const b of rows) {
    const r = checkParentGroup(b.parent_group, names, b.name);
    if (!r.ok) {
      findings++;
      console.log(`INVALID   ${b.name}: parent_group ${JSON.stringify(b.parent_group)} — ${r.reason}`);
    }
  }
  const { groups, standalone } = groupBrands(rows);
  for (const b of standalone) {
    if (b.parent_group && checkParentGroup(b.parent_group, names, b.name).ok) {
      // Info only, not a finding: a valid parent with no sibling brand on file (AIVA, Baojun, FAW Yueyi…) is legitimately alone.
      console.log(`info      ${b.name}: parent_group ${JSON.stringify(b.parent_group)} is valid but no sibling brand shares it, so it lists under "Independent brands"`);
    }
  }
  console.log(`\n${rows.length} brands, ${groups.length} groups, ${standalone.length} independent, ${KNOWN_PARENT_GROUP_KEYS.length} known group keys. ${findings} finding(s).`);
  await mongoose.disconnect();
  process.exit(findings > 0 ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
