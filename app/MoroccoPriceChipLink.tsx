"use client";

export default function MoroccoPriceChipLink({
  href,
  title,
  priceDh,
}: {
  href: string;
  title?: string;
  priceDh: number;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:underline"
    >
      💰 {priceDh.toLocaleString()} DH
    </a>
  );
}
