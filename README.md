# China EV DB

A database of Chinese-market EVs/ICE/hybrids, cross-referenced against Morocco-market
pricing and availability. Browse and compare vehicles by brand, spec, and price;
research is AI-assisted (real web search + an LLM, see below).

**Stack:** Next.js (App Router) + MongoDB/Mongoose, deployed on Vercel.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:
- `MONGODB_URI` — a MongoDB connection string.
- `AI_GATEWAY_API_KEY` — for AI-assisted research (spec/brand/pricing lookups). Create
  one at [Vercel AI Gateway](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys),
  or leave blank and run `vercel link && vercel env pull` for local OIDC auth instead.
- `SEARCH_API_KEY` — a free [Brave Search API](https://api.search.brave.com/app/keys)
  key, used to fetch real search results before any AI call.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project layout

- `app/` — Next.js pages, API routes, and client components.
- `models/` — Mongoose schemas (`Brand`, `Model`, `Powertrain`, `MoroccoListing`).
- `lib/` — shared logic: the AI research pipeline (`aiProvider.ts`, `webSearch.ts`,
  `groundedResearch.ts`, `techSpecResearch.ts`, `brandResearch.ts`,
  `modelDiscovery.ts`), data scrapers, and display helpers.
- `scripts/` — CLI tools for batch research/import/price-sync (run via `npm run
  <script-name>` — see `package.json`).
- `types/` — shared TypeScript types, including the canonical Powertrain schema that
  the database, prompts, and validation all derive from.

For project conventions, the data model, and other durable notes, see `CLAUDE.md`.

## Deployment

Deployed on [Vercel](https://vercel.com). Pushing to `main` triggers a production
deploy automatically.
