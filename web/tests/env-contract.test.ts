import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  REPO_ROOT,
  WEB_ROOT,
  mockStore,
  sealedEnv,
  workspace,
  run,
  type Workspace,
} from "./helpers/isolated-varlock.ts";

const INSTALLED = { ILCC_ENV_PROFILE: "installed" };
const repoFile = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\0").filter(Boolean);

let space: Workspace;
before(() => {
  space = workspace();
});
after(() => space.cleanup());

describe("what each profile needs", () => {
  test("a build, a CI job and a developer need nothing set", async () => {
    const unset: Array<Record<string, string>> = [{}, { CI: "true" }, { NODE_ENV: "production" }];
    for (const values of unset) {
      assert.deepEqual((await space.load(values)).invalid, []);
    }
  });

  test("a local Docker install needs its stats settings and nothing about voice", async () => {
    assert.deepEqual((await space.load(INSTALLED)).invalid, ["DATABASE_PATH", "STATS_DRIVER"]);
    const installed = {
      ...INSTALLED,
      NODE_ENV: "production",
      STATS_DRIVER: "sqlite",
      DATABASE_PATH: "/app/data/stats.db",
    };
    assert.deepEqual((await space.load(installed)).invalid, []);
    assert.deepEqual((await space.load({ ...INSTALLED, STATS_DRIVER: "memory" })).invalid, []);
  });

  test("a blank stats setting counts as missing where it would leave stats off", async () => {
    const blank = { ...INSTALLED, STATS_DRIVER: "", DATABASE_PATH: "" };
    assert.deepEqual((await space.load(blank)).invalid, ["DATABASE_PATH", "STATS_DRIVER"]);
    assert.deepEqual((await space.load({ ...INSTALLED, STATS_DRIVER: "sqlite", DATABASE_PATH: "" })).invalid, [
      "DATABASE_PATH",
    ]);
  });

  test("an unknown profile is refused", async () => {
    const result = await space.load({ ILCC_ENV_PROFILE: "staging" });
    assert.notEqual(result.status, 0);
  });
});

describe("values reach each reader as written", () => {
  test("numbers are checked as the text the readers parse", async () => {
    for (const value of ["90", " 90 ", "+90", "-5", "0", "99999"]) {
      const result = await space.load({ STATS_RETENTION_DAYS: value });
      assert.deepEqual(result.invalid, [], value);
      assert.equal(result.values.STATS_RETENTION_DAYS, value);
      assert.ok(Number.isFinite(Number.parseInt(value, 10)), value);
    }
    for (const value of ["90days", "1e3", "0x10", "9.5", "abc"]) {
      assert.deepEqual((await space.load({ STATS_RETENTION_DAYS: value })).invalid, ["STATS_RETENTION_DAYS"], value);
    }
  });

  test("the port accepts what the server can bind and refuses what parseInt would cut short", async () => {
    for (const value of ["3000", " 3000 ", "0", "65535"]) {
      assert.deepEqual((await space.load({ PORT: value })).invalid, [], value);
    }
    for (const value of ["3000abc", "65536", "-1", "http"]) {
      assert.deepEqual((await space.load({ PORT: value })).invalid, ["PORT"], value);
    }
  });

  test("the stats driver keeps the exact spellings its reader accepts", async () => {
    for (const value of ["memory", "sqlite"]) {
      assert.deepEqual((await space.load({ STATS_DRIVER: value })).invalid, [], value);
    }
    for (const value of ["SQLite", " sqlite", "postgres"]) {
      assert.ok((await space.load({ STATS_DRIVER: value })).invalid.includes("STATS_DRIVER"), value);
    }
  });

  test("a blank optional value stays blank", async () => {
    const blanks = { VOICE_CLONE_URL: "", VOICE_CLONE_TOKEN: "", STATS_RETENTION_DAYS: "", REPORT_TIMEZONE: "" };
    const result = await space.load(blanks);
    assert.deepEqual(result.invalid, []);
    for (const key of Object.keys(blanks)) assert.equal(result.values[key], "", key);
  });

  test("the voice link keeps its exact text and refuses a bare host and port", async () => {
    for (const value of ["http://host.docker.internal:8765", "http://127.0.0.1:8765", "https://voice.example"]) {
      const result = await space.load({ VOICE_CLONE_URL: value });
      assert.deepEqual(result.invalid, [], value);
      assert.equal(result.values.VOICE_CLONE_URL, value);
    }
    for (const value of ["host.docker.internal:8765", "ftp://voice.example", "not a url"]) {
      assert.deepEqual((await space.load({ VOICE_CLONE_URL: value })).invalid, ["VOICE_CLONE_URL"], value);
    }
  });

  test("a host's own TZ form never stops the app", async () => {
    assert.deepEqual((await space.load({ TZ: ":/etc/localtime", REPORT_TIMEZONE: "Nowhere/Land" })).invalid, []);
  });

  test("the voice rules match the Python readers case for case", async () => {
    // tools/tests/test_voice_settings.py runs these same cases through the service's readers.
    const cases = JSON.parse(repoFile("tools/tests/voice-env-cases.json")) as Record<
      "accepted" | "rejected",
      Record<string, string[]>
    >;
    const rounds = (byName: Record<string, string[]>) => {
      const longest = Math.max(...Object.values(byName).map((values) => values.length));
      return Array.from({ length: longest }, (_, round) =>
        Object.fromEntries(
          Object.entries(byName).flatMap(([name, values]) =>
            round < values.length ? [[name, values[round]]] : [],
          ),
        ),
      );
    };
    for (const values of rounds(cases.accepted)) {
      assert.deepEqual((await space.load(values, "#voice")).invalid, [], JSON.stringify(values));
    }
    for (const values of rounds(cases.rejected)) {
      const result = await space.load(values, "#voice");
      assert.deepEqual(result.invalid, Object.keys(values).sort(), JSON.stringify(values));
    }
  });
});

