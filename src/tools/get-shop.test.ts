import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureFetchCore, resetFetchCore, type FetchImpl } from "../fetch/core.ts";
import { createServer } from "../server.ts";
import { SHOP_PAGE_SIZE } from "../shop/shop-request.ts";
import { GET_SHOP_DESCRIPTION, type GetShopResult } from "./get-shop.ts";

const fixture = (name: string, extension = "html"): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.${extension}`, import.meta.url), "utf8");

/** The slug the shop fixtures were captured under (SPEC 8.6). */
const SLUG = "Synthetisches-Musterhaus-GmbH-0";

const SHOP_URL = `https://www.kleinanzeigen.de/pro/${SLUG}`;
const RPC_URL = "https://www.kleinanzeigen.de/_actions/proPublicWeb.brandProfile.getAds/";

type Sent = { url: string; method: string; body: unknown };

let sent: Sent[];

function landing(body: string, url: string, status = 200): Response {
  const response = new Response(status === 204 ? null : body, { status });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

/** The site, answering the shop page from one fixture and the RPC from another. */
function site(page: string, rpc: string, status = 200): FetchImpl {
  return async (url, init) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return url === RPC_URL
      ? landing(fixture(rpc, "json"), url, status)
      : landing(fixture(page), url);
  };
}

async function connect(fetchImpl: FetchImpl): Promise<Client> {
  configureFetchCore({ rateLimitMs: 0, fetchImpl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function get(client: Client, args: Record<string, unknown>): Promise<GetShopResult> {
  const result = await client.callTool({ name: "get_shop", arguments: args });
  expect(result.isError).toBeFalsy();
  return result.structuredContent as unknown as GetShopResult;
}

beforeEach(() => {
  sent = [];
  resetFetchCore();
  vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  resetFetchCore();
});

describe("get_shop over MCP", () => {
  it("is listed with the spec's description, which says private sellers cannot be reached", async () => {
    const { tools } = await (await connect(site("shop-page", "shop-ads-page-2"))).listTools();
    const tool = tools.find((candidate) => candidate.name === "get_shop");
    expect(tool).toBeDefined();
    expect(tool!.description).toBe(GET_SHOP_DESCRIPTION);
    expect(Object.keys(tool!.inputSchema.properties ?? {}).toSorted()).toEqual([
      "category_id",
      "keywords",
      "location_id",
      "max_price",
      "min_price",
      "page",
      "shop_slug",
    ]);
  });

  it("answers page 1 with profile and 25 listings, from one GET and nothing else", async () => {
    const client = await connect(site("shop-page", "shop-ads-page-2"));
    const result = await get(client, { shop_slug: SLUG });
    expect(sent).toEqual([{ url: SHOP_URL, method: "GET", body: undefined }]);
    expect(result).toMatchObject({ status: "ok", page: 1, count: 25 });
    expect(result.shop).toMatchObject({ shop_slug: SLUG, ads_online: 30, seller_id: 21000000 });
    expect(result.listings).toHaveLength(25);
    expect(result.source_url).toBe(SHOP_URL);
  });

  it("pages through the RPC, one POST per page, and never re-reads page 1", async () => {
    // The shop page does not paginate: both query spellings return a
    // byte-identical page 1 and the path form 404s (SPEC 5.2).
    const client = await connect(site("shop-page", "shop-ads-page-2"));
    const result = await get(client, { shop_slug: SLUG, page: 2 });
    expect(sent).toEqual([
      { url: RPC_URL, method: "POST", body: { brandName: SLUG, pageSize: SHOP_PAGE_SIZE, pageNum: 2 } },
    ]);
    expect(result).toMatchObject({ status: "ok", page: 2, count: 5, shop: null });
    expect(result.listings).toHaveLength(5);
  });

  it("sends a filtered page 1 to the RPC too, because the shop page does not filter", async () => {
    const client = await connect(site("shop-page", "shop-ads-page-2"));
    const result = await get(client, { shop_slug: SLUG, keywords: "kajak", min_price: 20 });
    expect(sent).toEqual([
      {
        url: RPC_URL,
        method: "POST",
        body: { brandName: SLUG, keywords: "kajak", minPrice: "20", pageSize: SHOP_PAGE_SIZE, pageNum: 1 },
      },
    ]);
    // The profile lives in the shop page's islands and the RPC carries none of
    // it; a second request behind one call is the multiplier §2.5 refuses.
    expect(result.shop).toBeNull();
  });

  it("reports the end of the walk as an answer, not as an error", async () => {
    const client = await connect(site("shop-page", "shop-ads-empty"));
    const result = await get(client, { shop_slug: SLUG, page: 3 });
    expect(result).toMatchObject({ status: "ok", page: 3, count: 0, listings: [] });
  });

  it("answers gone for a slug that names no shop, without parsing the page it was served", async () => {
    // The page is HTTP 200, 111 kB, and shop-shaped. `gone` is a normal
    // result, and never an error a caller would retry (SPEC 6.3).
    const client = await connect(site("shop-page-unknown", "shop-ads-page-2"));
    const result = await get(client, { shop_slug: "kein-shop-mit-diesem-slug" });
    expect(result).toMatchObject({ status: "gone", shop: null, listings: [], count: 0 });
  });

  it("treats the RPC's 204 as a failure, never as an empty inventory", async () => {
    // The RPC answers an unknown `brandName` with 204 and a zero-byte body.
    // Reported as zero listings it would say a shop is empty (SPEC 4.5).
    const client = await connect(site("shop-page", "shop-ads-empty", 204));
    const result = await client.callTool({ name: "get_shop", arguments: { shop_slug: SLUG, page: 2 } });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({ error: "http_error" });
  });

  it("caches each RPC page under its own key, because both pages are one URL", async () => {
    const client = await connect(site("shop-page", "shop-ads-page-2"));
    await get(client, { shop_slug: SLUG, page: 2 });
    await get(client, { shop_slug: SLUG, page: 2 });
    await get(client, { shop_slug: SLUG, page: 3 });
    expect(sent.map((request) => (request.body as { pageNum: number }).pageNum)).toEqual([2, 3]);
  });

  it("refuses a slug that is a pasted URL rather than repairing it", async () => {
    const client = await connect(site("shop-page", "shop-ads-page-2"));
    const result = await client.callTool({ name: "get_shop", arguments: { shop_slug: `/pro/${SLUG}` } });
    expect(result.isError).toBe(true);
    expect(sent).toEqual([]);
  });
});
