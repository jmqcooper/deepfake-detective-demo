import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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

import { REPO_ROOT, WEB_ROOT, sealedEnv } from "./helpers/isolated-varlock.ts";

const SECRET = "synthetic-voice-token-0123456789abcdef";
const OTHER_SECRET = "synthetic-huggingface-token-9876543210";
const INSTALLED_TOKEN = "synthetic-installed-token-from-root-env";
const CLEAN = "echo clean\n";
const LEAK = `echo ${SECRET}\n`;
const FAILURE = "Secret scan failed. Check staged files and secret-store access. See docs/SECRETS.md.";

interface Fixture {
  repo: string;
  file: (name: string) => string;
  git: (...args: string[]) => { status: number | null; output: string; stdout: string };
  snapshots: () => string[];
  scratch: string;
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

  const env = sealedEnv(home, {
    ILCC_SHARED_SECRETS: "off",
    TMPDIR: scratch,
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  });
  const git: Fixture["git"] = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", env });
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
    file: (name) => join(repo, name),
    snapshots: () => readdirSync("/tmp").filter((name) => name.startsWith("ilcc-deepfake-staged.")),
  };
}

function assertBlocked(commit: { status: number | null; output: string }): void {
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
    const { file, git } = withRepository(t);
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    writeFileSync(file("deploy.sh"), LEAK);
    assert.equal(git("commit", "--message", "Add the deploy step").status, 0);
    assert.equal(git("show", "HEAD:deploy.sh").stdout, CLEAN);
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

  test("covers the installed token in the root .env, which the schema never loads", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("notes.md"), `token: ${INSTALLED_TOKEN}\n`);
    git("add", "notes.md");
    assertBlocked(git("commit", "--message", "Add notes"));
  });

  test("fails closed with one fixed line when the scanner cannot run", (t) => {
    const { file, git } = withRepository(t);
    writeFileSync(file("web/.env.schema"), "# @plugin(not-a-real-plugin)\n# ---\n");
    writeFileSync(file("deploy.sh"), CLEAN);
    git("add", "deploy.sh");
    assertBlocked(git("commit", "--message", "Add the deploy step"));
  });
});
