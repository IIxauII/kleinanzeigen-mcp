import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshCheckout, removeCheckouts } from "./fresh-checkout.ts";

/**
 * Cold-install verification (SPEC 8.6): pack the tarball, install it into a
 * temp prefix, and drive the *installed* binary through a real handshake.
 *
 * `tests/packaging.test.ts` reads manifest fields and `npm pack`'s file list;
 * `tests/stdio-server.test.ts` drives `dist/index.js` in a tree with every
 * dependency on disk beside it. Neither runs the artifact a user gets, so
 * neither can see the two failures this file exists for:
 *
 * - **A dependency escaping the bundle.** With `dependencies` absent (SPEC
 *   8.1) an install brings nothing, so a missed `noExternal` edge ships a
 *   tarball that dies on `import` at every user's first call. The
 *   `devDependencies` move is safe only because this test runs, and the two
 *   decisions may not be separated.
 * - **A tarball packed without a build.** `dist/` is gitignored, so without
 *   `prepack` the package is `README.md` + `package.json` and a `bin` pointing
 *   at nothing — a failure this project has already had once.
 *
 * It is a test rather than a smoke script so that `npm test` stays the single
 * gate and local and CI cannot drift.
 */

const TOOLS = ["search_listings", "get_listing", "get_shop", "find_category", "find_location", "find_shop"];

/** The `initialize` / `initialized` / `tools/list` exchange as bytes on the wire. */
const FRAMES = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      // Negotiated down by the server if it has moved on, which is fine: what
      // this exchange is read for is the shape of the two streams, not the
      // version it settles on.
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "cold-install-probe", version: "0.0.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
];

let prefix: string | undefined;
let binary: string;
/** The tarball's own `package.json`, as unpacked into the prefix. */
let installed: { version: string };

beforeAll(() => {
  // `npm pack` from a checkout without `dist/`, so `prepack` has to produce the
  // bundle the tarball then ships — a stale or absent `dist/` cannot pass here.
  const checkout = freshCheckout();
  // The filename comes from npm's own report rather than from a `.tgz` glob
  // over the checkout: `*.tgz` is not gitignored, so a tarball left in the repo
  // root is copied in with everything else, and a glob could install last
  // week's artifact while this run's pack sat beside it untouched.
  const out = execFileSync("npm", ["pack", "--json"], { cwd: checkout, encoding: "utf8", stdio: "pipe" });
  // `prepack` runs the build, and tsup's log can share this stdout — the report
  // is the JSON array that starts on a line of its own after it.
  const start = out.search(/^\[$/m);
  expect(start, `no JSON report in \`npm pack\` output:\n${out}`).toBeGreaterThanOrEqual(0);
  const tarball = join(checkout, JSON.parse(out.slice(start))[0].filename);

  // A real temp prefix, never the repo tree: an install into the repo would
  // resolve against the dependencies already sitting in `node_modules/` and
  // prove nothing about what a user receives.
  prefix = mkdtempSync(join(tmpdir(), "kleinanzeigen-install-"));
  execFileSync("npm", ["install", tarball, "--prefix", prefix], { cwd: prefix, stdio: "pipe" });

  binary = join(prefix, "node_modules", ".bin", "kanzeigen-mcp");
  installed = JSON.parse(readFileSync(join(prefix, "node_modules", "kanzeigen-mcp", "package.json"), "utf8"));
}, 180_000);

afterAll(() => {
  // Guarded and last: a `beforeAll` that threw before the prefix existed would
  // otherwise have its real error replaced by an `ERR_INVALID_ARG_TYPE` here.
  try {
    removeCheckouts();
  } finally {
    if (prefix) rmSync(prefix, { recursive: true, force: true });
  }
});

/** An MCP client against the installed binary — what a user's client does. */
async function connect(): Promise<Client> {
  const client = new Client({ name: "cold-install-test", version: "0.0.0" });
  // `stderr: "ignore"`: the server's one log line is asserted by
  // `driveByHand()`, where the process has exited and the stream has flushed.
  await client.connect(new StdioClientTransport({ command: binary, stderr: "ignore" }));
  return client;
}

type HandRun = { stdout: string; stderr: string; code: number | null };

let exchanged: Promise<HandRun> | undefined;

/**
 * One hand-driven exchange, run on first use and shared by the two assertions
 * that read a stream off it. SPEC 8.6 describes a single run of the binary with
 * a claim about each of its two streams, and reading both off one exchange is
 * that, rather than two runs that could disagree.
 *
 * Memoised rather than hoisted into `beforeAll` on purpose: a bundle that
 * cannot spawn must land as a *failing test*. Vitest reports a hook that threw
 * by marking every test in the file skipped, and a packaging suite that reads
 * as skipped when packaging is broken is the exact defect SPEC 8.6 names.
 */
function exchange(): Promise<HandRun> {
  return (exchanged ??= driveByHand());
}

/**
 * The exchange spoken by hand, so both streams can be read as bytes. Closing
 * stdin ends the server, which flushes stderr before we assert on it.
 */
function driveByHand(): Promise<HandRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    // A tarball packed without a build leaves `bin` pointing at nothing, and
    // the spawn fails rather than closing. Rejecting names that outright
    // instead of letting the test sit until vitest's timeout.
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.stdin.end(FRAMES.map((frame) => `${JSON.stringify(frame)}\n`).join(""));
  });
}

