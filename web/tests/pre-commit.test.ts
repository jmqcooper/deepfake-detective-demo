import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { REPO_ROOT, SYNTHETIC_CLIENT_ID, WEB_ROOT, mockStore, run, sealedEnv } from "./helpers/isolated-varlock.ts";

const SECRET = "synthetic-voice-token-0123456789abcdef";
const OTHER_SECRET = "synthetic-huggingface-token-9876543210";
const INSTALLED_TOKEN = "synthetic-installed-token-from-root-env";
const STORED_SECRET = "synthetic-store-secret-5555555555555555";
const CLIENT_SECRET = "synthetic-client-secret-7777777777777777";
const CLEAN = "echo clean\n";
const LEAK = `echo ${SECRET}\n`;
const COMMIT = ["commit", "--message", "Add the deploy step"];
const FAILURE = "Secret scan failed. Check staged files and secret-store access. See docs/SECRETS.md.";
const VARLOCK = join(WEB_ROOT, "node_modules/varlock/bin/cli.js");

interface Commit {
  status: number | null;
  output: string;
}

interface Fixture {
  repo: string;
  file: (name: string) => string;
  git: (...args: string[]) => Commit & { stdout: string };
  snapshots: () => string[];
  scratch: string;
  env: (values?: Record<string, string>) => NodeJS.ProcessEnv;
  /** For a commit a fixture store answers: a synchronous one would block its event loop. */
  commit: (values?: Record<string, string>) => Promise<Commit>;
  addIdentity: (identity?: string) => void;
  /** Puts a recording CLI in front of Varlock and returns its calls. `onCall` sees `args` and `fs`. */
  interpose: (onCall?: string) => () => string[][];
  commitInProxy: (values: Record<string, string>, script?: string) => Promise<Commit>;
}

