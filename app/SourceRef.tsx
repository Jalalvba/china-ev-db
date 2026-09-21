// One place that decides how a source reference is shown, so an independently checkable URL and an
// attached document (dealership-ops-manual-v1's "ATTACHED: <title>") never look alike anywhere in the app.
// http(s) -> link. ATTACHED -> amber badge saying it cannot be independently checked. Anything else
// (older free-text sources like "官方质保政策页") -> plain text.

const ATTACHED = /^ATTACHED:\s*(.+)$/i;

export function isAttachedSource(s?: string | null): boolean {
  return !!s && ATTACHED.test(s.trim());
}

export default function SourceRef({ source, label = "source" }: { source?: string | null; label?: string }) {
  if (!source) return null;
  const s = source.trim();
  const att = s.match(ATTACHED);
  if (att) {
    return (
      <span
        title={`Attached document: ${att[1]}. Provided directly to the researcher — not independently checkable from this page.`}
        className="ml-1 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-medium align-middle"
      >
        attached doc: {att[1]} · not independently checkable
      </span>
    );
  }
  if (/^https?:\/\//i.test(s)) {
    return (
      <a href={s} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline ml-1">
        {label}
      </a>
    );
  }
  return <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-1">{s}</span>;
}