describe("the shared store", () => {
  const STORED = { VOICE_CLONE_URL: "http://store.example:8765", VOICE_CLONE_TOKEN: "store-dev-token" };

  test("serves development from the project's public location", async (t) => {
    const store = await mockStore(STORED);
    t.after(store.close);
    const local = workspace();
    t.after(local.cleanup);
    local.addIdentity();
    const result = await local.load({ INFISICAL_SITE_URL: store.url });
    assert.equal(result.values.VOICE_CLONE_URL, STORED.VOICE_CLONE_URL);
    assert.ok(store.calls.some((call) => /workspaceId=d94dd105-6501-4335-933a-9fee64af98b4&environment=dev/.test(call)));
    assert.match(readFileSync(join(WEB_ROOT, ".env.infisical"), "utf8"), /^INFISICAL_SITE_URL=https:\/\/eu\.infisical\.com$/m);
  });

  test("local values win over the store, and the process wins over both", async (t) => {
    const store = await mockStore(STORED);
    t.after(store.close);
    const local = workspace();
    t.after(local.cleanup);
    local.addIdentity();
    writeFileSync(join(local.app, ".env"), "VOICE_CLONE_URL=http://dotenv.example:1\n");
    writeFileSync(join(local.app, ".env.local"), "VOICE_CLONE_URL=http://local.example:2\n");
    const site = { INFISICAL_SITE_URL: store.url };
    assert.equal((await local.load(site)).values.VOICE_CLONE_URL, "http://local.example:2");
    const fromProcess = await local.load({ ...site, VOICE_CLONE_URL: "http://process.example:3" });
    assert.equal(fromProcess.values.VOICE_CLONE_URL, "http://process.example:3");
  });

  test("never answers a build, a CI job, an install or a switched-off process", async (t) => {
    const store = await mockStore(STORED);
    t.after(store.close);
    const local = workspace();
    t.after(local.cleanup);
    local.addIdentity();
    const site = { INFISICAL_SITE_URL: store.url };
    const elsewhere: Array<Record<string, string>> = [
      { NODE_ENV: "production" },
      { CI: "true" },
      { ILCC_ENV_PROFILE: "production" },
      { ...INSTALLED, STATS_DRIVER: "memory" },
      { ILCC_SHARED_SECRETS: "off" },
    ];
    for (const values of elsewhere) {
      const result = await local.load({ ...site, ...values });
      assert.equal(result.status, 0, JSON.stringify(values));
      assert.equal(result.values.VOICE_CLONE_URL, undefined);
    }
    assert.deepEqual(store.calls, []);
  });

  test("a configured store that refuses or cannot be reached stops the load", async (t) => {
    const refusing = await mockStore(STORED, true);
    t.after(refusing.close);
    const local = workspace();
    t.after(local.cleanup);
    local.addIdentity();
    for (const site of [refusing.url, "http://127.0.0.1:9"]) {
      const result = await local.load({ INFISICAL_SITE_URL: site });
      assert.notEqual(result.status, 0, site);
      assert.equal(result.rootErrors.length, 1, site);
    }
  });

  test("a machine with no identity keeps working on its local values", async (t) => {
    const local = workspace();
    t.after(local.cleanup);
    writeFileSync(join(local.app, ".env.local"), "VOICE_CLONE_URL=http://local.example:2\n");
    const result = await local.load();
    assert.equal(result.status, 0);
    assert.equal(result.values.VOICE_CLONE_URL, "http://local.example:2");
  });

  test("the repository holds the store's location and no credential", () => {
    const text = repoFile("web/.env.infisical");
    assert.match(text, /^INFISICAL_CLIENT_ID=$/m);
    assert.match(text, /^INFISICAL_CLIENT_SECRET=$/m);
  });
});