/** A scratch repository with the real hook and schema, and its own HOME. */
function withRepository(t: { after: (cleanup: () => void) => void }): Fixture {
  const base = mkdtempSync(join(tmpdir(), "ilcc-pre-commit-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  const home = join(base, "home");
  // Varlock expands a scan target with a glob character, so the hook must not build on this.
  const scratch = join(base, "scratch[0]");
  for (const directory of [home, repo, scratch]) mkdirSync(directory);
  const copies: Array<[string, string]> = [
    [join(REPO_ROOT, ".githooks/pre-commit"), ".githooks/pre-commit"],
    [join(WEB_ROOT, "scripts/scan-staged.mjs"), "web/scripts/scan-staged.mjs"],
    [join(WEB_ROOT, "scripts/env/preflight.mjs"), "web/scripts/env/preflight.mjs"],
    [join(WEB_ROOT, ".env.schema"), "web/.env.schema"],
    [join(WEB_ROOT, ".env.infisical"), "web/.env.infisical"],
    [join(WEB_ROOT, "package.json"), "web/package.json"],
  ];
  for (const [from, to] of copies) {
    mkdirSync(dirname(join(repo, to)), { recursive: true });
    copyFileSync(from, join(repo, to));
  }
  writeFileSync(join(repo, ".gitignore"), ".env\n.env.local\nnode_modules\n");
  writeFileSync(join(repo, "web/.env"), `VOICE_CLONE_TOKEN=${SECRET}\nHF_TOKEN=${OTHER_SECRET}\n`);
  writeFileSync(join(repo, ".env"), `DATABASE_PATH=/app/data/stats.db\nVOICE_CLONE_TOKEN=${INSTALLED_TOKEN}\n`);
  symlinkSync(join(WEB_ROOT, "node_modules"), join(repo, "web/node_modules"));

  const env: Fixture["env"] = (values = {}) =>
    sealedEnv(home, {
      ILCC_SHARED_SECRETS: "off",
      TMPDIR: scratch,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
      ...values,
    });
  const git: Fixture["git"] = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: env() });
    return { status: result.status, output: `${result.stdout}${result.stderr}`, stdout: result.stdout };
  };
  git("init", "--quiet", "--initial-branch=main");
  git("add", ".");
  git("commit", "--quiet", "--no-verify", "--message", "Set up the fixture");
  git("config", "core.hooksPath", ".githooks");
  return {
    repo,
    git,
    scratch,
    env,
    file: (name) => join(repo, name),
    snapshots: () => readdirSync("/tmp").filter((name) => name.startsWith("ilcc-deepfake-staged.")),
    commit: async (values) => {
      const result = await run("git", COMMIT, { cwd: repo, env: env(values) });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    },
    addIdentity: (identity = `INFISICAL_CLIENT_ID=${SYNTHETIC_CLIENT_ID}\nINFISICAL_CLIENT_SECRET=${CLIENT_SECRET}\n`) => {
      mkdirSync(join(home, ".config/varlock"), { recursive: true });
      writeFileSync(join(home, ".config/varlock/.env.infisical"), identity);
    },
    interpose: (onCall = "") => {
      const modules = join(repo, "web/node_modules");
      const calls = join(base, "varlock-calls");
      rmSync(modules);
      mkdirSync(join(modules, "varlock/bin"), { recursive: true });
      mkdirSync(join(modules, ".bin"));
      for (const entry of readdirSync(join(WEB_ROOT, "node_modules"))) {
        if (entry === "varlock" || entry === ".bin") continue;
        symlinkSync(join(WEB_ROOT, "node_modules", entry), join(modules, entry));
      }
      writeFileSync(join(modules, "varlock/package.json"), '{ "type": "module" }\n');
      writeFileSync(
        join(modules, "varlock/bin/cli.js"),
        `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
${onCall}
process.exit(spawnSync(process.execPath, [${JSON.stringify(VARLOCK)}, ...args], { stdio: "inherit" }).status ?? 1);
`,
        { mode: 0o755 },
      );
      symlinkSync("../varlock/bin/cli.js", join(modules, ".bin/varlock"));
      return () =>
        readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[]);
    },
    commitInProxy: async (values, script = "") => {
      const child = `
        const { spawnSync } = require("node:child_process");
        const fs = require("node:fs");
        (async () => {
          if (process.env.HF_TOKEN === ${JSON.stringify(OTHER_SECRET)}) process.exit(99);
          // Whatever opens a private file now blocks on the pipe, until the time limit below.
          const privateFiles = ["../.env", ".env"];
          for (const path of privateFiles) {
            fs.rmSync(path);
            spawnSync("mkfifo", [path]);
          }
          ${script}
          await fetch(${JSON.stringify(`${values.INFISICAL_SITE_URL}/commit-starts`)});
          const { status } = spawnSync("git", ${JSON.stringify(COMMIT)}, { stdio: "inherit", timeout: 30000 });
          for (const path of privateFiles) {
            try {
              fs.closeSync(fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
              process.exit(98);
            } catch {}
          }
          process.exit(status ?? 1);
        })();`;
      const result = await run(process.execPath, [VARLOCK, "proxy", "run", "--", process.execPath, "-e", child], {
        cwd: join(repo, "web"),
        env: env(values),
      });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    },
  };
}

function assertBlocked(commit: Commit): void {
  assert.notEqual(commit.status, 0);
  assert.equal(commit.output.trim(), FAILURE);
}

