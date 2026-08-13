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
| Shell, kiosk chrome, sound check | `web/src/components/kiosk/`, `DemoShell.tsx` |
| Screen order, skips, idle timeouts | `web/src/lib/kiosk-flow.ts` |
| Any user-visible text | `web/src/i18n/nl.json` **and** `web/src/i18n/en.json` |
| API routes / stats / SQLite | `web/src/app/api/`, `web/src/lib/` |
| The sample pack / manifest format | `tools/prepare_samples.py`, `web/src/lib/manifest-schema.ts` + [SPEC.md](SPEC.md) |

## Required checks

```bash
cd web && npm run check     # lint + typecheck + tests + production build
.venv/bin/python tools/prepare_samples.py --out web/public/samples --verify-only
```

Or `make check`. The individual steps are `npm run lint`, `npm run typecheck`,
`npm test` and `npm run build`; `npm run e2e` exercises the API over HTTP against a
running app. The root `make check` starts a production server and includes that
HTTP suite, while `npm run check` remains the in-process web check.

The test suite uses Node's built-in runner and type stripping — there is no test
framework to install, and `tests/loader.mjs` only maps the `@/` alias. Keep logic
that deserves a test in `web/src/lib/` (no React), which is why the stations are
thin and the contracts are not.

## Rules that are easy to miss

- **`web/public/samples/` is generated and gitignored.** Never commit audio, images,
  or `manifest.json`. Regenerate them locally instead.
- **All copy is a key.** No hardcoded strings in components; add every string to both
  `nl.json` and `en.json`. Dutch is the default.
- **The manifest is the contract, and there is only one copy of it.**
  `web/src/lib/manifest-schema.ts` is the single description of the pack; the client
  types re-export it. Changing the shape means updating that schema,
  `prepare_samples.py` and [SPEC.md](SPEC.md), then re-running `--verify-only`.
- **The client never says what something means.** It reports what the visitor did;
  the server resolves the label, derives correctness and derives the score. Do not
  add a `correct` or `score` field to a request.
- **A clue is not proof.** Copy about spectrogram tells must stay framed as evidence
  about the clips in the pack, and Echo must keep admitting he is reading prepared
  labels rather than analysing sound. See "Honesty rules" in [SPEC.md](SPEC.md).
- **Nothing may depend on audio having played.** Autoplay is blocked on most
  browsers and museum tablets are muted. Drive progression off `play`/`ended`, and
  show the failure.
- **Next.js 16 differs from older versions.** Check `web/AGENTS.md` before writing app
  code.

## PR checklist

- [ ] `npm run check` passes (lint, typecheck, tests, build).
- [ ] Samples verify (`--verify-only`), or the change doesn't touch the pipeline.
- [ ] New/changed copy is in both `nl.json` and `en.json`, with matching placeholders.
- [ ] The flow still fits a 320 px viewport with no horizontal scroll.
- [ ] No generated files (`web/public/samples/`, `data/`) committed.
- [ ] SPEC.md updated if a contract changed.
