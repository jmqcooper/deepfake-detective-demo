# Secrets and environment

`web/.env.schema` is the contract for every process in this repository. It holds
names, types, sensitivity and what is required. It never holds a value. Code keeps
reading `process.env` and `os.getenv`.

| Where | Values come from | Checked by |
|---|---|---|
| Docker install | The root `.env` through Compose, then the image's defaults | `web/scripts/env/start-image.mjs`, before the server starts |
| Development machine | Process env, `web/.env.local`, `web/.env`, then Infisical | `npm run dev` |
| Build, `npm run start`, CI | Process env and the `web/.env*` files | The same check, with no store |
| Installed voice host | The installer or the systemd unit | `tools/voice_settings.py`, in Python |
| Developer voice service | Same as a development machine | `make voice-dev` |

Infisical serves development machines only. The image, CI and installed hosts never
read it, so a store outage or a locked keyring cannot stop an exhibit. The image and
downloaded archives leave out `web/.env.infisical`.

## Profiles

| Profile | When | Effect |
|---|---|---|
| `installed` | The container image sets it | `STATS_DRIVER`, and `DATABASE_PATH` unless the driver is `memory`, must be present |
| `production` | `npm run build`, `npm run start`, `NODE_ENV=production` or `CI` | Types only, no store |
| `development` | Everything else | Types only, and Infisical loads |

Nothing about voice cloning is required in any profile. Without a live voice service
the app hides the cloning station, as it always has.

A bad image environment stops the container before the server starts. The log names
the keys and prints no values:

```text
[env] Invalid or missing: VOICE_CLONE_URL. See docs/SECRETS.md.
```

Compose restarts the container with the same result until `.env` is fixed. The
installer shows this line when the app does not become healthy.

## The installed voice token

The web installer generates `VOICE_CLONE_TOKEN` in the root `.env`, one per install,
and the voice installer reads it from there. That pairing does not use Varlock. Never
copy an installed token into Infisical. The `dev` environment of the store may hold
an approved development value, and nothing else.

## Set up a new machine

Each machine has one Infisical machine identity with Viewer access to this project
in the EU region. Its client ID and locally encrypted client secret live in
`~/.config/varlock/.env.infisical`, mode 0600, shared by every project on that
machine. `web/.env.infisical` holds the site, environment and project ID, all public.

Without that file, `npm run dev` says so and runs on local values. With it, a refused
or unreachable store stops `npm run dev`. Start from npm: plain `next dev` prints the
same error and can then serve an empty environment.

To work offline or with a locked keyring, switch the store off for one command:

```bash
ILCC_SHARED_SECRETS=off npm run dev
```

## Local files

`web/.env.local` and `web/.env` work as before and win over the store. A blank line
in them does not hide a store value.

The root `.env` belongs to Compose and the installers. It holds container paths such
as `/app/data/stats.db`, so the native app never reads it.

`next dev` receives declared `#web` names only. A name missing from the schema or from
that tag will not reach the app, even from `web/.env.local`.

## Add a variable

Declare the name before reading it. `npm run check:env` runs `varlock audit` over the
code and fails on an undeclared read or a name no code reads. `tests/env-contract.test.ts`
checks that each process's readers carry its tag.

- Give it the tags of its processes, and its type.
- Check numbers and flags with an anchored regular expression, as the existing entries
  do. Varlock's `number` type passes `90days` as 90, and its `boolean` type accepts
  words the readers do not.
- Add `@sensitive=false` to anything that can appear in logs or responses. Everything
  else is secret by default, and a build fails when a secret reaches a page or a chunk.
- A value the voice service reads also goes in `tools/tests/voice-env-cases.json`, which
  the schema and the Python readers both have to pass.
- Add `@required=forEnv(installed)` only if an exhibit truly cannot run without it,
  because every existing install then has to set it.

## Read values safely

```bash
cd web
npx varlock load --agent                      # web values with secrets redacted
npx varlock load --agent --filter '#voice'    # another process
npx varlock explain VOICE_CLONE_URL           # where one value came from
```

`varlock load --format json`, `env` and `shell` print raw values. Varlock's own failure
report can print values too, which is why every start script prints keys alone.

## The voice service

An installed voice host has Python and no Node, so it never runs Varlock.
`tools/voice_settings.py` reads the environment once at startup. A malformed number or
device stops the service there, and a blank number counts as unset.

A developer can start the service with values from the contract:

```bash
make voice-dev
```

## Scanning

`npm ci` turns on `.githooks/pre-commit`. The hook copies the staged files out of the Git
index into a private folder under `/tmp`, scans that copy and removes it, so it checks
what the commit will hold. It also looks for the installed token from the root `.env`,
which the schema never loads. Varlock's report can print the values it finds, so the hook
hides it and prints one fixed line.

With an identity on the machine the scan reads the store, which needs the network and,
on a Mac, Touch ID. Commit with `ILCC_SHARED_SECRETS=off` when offline. That scan covers
local values only.

## Run an agent through the credential proxy

```bash
cd web
npm run agent:proxy -- claude
```

The agent gets a placeholder or nothing for each secret. When it calls a host with an
`@proxy` rule, Varlock swaps in the real value on that connection. Only `huggingface.co` has a rule, so Claude Code
and Codex traffic passes through untouched and they keep their own sign-in.
`npx varlock proxy rules` lists what each secret becomes.

- Same user, same machine. This raises the bar, and only a sandbox makes it a boundary.
- `@proxyConfig={egress="strict"}` stays off. It would send subscription traffic through
  TLS interception.
- The agent has no real voice token, so it cannot authenticate to a voice service that
  needs one. Start the web app and the voice service from a normal terminal beside the agent.
- The script wraps a terminal launch. A session started by a host app is not wrapped.

## Test fixtures

Varlock's Linux helper keeps one private key per user, ignores `HOME` and finds the
session bus by itself. A fixture that creates a key under a temporary `HOME` replaces the
real one. Run every Varlock fixture through `sealedEnv` in
`web/tests/helpers/isolated-varlock.ts`, which sets a dead bus address and inherits
nothing but `PATH`.