describe("the pre-commit secret scan", () => {
  test("blocks a staged secret that only the working copy has dropped", (t) => {
    const { file, git, scratch, snapshots } = withRepository(t);
    const before = snapshots();
    writeFileSync(file("deploy.sh"), LEAK);
    git("add", "deploy.sh");
    writeFileSync(file("deploy.sh"), CLEAN);
    assertBlocked(git("commit", "--message", "Add the deploy step"));
    assert.equal(git("show", ":deploy.sh").stdout, LEAK);
    assert.equal(readFileSync(file("deploy.sh"), "utf8"), CLEAN);
    assert.deepEqual(snapshots(), before);
    assert.deepEqual(readdirSync(scratch), []);
  });

  test("commits a clean staged version while the working copy holds a secret", (t) => {
    const { file, git, scratch, snapshots } = withRepository(t);
    const before = snapshots();
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    writeFileSync(file("deploy.sh"), LEAK);
    assert.equal(git("commit", "--message", "Add the deploy step").status, 0);
    assert.equal(git("show", "HEAD:deploy.sh").stdout, CLEAN);
    assert.deepEqual(snapshots(), before);
    assert.deepEqual(readdirSync(scratch), []);
  });

  test("checks the working copy when a path commit will take it", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    writeFileSync(file("deploy.sh"), LEAK);
    assertBlocked(git("commit", "--message", "Add the deploy step", "--", "deploy.sh"));
  });

  test("reads nested paths and spaces, and folders a directory walk would skip", (t) => {
    const { file, git } = withRepository(t);
    for (const path of ["deploy steps/first step.sh", "dist/bundle.js", ".next/cache.js"]) {
      mkdirSync(dirname(file(path)), { recursive: true });
      writeFileSync(file(path), LEAK);
      git("add", "--force", path);
      writeFileSync(file(path), CLEAN);
      assertBlocked(git("commit", "--message", "Add a file"));
      git("rm", "--quiet", "--cached", path);
    }
  });

  test("follows a rename and a type change to the content in the index", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("old-name.sh"), CLEAN.repeat(4));
    symlinkSync("old-name.sh", file("linked.sh"));
    git("add", ".");
    git("commit", "--no-verify", "--message", "Add both names");

    git("mv", "old-name.sh", "new-name.sh");
    writeFileSync(file("new-name.sh"), `${CLEAN.repeat(4)}${LEAK}`);
    git("add", "new-name.sh");
    writeFileSync(file("new-name.sh"), CLEAN);
    assertBlocked(git("commit", "--message", "Rename the step"));
    git("reset", "--quiet", "--hard");

    rmSync(file("linked.sh"));
    writeFileSync(file("linked.sh"), LEAK);
    git("add", "linked.sh");
    writeFileSync(file("linked.sh"), CLEAN);
    assertBlocked(git("commit", "--message", "Replace the link"));
  });

  test("commits a staged link whose target does not exist", (t) => {
    const { file, git } = withRepository(t);
    symlinkSync("nowhere", file("dangling.sh"));
    git("add", "dangling.sh");
    assert.equal(git("commit", "--message", "Add a link").status, 0);
  });

  test("lets a commit delete a file that held a secret", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("leaked.sh"), LEAK);
    git("add", "leaked.sh");
    git("commit", "--no-verify", "--message", "Add the leak");
    git("rm", "--quiet", "leaked.sh");
    assert.equal(git("commit", "--message", "Remove the leak").status, 0);
  });

  test("never prints either secret when both appear on one staged line", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("deploy.sh"), `echo ${SECRET} ${OTHER_SECRET}\n`);
    git("add", "deploy.sh");
    const commit = git("commit", "--message", "Add the deploy step");
    assertBlocked(commit);
    assert.ok(!commit.output.includes(SECRET) && !commit.output.includes(OTHER_SECRET));
  });

  test("covers a voice-only secret that the web filter hides", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("voice.sh"), `export HF_TOKEN=${OTHER_SECRET}\n`);
    git("add", "voice.sh");
    assertBlocked(git("commit", "--message", "Add the voice step"));
  });

  test("still catches a plaintext frozen env file when no value is set", (t) => {
    const { file, git } = withRepository(t);
    rmSync(file(".env"));
    rmSync(file("web/.env"));
    writeFileSync(file(".varlock-frozen-env"), '{ "config": {} }\n');
    git("add", "--force", ".varlock-frozen-env");
    assertBlocked(git("commit", "--message", "Add a frozen env"));
  });

  test("fails closed with one fixed line when the scanner cannot run", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("web/.env.schema"), "# @plugin(not-a-real-plugin)\n# ---\n");
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    assertBlocked(git("commit", "--message", "Add the deploy step"));
  });

  test("fails closed when the CLI is missing or answers with something else", (t) => {
    const { file, git, interpose } = withRepository(t);
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    interpose(`if (args[0] === "load") { console.log("not a graph"); process.exit(0); }`);
    assertBlocked(git("commit", "--message", "Add the deploy step"));

    rmSync(file("web/node_modules"), { recursive: true });
    assertBlocked(git("commit", "--message", "Add the deploy step"));
  });

  for (const [name, schema] of [
    ["missing", null],
    ["empty", ""],
    ["comment-only", "# @defaultRequired=false\n# ---\n# Nothing is declared here.\n"],
  ] as const) {
    test(`refuses a schema that is ${name}, even for a clean commit`, (t) => {
      const { file, git, scratch, snapshots } = withRepository(t);
      const before = snapshots();
      if (schema === null) rmSync(file("web/.env.schema"));
      else writeFileSync(file("web/.env.schema"), schema);
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assertBlocked(git("commit", "--message", "Add the deploy step"));
      assert.deepEqual(snapshots(), before);
      assert.deepEqual(readdirSync(scratch), []);
    });
  }

  test("a bad public value leaves a commit alone, and a bad secret stops it", async (t) => {
    const { commit, file, git } = withRepository(t);
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    writeFileSync(file("web/.env"), 'VOICE_CLONE_TOKEN="two words "\n');
    assertBlocked(await commit());

    writeFileSync(file("web/.env"), "STATS_MAX_ROWS=many\n");
    assert.equal((await commit({ APP_URL: "not-a-url" })).status, 0);
  });

  test("stops at a bad public value when Varlock then cannot settle what is sensitive", async (t) => {
    const { commit, file, git } = withRepository(t);
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    writeFileSync(file("web/.env"), "STATS_DRIVER=bogus\n");
    assertBlocked(await commit());
  });

  describe("inside a credential proxy", () => {
    const scrubMarkers = `
      for (const name of Object.keys(process.env)) if (/^__?VARLOCK_/.test(name)) delete process.env[name];`;
    // Varlock's schema guard skips a session with no fingerprint, so nothing else stops this one.
    const dropFingerprint = `
      const sessions = process.env.HOME + "/.config/varlock/proxy/sessions/";
      const record = sessions + fs.readdirSync(sessions)[0] + "/session.json";
      const { schemaFingerprint, ...session } = JSON.parse(fs.readFileSync(record, "utf8"));
      if (!schemaFingerprint) process.exit(97);
      fs.writeFileSync(record, JSON.stringify(session));`;

    for (const [name, script] of [
      ["with its markers", ""],
      ["with its markers scrubbed", scrubMarkers],
      ["with no markers or fingerprint", `${dropFingerprint}${scrubMarkers}`],
    ]) {
      test(`refuses a child ${name} before it reads a private source`, async (t) => {
        const { addIdentity, commitInProxy, file, git, scratch, snapshots } = withRepository(t);
        const before = snapshots();
        const store = await mockStore({ HF_TOKEN: STORED_SECRET });
        t.after(store.close);
        addIdentity();
        writeFileSync(file("deploy.sh"), LEAK);
        git("add", "deploy.sh");

        const commit = await commitInProxy({ ILCC_SHARED_SECRETS: "infisical", INFISICAL_SITE_URL: store.url }, script);
        assert.notEqual(commit.status, 0);
        assert.ok(commit.output.includes(FAILURE), commit.output);
        for (const secret of [SECRET, INSTALLED_TOKEN, STORED_SECRET]) assert.ok(!commit.output.includes(secret));
        assert.notEqual(git("show", "HEAD:deploy.sh").status, 0);

        assert.ok(store.calls.includes("/commit-starts"));
        assert.deepEqual(store.calls.slice(store.calls.indexOf("/commit-starts") + 1), []);
        assert.deepEqual(snapshots(), before);
        assert.deepEqual(readdirSync(scratch), []);
      });
    }

    test("refuses a proxy that only the whole load reports", (t) => {
      const { file, git, interpose } = withRepository(t);
      interpose(`if (args.includes("--include-internal")) {
        console.log(JSON.stringify({ config: { HF_TOKEN: { isSensitive: true } }, runtime: { proxy: { active: true } } }));
        process.exit(0);
      }`);
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assertBlocked(git("commit", "--message", "Add the deploy step"));
    });

    test("refuses markers that outlive their session", async (t) => {
      const { commit, file, git } = withRepository(t);
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assertBlocked(await commit({ __VARLOCK_PROXY_SESSION_ID: "ended-session" }));
    });
  });

  describe("under inherited Varlock state", () => {
    test("a filter cannot narrow the scan", async (t) => {
      const { commit, env, file, git } = withRepository(t);
      writeFileSync(file("voice.sh"), `export HF_TOKEN=${OTHER_SECRET}\n`);
      git("add", "voice.sh");
      assertBlocked(await commit({ _VARLOCK_FILTER: "#nothing" }));
      const nested = await run(process.execPath, [VARLOCK, "run", "--filter", "#web", "--", "git", ...COMMIT], {
        cwd: file("web"),
        env: env(),
      });
      assertBlocked({ status: nested.status, output: `${nested.stdout}${nested.stderr}` });
    });

    test("a graph that recorded no overrides cannot hide a process value", async (t) => {
      const { commit, file, git } = withRepository(t);
      writeFileSync(file("deploy.sh"), `echo ${STORED_SECRET}\n`);
      git("add", "deploy.sh");
      assertBlocked(
        await commit({
          __VARLOCK_ENV: JSON.stringify({ config: {}, overrideKeys: [] }),
          VOICE_CLONE_TOKEN: STORED_SECRET,
        }),
      );
    });

    test("a clean commit still passes", async (t) => {
      const { commit, file, git } = withRepository(t);
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assert.equal((await commit({ _VARLOCK_FILTER: "#nothing" })).status, 0);
    });
  });

  describe("with an identity on the machine", () => {
    test("reads the store once, so an empty second answer cannot clear a secret", async (t) => {
      const { addIdentity, commit, file, git } = withRepository(t);
      let reads = 0;
      const secrets = (): Record<string, string> => (reads++ === 0 ? { HF_TOKEN: STORED_SECRET } : {});
      const store = await mockStore(secrets);
      t.after(store.close);
      addIdentity();
      writeFileSync(file("web/.env"), "");
      writeFileSync(file("deploy.sh"), `echo ${STORED_SECRET}\n`);
      git("add", "deploy.sh");
      const result = await commit({ ILCC_SHARED_SECRETS: "infisical", INFISICAL_SITE_URL: store.url });
      assertBlocked(result);
      assert.ok(!result.output.includes(STORED_SECRET));
      assert.equal(reads, 1);
    });

    test("covers the internal client secret of the identity itself", async (t) => {
      const { addIdentity, commit, file, git } = withRepository(t);
      const store = await mockStore({});
      t.after(store.close);
      addIdentity();
      writeFileSync(file("deploy.sh"), `echo ${CLIENT_SECRET}\n`);
      git("add", "deploy.sh");
      assertBlocked(await commit({ ILCC_SHARED_SECRETS: "infisical", INFISICAL_SITE_URL: store.url }));
    });

    test("commits clean work after one read of the store", async (t) => {
      const { addIdentity, commit, file, git } = withRepository(t);
      let reads = 0;
      const store = await mockStore(() => (reads++, { HF_TOKEN: STORED_SECRET }));
      t.after(store.close);
      addIdentity();
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assert.equal((await commit({ ILCC_SHARED_SECRETS: "infisical", INFISICAL_SITE_URL: store.url })).status, 0);
      assert.equal(reads, 1);
    });

    test("fails closed when the store refuses or cannot be reached", async (t) => {
      const { addIdentity, commit, file, git } = withRepository(t);
      const refusing = await mockStore({}, true);
      t.after(refusing.close);
      addIdentity();
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      for (const site of [refusing.url, "http://127.0.0.1:9"]) {
        assertBlocked(await commit({ ILCC_SHARED_SECRETS: "infisical", INFISICAL_SITE_URL: site }));
      }
    });

    for (const [name, identity] of [
      ["has no secret", `INFISICAL_CLIENT_ID=${SYNTHETIC_CLIENT_ID}\n`],
      ["cannot be decrypted", `INFISICAL_CLIENT_ID=${SYNTHETIC_CLIENT_ID}\nINFISICAL_CLIENT_SECRET=varlock("local:bm90LWNpcGhlcnRleHQ=")\n`],
    ]) {
      test(`fails closed when the identity ${name}`, async (t) => {
        const { addIdentity, commit, file, git } = withRepository(t);
        const store = await mockStore({});
        t.after(store.close);
        addIdentity(identity);
        writeFileSync(file("deploy.sh"), CLEAN);
        git("add", "deploy.sh");
        assertBlocked(await commit({ ILCC_SHARED_SECRETS: "infisical", INFISICAL_SITE_URL: store.url }));
      });
    }

    test("the offline switch commits without the store and keeps local coverage", async (t) => {
      const { addIdentity, commit, file, git } = withRepository(t);
      const store = await mockStore({ HF_TOKEN: STORED_SECRET });
      t.after(store.close);
      addIdentity();
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assert.equal((await commit({ INFISICAL_SITE_URL: store.url })).status, 0);
      writeFileSync(file("deploy.sh"), LEAK);
      git("add", "deploy.sh");
      assertBlocked(await commit({ INFISICAL_SITE_URL: store.url }));
      assert.deepEqual(store.calls, []);
    });
  });

  describe("the captured values", () => {
    test("stay blocked when the sources change just before the scan", (t) => {
      const { file, git, interpose } = withRepository(t);
      interpose(`if (args[0] === "scan") fs.writeFileSync(".env", "");`);
      writeFileSync(file("deploy.sh"), LEAK);
      git("add", "deploy.sh");
      assertBlocked(git("commit", "--message", "Add the deploy step"));
      assert.equal(readFileSync(file("web/.env"), "utf8"), "");
    });

    test("reach the scanner in its environment, never in an argument or a file", (t) => {
      const { file, git, interpose } = withRepository(t);
      const seen = file("../scan-seen.json");
      const calls = interpose(`if (args[0] === "scan") {
        const schema = args[args.indexOf("--path") + 1];
        fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({
          schema: fs.readFileSync(schema, "utf8"),
          schemaMode: fs.statSync(schema).mode & 0o777,
          directoryMode: fs.statSync(dirname(schema)).mode & 0o777,
          values: Object.entries(process.env).filter(([name]) => name.startsWith("SCAN_VALUE_")).map(([, value]) => value).sort(),
        }));
      }`);
      writeFileSync(file("deploy.sh"), LEAK);
      git("add", "deploy.sh");
      assertBlocked(git("commit", "--message", "Add the deploy step"));

      const { schema, schemaMode, directoryMode, values } = JSON.parse(readFileSync(seen, "utf8")) as {
        schema: string;
        schemaMode: number;
        directoryMode: number;
        values: string[];
      };
      assert.deepEqual(values, [OTHER_SECRET, SECRET].sort());
      assert.equal(schemaMode, 0o600);
      assert.equal(directoryMode, 0o700);
      assert.deepEqual(schema.match(/^SCAN_VALUE_\d+=.*$/gm), ["SCAN_VALUE_0=", "SCAN_VALUE_1="]);
      assert.ok(!/@import|@plugin/.test(schema));
      const argv = JSON.stringify(calls());
      for (const secret of [SECRET, OTHER_SECRET, INSTALLED_TOKEN]) {
        assert.ok(!schema.includes(secret) && !argv.includes(secret));
      }
    });

    test("leave nothing behind when the hook is interrupted during the scan", (t) => {
      const { file, git, interpose, scratch, snapshots } = withRepository(t);
      const before = snapshots();
      const during = file("../snapshot-during-scan");
      interpose(`if (args[0] === "scan") {
        const hook = spawnSync("ps", ["-o", "ppid=", "-p", String(process.ppid)], { encoding: "utf8" }).stdout.trim();
        fs.writeFileSync(${JSON.stringify(during)}, args[args.indexOf("--path") + 1]);
        process.kill(Number(hook), "SIGTERM");
      }`);
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assert.notEqual(git("commit", "--message", "Add the deploy step").status, 0);
      assert.ok(readFileSync(during, "utf8").startsWith("/tmp/ilcc-deepfake-staged."));
      assert.ok(!existsSync(readFileSync(during, "utf8")));
      assert.deepEqual(snapshots(), before);
      assert.deepEqual(readdirSync(scratch), []);
    });
  });

  describe("the installed token in the root .env, which the schema never loads", () => {
    test("is blocked in a text file", (t) => {
      const { file, git } = withRepository(t);
      writeFileSync(file("notes.md"), `token: ${INSTALLED_TOKEN}\n`);
      git("add", "notes.md");
      assertBlocked(git("commit", "--message", "Add notes"));
    });

    test("is blocked in the files Varlock skips", (t) => {
      const { file, git } = withRepository(t);
      for (const [path, contents] of [
        ["logo.png", `token: ${INSTALLED_TOKEN}\n`],
        ["voice.bin", `token: ${INSTALLED_TOKEN}\n`],
        ["capture.dat", Buffer.concat([Buffer.from([0]), Buffer.from(INSTALLED_TOKEN), Buffer.from([0])])],
      ] as const) {
        writeFileSync(file(path), contents);
        git("add", path);
        assertBlocked(git("commit", "--message", "Add a capture"));
        git("rm", "--quiet", "--cached", path);
      }
    });

    test("follows the installers: the last line wins, without its carriage return", (t) => {
      const { file, git } = withRepository(t);
      const token = "-synthetic.token*with[regex]";
      writeFileSync(file(".env"), `VOICE_CLONE_TOKEN=first\r\nVOICE_CLONE_TOKEN=${token}\r\n`);
      writeFileSync(file("notes.md"), `token: ${token}\n`);
      git("add", "notes.md");
      assertBlocked(git("commit", "--message", "Add notes"));
    });

    /** Commits with a stand-in for grep first on the PATH. */
    function commitWithGrep({ env, file }: Fixture, script: string): Commit {
      const bin = file("../bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "grep"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      const commit = spawnSync("git", COMMIT, {
        cwd: file("."),
        encoding: "utf8",
        env: { ...env(), PATH: `${bin}:${process.env.PATH}` },
      });
      return { status: commit.status, output: `${commit.stdout}${commit.stderr}` };
    }

    test("reaches grep on a pipe, not in a file or an argument", (t) => {
      const fixture = withRepository(t);
      const { file, git } = fixture;
      const seen = file("../grep-saw");
      const grep = spawnSync("sh", ["-c", "command -v grep"], { encoding: "utf8" }).stdout.trim();
      writeFileSync(file("notes.md"), `token: ${INSTALLED_TOKEN}\n`);
      git("add", "notes.md");
      assertBlocked(
        commitWithGrep(
          fixture,
          `for target; do :; done
{ printf '%s\\n' "$*"; find "$(dirname "$target")" -type f ! -path '*/files/*' -exec cat {} +; } >>'${seen}'
exec '${grep}' "$@"`,
        ),
      );
      assert.match(readFileSync(seen, "utf8"), /files/);
      assert.ok(!readFileSync(seen, "utf8").includes(INSTALLED_TOKEN));
    });

    test("stops the commit when grep cannot run", (t) => {
      const fixture = withRepository(t);
      const { file, git } = fixture;
      writeFileSync(file("deploy.sh"), CLEAN);
      git("add", "deploy.sh");
      assertBlocked(commitWithGrep(fixture, "exit 2"));
    });

    for (const [name, rootEnv] of [
      ["no root .env", null],
      ["no token line", "DATABASE_PATH=/app/data/stats.db\n"],
      ["a blank token line", "VOICE_CLONE_TOKEN=\n"],
    ]) {
      test(`stays out of the way with ${name}`, (t) => {
        const { file, git } = withRepository(t);
        if (rootEnv === null) rmSync(file(".env"));
        else writeFileSync(file(".env"), rootEnv);
        writeFileSync(file("deploy.sh"), CLEAN);
        git("add", "deploy.sh");
        assert.equal(git("commit", "--message", "Add the deploy step").status, 0);
      });
    }
  });
});
