import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mockStore, workspace } from "./helpers/isolated-varlock.ts";

const FIRST_SECRET = "synthetic secret number one ";
const SECOND_SECRET = "synthetic-second-secret-value-0123456789";

/** Stands in for the server.js Next generates: it reports what the server would receive. */
const SERVER_STAND_IN = `
console.log(JSON.stringify({
  pid: process.pid,
  blob: Boolean(process.env.__VARLOCK_ENV),
  token: process.env.VOICE_CLONE_TOKEN,
  days: process.env.STATS_RETENTION_DAYS,
  url: process.env.VOICE_CLONE_URL,
  inherited: Object.keys(process.env).filter((key) => /^__VARLOCK_(?!ENV$)/.test(key)),
}));
`;

const INSTALLED = {
  NODE_ENV: "production",
  STATS_DRIVER: "sqlite",
  DATABASE_PATH: "/app/data/stats.db",
};

describe("npm run dev", () => {
  test("a malformed value stops before Next can report Ready", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    const result = await space.npm(["run", "dev"], { STATS_RETENTION_DAYS: "90days" });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Ready/);
    assert.match(result.stderr, /\[env\] Invalid or missing: STATS_RETENTION_DAYS\./);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /90days/);
  });

  test("a store that refuses a configured identity stops it", async (t) => {
    const store = await mockStore({}, true);
    t.after(store.close);
    const space = workspace();
    t.after(space.cleanup);
    space.addIdentity();
    const result = await space.npm(["run", "dev"], { INFISICAL_SITE_URL: store.url });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Ready/);
    assert.match(result.stderr, /Could not load the environment/);
    assert.ok(store.calls.length > 0);
  });
});

describe("the check before a process starts", () => {
  test("names keys and prints no value, even with two secrets involved", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    const result = await space.node(["scripts/env/preflight.mjs"], {
      VOICE_CLONE_TOKEN: FIRST_SECRET,
      VOICE_CLONE_URL: `not-a-url ${SECOND_SECRET}`,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid or missing: VOICE_CLONE_URL, VOICE_CLONE_TOKEN\./);
    for (const secret of [FIRST_SECRET.trim(), SECOND_SECRET]) {
      assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
    }
  });

  test("says when a machine with no identity runs on local values", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    const result = await space.node(["scripts/env/preflight.mjs"]);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /No Infisical identity on this machine\. Using process env, \.env\.local and \.env\./);
  });

  test("stays quiet about the store in a build, which never uses it", async (t) => {
    const store = await mockStore({});
    t.after(store.close);
    const space = workspace();
    t.after(space.cleanup);
    space.addIdentity();
    const result = await space.node(["scripts/env/preflight.mjs", "--profile", "production"], {
      INFISICAL_SITE_URL: store.url,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(store.calls, []);
  });

  test("an inherited Varlock blob cannot answer for a bad value", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    const blob = JSON.stringify({ config: { STATS_DRIVER: { value: "memory" } }, settings: {} });
    const result = await space.node(["scripts/env/preflight.mjs"], {
      STATS_DRIVER: "postgres",
      __VARLOCK_ENV: blob,
      _VARLOCK_USE_INJECTED_ENV: "1",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /STATS_DRIVER/);
  });
});

describe("the image's entry point", () => {
  const started = (stdout: string) => JSON.parse(stdout) as Record<string, unknown>;
  const standIn = (app: string) => writeFileSync(join(app, "server.js"), SERVER_STAND_IN);

  test("becomes the server in the same process, with values as written", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    standIn(space.app);
    const result = await space.node(["scripts/env/start-image.mjs"], {
      ...INSTALLED,
      STATS_RETENTION_DAYS: " 90 ",
      VOICE_CLONE_TOKEN: "",
      VOICE_CLONE_URL: "http://host.docker.internal:8765",
    });
    assert.equal(result.status, 0, result.stderr);
    const server = started(result.stdout);
    assert.equal(server.pid, result.pid);
    assert.equal(server.blob, true);
    assert.equal(server.days, " 90 ");
    assert.equal(server.token, "");
    assert.equal(server.url, "http://host.docker.internal:8765");
  });

  test("starts with no optional voice setting at all", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    standIn(space.app);
    const result = await space.node(["scripts/env/start-image.mjs"], INSTALLED);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(started(result.stdout).token, undefined);
  });

  test("refuses bad values and missing stats settings without starting the server", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    standIn(space.app);
    const malformed = await space.node(["scripts/env/start-image.mjs"], {
      ...INSTALLED,
      VOICE_CLONE_URL: `http://${SECOND_SECRET} nope`,
    });
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout, "");
    assert.equal(malformed.stderr.trim(), "[env] Invalid or missing: VOICE_CLONE_URL. See docs/SECRETS.md.");

    const missing = await space.node(["scripts/env/start-image.mjs"], { NODE_ENV: "production" });
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /DATABASE_PATH/);
  });

  test("ignores inherited metadata and an inherited profile, and never reads the store", async (t) => {
    const store = await mockStore({ VOICE_CLONE_URL: "http://store.example:1" });
    t.after(store.close);
    const space = workspace();
    t.after(space.cleanup);
    space.addIdentity();
    standIn(space.app);
    const inherited = {
      ...INSTALLED,
      INFISICAL_SITE_URL: store.url,
      ILCC_ENV_PROFILE: "development",
      ILCC_SHARED_SECRETS: "infisical",
      __VARLOCK_ENV: JSON.stringify({ config: {}, settings: {} }),
      __VARLOCK_INHERITED_TEST: "still here",
    };
    const started_ = await space.node(["scripts/env/start-image.mjs"], inherited);
    assert.equal(started_.status, 0, started_.stderr);
    const server = started(started_.stdout);
    assert.equal(server.url, undefined);
    assert.deepEqual(server.inherited, []);
    assert.deepEqual(store.calls, []);

    const refused = await space.node(["scripts/env/start-image.mjs"], { ...inherited, STATS_DRIVER: "postgres" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /STATS_DRIVER/);
  });

  test("fails closed when the contract is missing or broken", async (t) => {
    const space = workspace();
    t.after(space.cleanup);
    standIn(space.app);
    writeFileSync(join(space.app, ".env.schema"), "# @not-a-real-decorator(\n");
    const broken = await space.node(["scripts/env/start-image.mjs"], INSTALLED);
    assert.equal(broken.status, 1);
    assert.equal(broken.stdout, "");

    rmSync(join(space.app, ".env.schema"));
    rmSync(join(space.app, ".env.infisical"));
    const missing = await space.node(["scripts/env/start-image.mjs"], INSTALLED);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /Could not load the environment/);
  });
});
