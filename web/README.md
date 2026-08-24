# web — ilcc-deepfake app

The runtime is one **Next.js 16** app (App Router, TypeScript, Tailwind). It serves
Stations 1–4 and the safety finale from a pre-generated sample pack, plus a tiny
stats API. The optional native voice service adds the cloning station; when that
service is not live, the client removes the station from the route. The web
runtime itself needs no GPU or model weights.

See the repo root [README.md](../README.md) for setup and [CONTRIBUTING.md](../CONTRIBUTING.md)
for where changes belong. The hand-selected Dutch/English sample pack in
`public/samples/` is bundled with the repository and used automatically.

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
