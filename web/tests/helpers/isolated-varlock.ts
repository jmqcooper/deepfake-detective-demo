import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REPO_ROOT = resolve(WEB_ROOT, "..");
export const SYNTHETIC_CLIENT_ID = "11111111-2222-4333-8444-555555555555";

const NO_SESSION_BUS = "/nonexistent/ilcc-deepfake-no-session-bus";
const VARLOCK = join(WEB_ROOT, "node_modules/.bin/varlock");
const CONTRACT_FILES = [
  ".env.schema",
  ".env.infisical",
  ".varlock/config.json",
  "package.json",
  "scripts/env/preflight.mjs",
  "scripts/env/start-image.mjs",
];

// Varlock's Linux helper keeps one private key per user, whatever HOME says, and finds
// the session bus by itself. Only an explicit dead address keeps a fixture off the real
// keyring, so every Varlock subprocess runs under this environment.
export function sealedEnv(home: string, values: Record<string, string> = {}): NodeJS.ProcessEnv {
  if (home === homedir()) throw new Error("A fixture must not use the real home directory.");
  if (existsSync(NO_SESSION_BUS)) throw new Error("The fixture session bus must not exist.");
  return {
    ...values,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${NO_SESSION_BUS}`,
    HOME: home,
    PATH: process.env.PATH,
    VARLOCK_TELEMETRY_DISABLED: "true",
  } as unknown as NodeJS.ProcessEnv;
}

export interface Run {
  status: number | null;
  signal: NodeJS.Signals | null;
  pid: number | undefined;
  stdout: string;
  stderr: string;
}

/** Asynchronous, because a fixture store answers from this same process. */
export function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", fail);
    child.once("close", (status, signal) => done({ status, signal, pid: child.pid, stdout, stderr }));
  });
}

export interface Workspace {
  app: string;
  home: string;
  cleanup: () => void;
  /** Writes the machine's shared profile, as a host with an Infisical identity has. */
  addIdentity: () => void;
  load: (values?: Record<string, string>, filter?: string) => Promise<LoadResult>;
  varlock: (args: readonly string[], values?: Record<string, string>) => Promise<Run>;
  node: (args: readonly string[], values?: Record<string, string>) => Promise<Run>;
  npm: (args: readonly string[], values?: Record<string, string>) => Promise<Run>;
}

export interface LoadResult {
  status: number | null;
  invalid: string[];
  rootErrors: string[];
  values: Record<string, unknown>;
}

interface Graph {
  config: Record<string, { value?: unknown }>;
  errors?: { configItems?: Record<string, string>; root?: string[] };
}

function loadResult(result: Run): LoadResult {
  const graph = (result.stdout.trim() ? JSON.parse(result.stdout) : { config: {} }) as Graph;
  return {
    status: result.status,
    invalid: Object.keys(graph.errors?.configItems ?? {}).sort(),
    rootErrors: graph.errors?.root ?? [],
    values: Object.fromEntries(Object.entries(graph.config).map(([key, item]) => [key, item.value])),
  };
}

/** A private copy of the contract with its own HOME, so no real profile or env file loads. */
export function workspace(): Workspace {
  const base = mkdtempSync(join(tmpdir(), "ilcc-env-contract-"));
  const app = join(base, "app");
  const home = join(base, "home");
  mkdirSync(home);
  for (const file of CONTRACT_FILES) {
    mkdirSync(dirname(join(app, file)), { recursive: true });
    copyFileSync(join(WEB_ROOT, file), join(app, file));
  }
  symlinkSync(join(WEB_ROOT, "node_modules"), join(app, "node_modules"));

  const inApp = (command: string, args: readonly string[], values: Record<string, string> = {}) =>
    run(command, args, { cwd: app, env: sealedEnv(home, values) });
  const varlock: Workspace["varlock"] = (args, values) => inApp(VARLOCK, args, values);

  return {
    app,
    home,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
    addIdentity: () => {
      mkdirSync(join(home, ".config/varlock"), { recursive: true });
      writeFileSync(
        join(home, ".config/varlock/.env.infisical"),
        `INFISICAL_CLIENT_ID=${SYNTHETIC_CLIENT_ID}\nINFISICAL_CLIENT_SECRET=synthetic-client-secret\n`,
      );
    },
    load: async (values, filter) =>
      loadResult(
        await varlock(
          ["load", "--format", "json-full", "--compact", ...(filter ? ["--filter", filter] : [])],
          values,
        ),
      ),
    varlock,
    node: (args, values) => inApp(process.execPath, args, values),
    npm: (args, values) => inApp("npm", args, values),
  };
}

/** A fake Infisical that answers Universal Auth and the raw secrets call. */
export async function mockStore(
  secrets: Record<string, string> | (() => Record<string, string>),
  refuse = false,
) {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    calls.push(path);
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (refuse) return reply(403, { message: "refused" });
    if (path.startsWith("/api/v1/auth/universal-auth/login")) {
      return reply(200, {
        accessToken: "synthetic-access-token",
        expiresIn: 3600,
        accessTokenMaxTTL: 3600,
        tokenType: "Bearer",
      });
    }
    if (request.headers.authorization !== "Bearer synthetic-access-token") {
      return reply(401, { message: "unauthorized" });
    }
    if (path.startsWith("/api/v3/secrets/raw")) {
      const stored = typeof secrets === "function" ? secrets() : secrets;
      return reply(200, {
        secrets: Object.entries(stored).map(([secretKey, secretValue]) => ({ secretKey, secretValue })),
        imports: [],
      });
    }
    return reply(404, { message: "unexpected" });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The fixture store has no port.");
  return {
    calls,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((closed) => server.close(closed)),
  };
}
