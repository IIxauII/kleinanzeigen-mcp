// PROTOTYPE (issue #43) — measures the serialized JSON-RPC wire size of the
// largest realistic tool results against the v2 stdio 10 MB ReadBuffer cap.
// Throwaway: delete with the rest of the prototype branch.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import { configureFetchCore, resetFetchCore, type FetchImpl } from "../fetch/core.ts";
import { createServer } from "../server.ts";

const fixture = (name: string, extension = "html"): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.${extension}`, import.meta.url), "utf8");

const CAP = 10 * 1024 * 1024;

function site(body: string): FetchImpl {
  return async (url) => {
    const r = new Response(body, { status: 200 });
    Object.defineProperty(r, "url", { value: url });
    return r;
  };
}

async function connect(fetchImpl: FetchImpl): Promise<Client> {
  configureFetchCore({ rateLimitMs: 0, fetchImpl });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "m", version: "0" });
  await Promise.all([client.connect(ct), createServer().connect(st)]);
  return client;
}

async function measure(label: string, body: string, name: string, args: Record<string, unknown>) {
  const client = await connect(site(body));
  const result = await client.callTool({ name, arguments: args });
  // The wire message is the whole JSON-RPC response, not just the result.
  const wire = Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), "utf8");
  const sc = Buffer.byteLength(JSON.stringify((result as any).structuredContent ?? {}), "utf8");
  const txt = Buffer.byteLength(JSON.stringify((result as any).content ?? []), "utf8");
  appendFileSync(
    "/tmp/proto43-sizes.txt",
    `${label}: wire=${wire}B (${(wire / 1024).toFixed(1)} KB) structuredContent=${sc}B contentText=${txt}B headroom=${(CAP / wire).toFixed(0)}x\n`,
  );
  await client.close();
  resetFetchCore();
  vi.restoreAllMocks();
}

describe("PROTOTYPE payload sizing", () => {
  it("measures the largest realistic payloads", async () => {
    await measure("search_listings p1 (25 organic + promoted)", fixture("search-page-1"), "search_listings", { keywords: "fahrrad" });
    await measure("search_listings p50 (deepest page)", fixture("search-page-50"), "search_listings", { keywords: "fahrrad", page: 50 });
    await measure("get_shop p1 (island, full profile)", fixture("shop-page"), "get_shop", { shop_slug: "Synthetisches-Musterhaus-GmbH-0" });
    await measure("find_shop (50 matches/page)", fixture("shop-directory", "json"), "find_shop", { name: "a" });
    // Dataset resolvers: bounded by the bundled dataset, not by a page.
    await measure("find_location broad ('e')", "", "find_location", { query: "e" });
    await measure("find_location broad ('er')", "", "find_location", { query: "er" });
    await measure("find_category broad ('e')", "", "find_category", { query: "e" });
  });
});
