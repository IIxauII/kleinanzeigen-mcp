import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCategoryTreeLoaded, resetCategoryTree, type CategoryTree } from "../categories/category-tree.ts";
import { configureFetchCore, resetFetchCore, type FetchImpl } from "../fetch/core.ts";
import type { CityDataset } from "../locations/city-dataset.ts";
import { createServer } from "../server.ts";
import { DIRECTORY_PAGE_SIZE } from "../shop/directory-request.ts";
import { FIND_SHOP_DESCRIPTION, type FindShopResult } from "./find-shop.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.json`, import.meta.url), "utf8");

const DIRECTORY_URL = "https://www.kleinanzeigen.de/_actions/proPublicWeb.brandingIndex.searchBrandings/";

const TREE: CategoryTree = [
  { category_id: 210, name: "Auto, Rad & Boot", slug: "auto-rad-boot", path: "auto-rad-boot", parent_id: null, parent_name: null },
];

const CITIES: CityDataset = [
  { location_id: 3331, name: "Köln", slug: "koeln", level: "locality", state: "Nordrhein-Westfalen" },
];

type Sent = { url: string; method: string; body: Record<string, unknown> };

let sent: Sent[];

function landing(body: string | null, status = 200): Response {
  const response = new Response(status === 204 ? null : body, { status });
  Object.defineProperty(response, "url", { value: DIRECTORY_URL });
  return response;
}

/** The directory, answering from one fixture. */
function site(name: string, status = 200): FetchImpl {
  return async (url, init) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return landing(fixture(name), status);
  };
}

async function connect(fetchImpl: FetchImpl): Promise<Client> {
  configureFetchCore({ rateLimitMs: 0, fetchImpl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    createServer({ readCategoryTree: () => TREE, readCityDataset: () => CITIES }).connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

async function find(client: Client, args: Record<string, unknown>): Promise<FindShopResult> {
  const result = await client.callTool({ name: "find_shop", arguments: args });
  expect(result.isError).toBeFalsy();
  return result.structuredContent as unknown as FindShopResult;
}

beforeEach(() => {
  sent = [];
  resetFetchCore();
  resetCategoryTree();
  vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  resetFetchCore();
  resetCategoryTree();
});

describe("find_shop over MCP", () => {
  it("is listed with the spec's description, which says it makes a live request", async () => {
    const { tools } = await (await connect(site("shop-directory"))).listTools();
    const tool = tools.find(({ name }) => name === "find_shop");
    expect(tool?.description).toBe(FIND_SHOP_DESCRIPTION);
    expect(tool?.description).toContain("Makes a live request");
    expect(tool?.description).toContain("a mention in a shop's profile");
  });

  it("returns candidates and never auto-selects, even at a count of one", async () => {
    const client = await connect(site("shop-directory"));
    const result = await find(client, { name: "autohaus" });
    expect(result.matches).toHaveLength(50);
    expect(result.matches[0]).toEqual({
      name: "Synthetisches Musterhaus GmbH 0",
      shop_slug: "Synthetisches-Musterhaus-GmbH-0",
      seller_id: 21000000,
      location: "Musterstadt",
      ads_online: 52,
      logo_url:
        "https://img.kleinanzeigen.de/api/v1/prod-ads/images/00/00000000-0000-4000-8000-000000000900?rule=$_0.JPG",
    });
    // The shape is a list and stays a list: `fulltext` matches profile prose,
    // so a single exact hit can still be the wrong shop (SPEC 4.5).
    expect(result).not.toHaveProperty("shop");
    expect(result).not.toHaveProperty("best");
  });

  it("reports the whole match set as count, not the page", async () => {
    const result = await find(await connect(site("shop-directory")), { name: "autohaus" });
    expect(result.count).toBe(348);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(DIRECTORY_PAGE_SIZE);
  });

  it("answers zero matches as a normal result rather than an error", async () => {
    const client = await connect(site("shop-directory-empty"));
    const result = await client.callTool({ name: "find_shop", arguments: { name: "kein-unternehmen-xyz123" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ matches: [], count: 0 });
  });

  it("makes exactly one request, through the shared limiter and cache", async () => {
    const client = await connect(site("shop-directory"));
    await find(client, { name: "autohaus" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: DIRECTORY_URL, method: "POST" });
    // The second call is the cache's, and it issues no request at all.
    const cached = await find(client, { name: "autohaus" });
    expect(sent).toHaveLength(1);
    expect(cached.stale).toBe(false);
  });

  it("keys the cache on the body, so page 2 is not served for page 1", async () => {
    const client = await connect(site("shop-directory"));
    await find(client, { name: "autohaus" });
    await find(client, { name: "autohaus", page: 2 });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body["from"]).toBe(50);
  });

  it("passes the caller's string through and never transliterates it", async () => {
    await find(await connect(site("shop-directory")), { name: "Köln" });
    expect(sent[0]!.body["fulltext"]).toBe("Köln");
  });

  it("does not expose page size, view or search scope, and fixes them in code", async () => {
    const client = await connect(site("shop-directory"));
    const refused = await client.callTool({ name: "find_shop", arguments: { name: "x", page_size: 20 } });
    expect(refused.isError).toBe(true);
    await find(client, { name: "x" });
    expect(sent[0]!.body).toMatchObject({ pageSize: 50, view: "CARD", searchScope: "BOTH" });
  });

  it("validates the two filter ids against the bundled trees, at no request", async () => {
    const client = await connect(site("shop-directory"));
    const refused = await client.callTool({ name: "find_shop", arguments: { name: "x", category_id: 999 } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("find_category");
    expect(sent).toHaveLength(0);

    await find(client, { name: "x", category_id: 210, location_id: 3331 });
    expect(sent[0]!.body).toMatchObject({ categoryId: 210, locationId: 3331 });
  });

  it("reads no bundled dataset for a name-only lookup", async () => {
    // The real loader, not the test one: a keyword-only call must not touch
    // the tree on disk (SPEC 7).
    configureFetchCore({ rateLimitMs: 0, fetchImpl: site("shop-directory") });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      createServer({ readCityDataset: () => CITIES }).connect(serverTransport),
      client.connect(clientTransport),
    ]);
    await find(client, { name: "autohaus" });
    expect(isCategoryTreeLoaded()).toBe(false);
  });

  it("treats HTTP 204 with a zero-byte body as an error, never as zero results", async () => {
    const client = await connect(site("shop-directory", 204));
    const result = await client.callTool({ name: "find_shop", arguments: { name: "autohaus" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("http_error");
  });

  it("carries the envelope every result carries", async () => {
    const result = await find(await connect(site("shop-directory")), { name: "autohaus" });
    expect(result.source_url).toBe(DIRECTORY_URL);
    expect(result.stale).toBe(false);
    expect(result.fetched_at).toBe("2026-08-25T12:00:00.000Z");
  });
});
