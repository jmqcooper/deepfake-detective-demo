# Contributing

Thanks for helping out. This is a small, self-contained project — one Next.js app
plus an offline media pipeline.

## First contribution loop

1. Set up and boot the app with a local fixture — see **Quick start** in
   [README.md](README.md) (or run `make dev` from a fresh clone).
2. Make your change.
3. Run the checks (below) and confirm the app still boots at
   <http://localhost:3000>.
4. Open a PR.

## Where changes belong

| You want to change… | Edit… |
|---|---|
| A station's UI or behaviour | `web/src/components/stations/` |
| Shell, kiosk, attract/reset logic | `web/src/components/kiosk/`, `DemoShell.tsx` |
| Any user-visible text | `web/src/i18n/nl.json` **and** `web/src/i18n/en.json` |
| API routes / stats / SQLite | `web/src/app/api/`, `web/src/lib/` |
| The sample pack / manifest format | `tools/prepare_samples.py` + [SPEC.md](SPEC.md) |

## Required checks

```bash
cd web && npm run lint
cd web && npm run build
.venv/bin/python tools/prepare_samples.py --out web/public/samples --verify-only
```

Or `make check`.

## Rules that are easy to miss

- **`web/public/samples/` is generated and gitignored.** Never commit audio, images,
  or `manifest.json`. Regenerate them locally instead.
- **All copy is a key.** No hardcoded strings in components; add every string to both
  `nl.json` and `en.json`. Dutch is the default.
- **The manifest is the contract.** The app must not hardcode clip IDs — it reads
  `manifest.json`. Changing its shape means updating both `prepare_samples.py` and
  [SPEC.md](SPEC.md), and re-running `--verify-only`.
- **Next.js 16 differs from older versions.** Check `web/AGENTS.md` before writing app
  code.

## PR checklist

- [ ] `npm run lint` and `npm run build` pass.
- [ ] Samples verify (`--verify-only`), or the change doesn't touch the pipeline.
- [ ] New/changed copy is in both `nl.json` and `en.json`.
- [ ] No generated files (`web/public/samples/`, `data/`) committed.
- [ ] SPEC.md updated if a contract changed.
