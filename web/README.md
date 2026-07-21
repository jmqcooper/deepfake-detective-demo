# web — Deepfake Detective Academy app

The runtime: one **Next.js 16** app (App Router, TypeScript, Tailwind). It serves the
five stations from a pre-generated sample pack plus a tiny stats API. No GPU, no models.

See the repo root [README.md](../README.md) for setup and [CONTRIBUTING.md](../CONTRIBUTING.md)
for where changes belong. This app needs a sample pack in `public/samples/` (generated,
gitignored) to show anything beyond the "run the sample pipeline" screen — generate one
with the Quick start in the root README.

```bash
npm ci
npm run dev     # http://localhost:3000
npm run lint
npm run build
```

Layout: `src/app/` pages + API routes · `src/components/stations/` the station UIs ·
`src/i18n/{nl,en}.json` all copy · `src/lib/` manifest loader, stats, SQLite.

> **Next.js 16 has breaking changes from older versions.** Read `AGENTS.md` before
> writing app code.
