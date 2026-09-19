import { notFound } from "next/navigation";
import DeckViewer from "@/components/presentations/DeckViewer";
import { DECKS } from "@/lib/presentations/decks";
import { resolveDeck } from "@/lib/presentations/resolve";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ deck: string }> }) {
  const { deck } = await params;
  const spec = DECKS[deck];
  if (!spec) notFound();
  const resolved = await resolveDeck(spec);
  return <DeckViewer deck={resolved} />;
}