describe("the installed tarball", () => {
  it("brings one package, which is the whole cost of a cold `npx` start", () => {
    // The observed half of SPEC 8.1: the manifest saying `dependencies` is
    // absent is pinned in `tests/packaging.test.ts`, and this is npm acting on
    // it — one package, where declaring the three inlined ones cost 110.
    //
    // Deliberately *not* the guard against a dependency escaping `noExternal`:
    // with `dependencies` absent npm brings nothing whatever the bundle
    // imports, so an escaped `import "cheerio"` still leaves exactly this one
    // directory here. That escape dies at `import` time, and the two handshake
    // tests below are what catch it.
    const packages = readdirSync(join(prefix!, "node_modules"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== ".bin")
      .map((entry) => entry.name);
    expect(packages).toEqual(["kanzeigen-mcp"]);
  });

  it("answers a real MCP handshake with the version its own package.json declares", async () => {
    // Where *the version is the provenance* (SPEC 7) is proved end to end: the
    // constant in `src/version.ts` reaches `serverInfo` through the bundle, and
    // `src/version.test.ts` holds that constant to the manifest the release
    // commits back (SPEC 8.7). A tarball built at one version and stamped at
    // another fails here.
    const client = await connect();
    try {
      expect(client.getServerVersion()).toMatchObject({
        name: "kleinanzeigen-mcp",
        version: installed.version,
      });
    } finally {
      await client.close();
    }
  });

  it("serves the six tools out of the installed bundle", async () => {
    // `tests/stdio-server.test.ts` asserts this same list against the bundle in
    // the repo. Here it also proves the two sidecar datasets and every inlined
    // dependency survived the pack: the tool surface is built by
    // `createServer()`, which is unreachable if the bundle fails to import.
    const client = await connect();
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(TOOLS);
    } finally {
      await client.close();
    }
  });

  it("logs exactly one server_started line, and logs it to stderr", async () => {
    // The whole stream, not a search within it: `log()` writes one JSON object
    // per line to stderr and nothing else does (SPEC 6.4, ADR-0002), so a
    // second `server_started` from a double connect, a bundled dependency's
    // warning, or a Node runtime notice all fail here — and all three would
    // otherwise reach every user's client log unnoticed.
    const { stderr, code } = await exchange();

    expect(code).toBe(0);
    const lines = stderr.split("\n").filter((line) => line.length > 0);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "server_started", transport: "stdio", rate_limit_ms: expect.any(Number) },
    ]);
  });

  it("puts nothing on stdout that is not JSON-RPC", async () => {
    // Strict, because stdout *is* the transport: one stray `console.log`, one
    // banner, one warning from a bundled dependency, and every client's parse
    // breaks (SPEC 6.4, 8.3). A dependency that prints only on the cold path an
    // installed copy takes is invisible to every other test in this repo.
    const { stdout } = await exchange();

    const lines = stdout.split("\n").filter((line) => line.length > 0);
    for (const line of lines) {
      expect(() => JSON.parse(line), `not JSON on stdout: ${line}`).not.toThrow();
      expect(JSON.parse(line), line).toMatchObject({ jsonrpc: "2.0" });
    }
    // Both requests answered, so the run the purity check read was a real
    // exchange and not a process that died before writing anything.
    expect(lines.map((line) => JSON.parse(line).id)).toEqual([1, 2]);
  });
});
