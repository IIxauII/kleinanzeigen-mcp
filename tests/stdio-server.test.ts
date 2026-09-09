import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn as spawnProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const BUNDLE = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * The acceptance shape of SPEC 8.3: an MCP client spawns the built bundle over
 * stdio, lists its tools and calls one.
 *
 * A missing bundle **fails**, and used to be `describe.skipIf(!existsSync(
 * BUNDLE))` — which turned the only end-to-end test in the repo silently green
 * in exactly the state a fresh checkout is in. A guard that makes the one test
 * of a thing a no-op under the conditions the thing is untested is worse than
 * no guard (SPEC 8.6).
 */
describe("the built server over stdio", () => {
  beforeAll(() => {
    if (!existsSync(BUNDLE)) throw new Error(`no bundle at ${BUNDLE} — run \`npm run build\` first`);
  });

  async function spawn(): Promise<Client> {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BUNDLE] }));
    return client;
  }

  it("lists the tool surface built so far", async () => {
    const client = await spawn();
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)) //
        .toEqual(["search_listings", "get_listing", "get_shop", "find_category", "find_location", "find_shop"]);
    } finally {
      await client.close();
    }
  });

  it("resolves a category against the sidecar dataset", async () => {
    const client = await spawn();
    try {
      const result = await client.callTool({
        name: "find_category",
        arguments: { query: "Bahn & ÖPNV" },
      });
      expect(result.structuredContent).toMatchObject({
        count: 1,
        stale: false,
        source_url: null,
        matches: [
          {
            category_id: 286,
            name: "Bahn & ÖPNV",
            slug: "bahn-oepnv",
            path: "/s-bahn-oepnv/c286",
            parent_id: 231,
            parent_name: "Eintrittskarten & Tickets",
          },
        ],
      });
    } finally {
      await client.close();
    }
  });

  it("resolves a location against the sidecar dataset", async () => {
    const client = await spawn();
    try {
      const result = await client.callTool({
        name: "find_location",
        arguments: { query: "koeln" },
      });
      expect(result.structuredContent).toMatchObject({
        count: 1,
        stale: false,
        source_url: null,
        matches: [
          {
            location_id: 945,
            name: "Köln",
            slug: "koeln",
            level: "locality",
            state: "Nordrhein-Westfalen",
          },
        ],
      });
    } finally {
      await client.close();
    }
  });

  it("refuses to start on an invalid rate limit, before the transport opens", async () => {
    const child = spawnProcess(process.execPath, [BUNDLE], {
      env: { ...process.env, KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "soon" },
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));

    expect(code).not.toBe(0);
    expect(stderr).toContain("KLEINANZEIGEN_MCP_RATE_LIMIT_MS");
    expect(stderr).toContain("soon");
    // No silent fallback, and nothing on stdout: the transport never opened.
    expect(stderr).not.toContain("server_started");
    expect(stdout).toBe("");
  });

  it("takes no arguments at all: it serves, and there is no second thing it does", async () => {
    // `--check-drift` left the binary when the check moved to
    // `scripts/check-drift.ts`, and the usage string and the exit-64 refusal
    // path went with it. What is left has nothing to refuse (SPEC 7, 8.3).
    const child = spawnProcess(process.execPath, [BUNDLE, "--check-drift"]);
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const started = await new Promise<string>((resolve) => {
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        resolve(stderr);
      });
    });
    child.kill();

    expect(JSON.parse(started)).toMatchObject({ event: "server_started" });
    expect(stderr).not.toContain("usage:");
    expect(stderr).not.toContain("category_drift");
    // stdout belongs to the transport, and no drift report was written to it.
    expect(stdout).toBe("");
  });

  it("starts on a valid rate limit", async () => {
    const child = spawnProcess(process.execPath, [BUNDLE], {
      env: { ...process.env, KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "5000" },
    });
    const started = await new Promise<string>((resolve) => {
      child.stderr.on("data", (chunk: Buffer) => resolve(chunk.toString()));
    });
    child.kill();
    expect(JSON.parse(started)).toMatchObject({ event: "server_started", rate_limit_ms: 5000 });
  });
});
