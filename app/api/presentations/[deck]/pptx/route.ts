import { DECKS } from "@/lib/presentations/decks";
import { resolveDeck } from "@/lib/presentations/resolve";
import { buildPptx } from "@/lib/presentations/pptxExport";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ deck: string }> }) {
  const { deck } = await params;
  const spec = DECKS[deck];
  if (!spec) return new Response("Unknown deck", { status: 404 });
  const file = await buildPptx(await resolveDeck(spec));
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${deck}.pptx"`,
    },
  });
}
