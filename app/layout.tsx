import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeToggle, { ThemeInitScript } from "./ThemeToggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "China EV/ICE Database",
  description: "Catalog of Chinese automotive brands, models, and powertrain specs",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeInitScript />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <header className="bg-zinc-900 dark:bg-black text-white sticky top-0 z-10">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-4">
            <a href="/" className="font-bold text-lg tracking-tight">
              China EV/ICE Database
            </a>
            <a href="/" className="text-sm text-zinc-300 hover:text-white">
              Brands
            </a>
            <a href="/search" className="text-sm text-zinc-300 hover:text-white">
              Search
            </a>
            <a href="/search/specs" className="text-sm text-zinc-300 hover:text-white">
              Tech Search
            </a>
            <a href="/compare" className="text-sm text-zinc-300 hover:text-white">
              Compare
            </a>
            <a href="/warranty" className="text-sm text-zinc-300 hover:text-white">
              Warranty
            </a>
            <a href="/workshop" className="text-sm text-zinc-300 hover:text-white">
              Workshop
            </a>
            <a href="/workshop-phev-suv" className="text-sm text-zinc-300 hover:text-white">
              PHEV/REEV SUV Workshop
            </a>
            <a href="/known-issues" className="text-sm text-zinc-300 hover:text-white">
              Known Issues
            </a>
            <a href="/benchmarking" className="text-sm text-zinc-300 hover:text-white">
              Benchmarking
            </a>
            {/* One deck exists, so this links to it directly. When a second deck is added, point this at a /presentations listing page instead. */}
            <a href="/presentations/phev-market" className="text-sm text-zinc-300 hover:text-white">
              PHEV Market Deck
            </a>
            <a href="/export" className="text-sm text-zinc-300 hover:text-white">
              Export
            </a>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </nav>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