describe("undeclared variables", () => {
  const VARLOCK = join(WEB_ROOT, "node_modules/.bin/varlock");
  const auditScript = () =>
    (JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts[
      "check:env"
    ];

  test("every reader in the repository is declared, and every name has a reader", async (t) => {
    const local = workspace();
    t.after(local.cleanup);
    const [, ...targets] = auditScript().replace(/^varlock /, "").split(" ");
    const result = await run(VARLOCK, ["audit", ...targets], { cwd: WEB_ROOT, env: sealedEnv(local.home) });
    assert.equal(result.status, 0, result.stderr);
  });

  test("the audit catches a new read in JavaScript, Python and shell", async (t) => {
    const name = "NEW_SETTING";
    const reads: Record<string, string> = {
      "src/new.ts": `export const value = process.env.${name};\n`,
      "src/new.py": `import os\nvalue = os.environ.get("${name}", "x")\n`,
      "src/new.sh": `echo "$\{${name}:-default}"\n`,
    };
    for (const [path, source] of Object.entries(reads)) {
      const local = workspace();
      t.after(local.cleanup);
      mkdirSync(dirname(join(local.app, path)), { recursive: true });
      writeFileSync(join(local.app, path), source);
      const result = await local.varlock(["audit", "src"]);
      assert.notEqual(result.status, 0, path);
      assert.match(result.stderr, /Missing in schema \(1\)/, path);
    }
  });

  test("no tracked source can hide from the audit, which skips files with a NUL byte", () => {
    const sources = trackedFiles().filter((file) => /\.(ts|tsx|mjs|py|sh|slurm)$/.test(file));
    assert.ok(sources.length > 50);
    assert.deepEqual(sources.filter((file) => readFileSync(join(REPO_ROOT, file)).includes(0)), []);
  });

  test("each runtime's readers carry that runtime's tag", async () => {
    const reads = (file: string, pattern: RegExp) => [...repoFile(file).matchAll(pattern)].map((match) => match[1]);
    const nodeRead = /process\.env\.([A-Z][A-Z0-9_]*)/g;
    const webSources = trackedFiles().filter((file) => /^web\/src\/.*\.tsx?$/.test(file));
    const webReads = webSources.flatMap((file) => reads(file, nodeRead));
    const expected = {
      "#web": webReads,
      "#ops": reads("ops/stats-maintenance.mjs", nodeRead),
      "#voice": reads("tools/voice_settings.py", /os\.getenv\("([A-Z][A-Z0-9_]*)"/g),
    };
    assert.ok(webReads.includes("VOICE_CLONE_TOKEN"));
    for (const [filter, names] of Object.entries(expected)) {
      const declared = (await space.varlock(["load", "--format", "json-full", "--filter", filter])).stdout;
      const keys = Object.keys((JSON.parse(declared) as { config: object }).config);
      assert.deepEqual([...new Set(names)].filter((name) => !keys.includes(name)), [], filter);
    }
  });

  test("Compose and the image only pass declared names", async () => {
    const declared = readFileSync(join(WEB_ROOT, ".env.schema"), "utf8");
    const isDeclared = (name: string) => new RegExp(`^${name}=`, "m").test(declared);
    const composed = [...repoFile("docker-compose.yml").matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]);
    const runner = repoFile("web/Dockerfile").split("AS runner")[1];
    const imageEnv = [...runner.matchAll(/^(?:ENV |\s+)([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
    assert.ok(composed.includes("VOICE_CLONE_TOKEN"));
    assert.ok(imageEnv.includes("DATABASE_PATH"));
    assert.deepEqual([...composed, ...imageEnv].filter((name) => !isDeclared(name)), []);
  });
});

describe("the Next loader and its pins", () => {
  const manifest = JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    overrides: { next: Record<string, string> };
  };
  const lock = JSON.parse(readFileSync(join(WEB_ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, { name?: string; version: string }>;
  };

  test("Next loads its environment through the pinned integration", () => {
    const fromNext = createRequire(createRequire(join(WEB_ROOT, "package.json")).resolve("next/package.json"));
    const loader = fromNext.resolve("@next/env");
    assert.match(loader, /next-env-compat\.cjs$/);
    const installed = JSON.parse(readFileSync(join(dirname(loader), "../package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    assert.equal(installed.name, "@varlock/nextjs-integration");
    assert.equal(installed.version, manifest.dependencies["@varlock/nextjs-integration"]);
  });

  test("the alias, the direct pin and the lockfile name one integration version", () => {
    const version = manifest.dependencies["@varlock/nextjs-integration"];
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(manifest.overrides.next["@next/env"], `npm:@varlock/nextjs-integration@${version}`);
    const alias = lock.packages["node_modules/next/node_modules/@next/env"];
    assert.equal(alias.name, "@varlock/nextjs-integration");
    assert.equal(alias.version, version);
    assert.equal(lock.packages["node_modules/@varlock/nextjs-integration"].version, version);
    assert.equal(lock.packages["node_modules/@next/env"], undefined);
  });

  test("the CLI and the store plugin stay on exact pins", () => {
    assert.equal(manifest.dependencies.varlock, lock.packages["node_modules/varlock"].version);
    assert.equal(
      manifest.devDependencies["@varlock/infisical-plugin"],
      lock.packages["node_modules/@varlock/infisical-plugin"].version,
    );
    assert.match(manifest.dependencies.varlock, /^\d+\.\d+\.\d+$/);
  });
});

describe("what reaches the release image and archive", () => {
  test("the build context carries the schema and no other env file", () => {
    const rules = repoFile(".dockerignore").split("\n");
    const exclude = rules.indexOf("web/.env*");
    const include = rules.indexOf("!web/.env.schema");
    assert.ok(exclude >= 0 && include > exclude);
    assert.ok(!rules.includes("!web/.env.infisical"));
  });

  test("a downloaded archive leaves the store location out", () => {
    assert.match(repoFile(".gitattributes"), /^web\/\.env\.infisical export-ignore$/m);
  });
});

describe("an agent behind the credential proxy", () => {
  test("only the model download host gets a rule, so subscriptions pass untouched", async (t) => {
    const local = workspace();
    t.after(local.cleanup);
    const { stdout, status } = await local.varlock(["proxy", "rules"]);
    assert.equal(status, 0);
    assert.match(stdout, /huggingface\.co/);
    assert.doesNotMatch(stdout, /anthropic|chatgpt|openai/i);
  });
});
