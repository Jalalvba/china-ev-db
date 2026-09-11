import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="bg-zinc-900 text-white sticky top-0 z-10">
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
            <a href="/compare" className="text-sm text-zinc-300 hover:text-white">
              Compare
            </a>
          </nav>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
