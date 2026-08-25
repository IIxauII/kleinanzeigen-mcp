import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCK_MARKER } from "../fetch/breaker.ts";
import { configureFetchCore, resetFetchCore, type FetchImpl } from "../fetch/core.ts";
import { loadCityDataset, resetCityDataset } from "../locations/city-dataset.ts";
import type { SearchRow } from "../search/search-row.ts";
import { createServer } from "../server.ts";
import { SEARCH_LISTINGS_DESCRIPTION } from "./search-listings.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.html`, import.meta.url), "utf8");

const dataset = () => loadCityDataset(new URL("../../data/cities.json", import.meta.url));

type SearchResult = {
  listings: SearchRow[];
  total: number | null;
  reachable: number;
  range: { from: number; to: number } | null;
  clamped: boolean;
  organic_count: number;
  promoted_count: number;
  page: number;
  sort: string | null;
  location_resolution?: {
    input: string;
    resolved_to: { id: number; label: string } | null;
    ambiguous: boolean;
    alternatives: { id: number; label: string }[];
  };
  fetched_at: string;
  stale: boolean;
  stale_reason?: string;
  source_url: string | null;
};

let requested: string[];

/** Every page answers with the same fixture unless a test says otherwise. */
function serving(body: string | (() => Response)): FetchImpl {
  return async (url) => {
    requested.push(url);
    return typeof body === "string" ? new Response(body) : body();
  };
}

async function connect(fetchImpl: FetchImpl, readCityDataset = dataset): Promise<Client> {
  configureFetchCore({ rateLimitMs: 0, fetchImpl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    createServer({ readCityDataset }).connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

async function search(client: Client, args: Record<string, unknown>): Promise<SearchResult> {
  const result = await client.callTool({ name: "search_listings", arguments: args });
  expect(result.isError).toBeFalsy();
  return result.structuredContent as unknown as SearchResult;
}

beforeEach(() => {
  requested = [];
  resetFetchCore();
  resetCityDataset();
  vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  resetFetchCore();
});

describe("search_listings over MCP", () => {
  it("is listed with the spec's description and the spec's arguments", async () => {
    const { tools } = await (await connect(serving(fixture("search-page-1")))).listTools();
    const tool = tools.find((candidate) => candidate.name === "search_listings");
    expect(tool).toBeDefined();
    expect(tool!.description).toBe(SEARCH_LISTINGS_DESCRIPTION);
    expect(Object.keys(tool!.inputSchema.properties ?? {}).sort()).toEqual([
      "ad_type",
      "buy_now",
      "category_id",
      "keywords",
      "location",
      "location_id",
      "max_price",
      "min_price",
      "page",
      "poster_type",
      "radius",
      "shipping",
      "shipping_carrier",
      "sort",
    ]);
  });

  it("costs exactly one request for one page, and never fans out over its rows", async () => {
    // 27 listings, one request. Enriching them with detail fetches would be a
    // silent 25× rate-limit multiplier behind one call (SPEC 2.5).
    const client = await connect(serving(fixture("search-page-1")));
    const result = await search(client, { keywords: "fahrrad", location: "Berlin", radius: 20 });
    expect(requested).toHaveLength(1);
    expect(result.listings).toHaveLength(27);
  });

  it("addresses page N directly, with the keyword on the query string", async () => {
    const client = await connect(serving(fixture("search-page-50")));
    await search(client, { keywords: "fahrrad", page: 50 });
    expect(requested).toEqual(["https://www.kleinanzeigen.de/s-seite:50/k0?keywords=fahrrad"]);
  });

  it("states the total and the reachable ceiling as two separate numbers", async () => {
    // `reachable: 1250` against `total: 39183` is the number that tells an
    // agent to narrow rather than walk 50 pages. Collapsing them into
    // `min(stated, 1250)` is the failure this surface exists to avoid (SPEC 4.1).
    const client = await connect(serving(fixture("search-page-1")));
    const result = await search(client, { keywords: "fahrrad" });
    expect(result.total).toBe(39183);
    expect(result.reachable).toBe(1250);
    expect(result.range).toEqual({ from: 1, to: 25 });
  });

  it("states the organic and promoted counts, so the caller never infers them", async () => {
    const client = await connect(serving(fixture("search-page-1")));
    const result = await search(client, { keywords: "fahrrad" });
    expect(result.organic_count).toBe(25);
    expect(result.promoted_count).toBe(2);
    expect(result.listings).toHaveLength(27);
    expect(result.listings.filter((listing) => listing.promoted)).toHaveLength(2);
  });

  it("reports a clamped page as clamped rather than as data", async () => {
    const client = await connect(serving(fixture("search-page-51-clamped")));
    const result = await search(client, { keywords: "fahrrad", page: 51 });
    expect(result).toMatchObject({ page: 51, clamped: true, range: { from: 1226, to: 1250 } });
    expect(result.listings).toHaveLength(27);
  });

  it("answers an honest empty set as a normal result", async () => {
    const client = await connect(serving(fixture("search-empty")));
    const result = await client.callTool({
      name: "search_listings",
      arguments: { keywords: "qzxwvnoresultsforthisquery" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ listings: [], total: 0, range: null });
  });

  it("reports what sort was sent, never what was applied", async () => {
    // The applied sort cannot be read back: the dropdown reads `Neueste`
    // regardless, and `c216` silently ranks by `MOBILEDE_RECOMMENDED` (SPEC 4.1).
    const client = await connect(serving(fixture("search-page-1")));
    expect((await search(client, { keywords: "fahrrad" })).sort).toBeNull();
    expect((await search(client, { keywords: "rad", sort: "PRICE_AMOUNT" })).sort).toBe(
      "PRICE_AMOUNT",
    );
  });
});

describe("the location the site resolved for itself", () => {
  it("ships the ambiguity as a value, naming every candidate", async () => {
    const client = await connect(serving(fixture("search-page-1")));
    const { location_resolution } = await search(client, { keywords: "rad", location: "Neustadt" });
    expect(location_resolution?.ambiguous).toBe(true);
    // No pick: naming one would be the same silent choice this field exposes.
    expect(location_resolution?.resolved_to).toBeNull();
    expect(location_resolution?.alternatives.length).toBeGreaterThan(1);
    expect(location_resolution?.alternatives.map((one) => one.label)).toContain(
      "Bayern > Neustadt",
    );
  });

  it("resolves an unambiguous name", async () => {
    const client = await connect(serving(fixture("search-page-1")));
    const { location_resolution } = await search(client, { keywords: "rad", location: "Flensburg" });
    expect(location_resolution).toEqual({
      input: "Flensburg",
      resolved_to: { id: 714, label: "Schleswig-Holstein > Flensburg" },
      ambiguous: false,
      alternatives: [],
    });
  });

  it("says a postcode resolved to nothing rather than guessing", async () => {
    // The postcode layer's ids are absent from every allowed source, so the
    // site resolves it and this field cannot say how. See SPEC §4.1's correction.
    const client = await connect(serving(fixture("search-page-1")));
    const { location_resolution } = await search(client, { keywords: "rad", location: "10115" });
    expect(location_resolution).toEqual({
      input: "10115",
      resolved_to: null,
      ambiguous: false,
      alternatives: [],
    });
  });

  it("is absent, and the dataset untouched, where no free text was resolved", async () => {
    // A keyword-only search never reads a bundled dataset (SPEC 7).
    const readCityDataset = vi.fn(dataset);
    const client = await connect(serving(fixture("search-page-1")), readCityDataset);
    expect((await search(client, { keywords: "rad" })).location_resolution).toBeUndefined();
    expect((await search(client, { keywords: "rad", location_id: 3331 })).location_resolution) //
      .toBeUndefined();
    expect(readCityDataset).not.toHaveBeenCalled();
  });
});

describe("the arguments the site cannot be asked about", () => {
  it("refuses two location inputs, which resolve at different stages", async () => {
    const client = await connect(serving(fixture("search-page-1")));
    const result = await client.callTool({
      name: "search_listings",
      arguments: { location: "Berlin", location_id: 3331 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("mutually exclusive");
    expect(requested).toHaveLength(0);
  });

  it("refuses a radius with nothing to be a radius of", async () => {
    const client = await connect(serving(fixture("search-page-1")));
    const result = await client.callTool({
      name: "search_listings",
      arguments: { radius: 20 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("radius requires location");
    expect(requested).toHaveLength(0);
  });
});

describe("the operational failures", () => {
  it("surfaces a block as isError, never as an empty list", async () => {
    const client = await connect(serving(`<html><body>${BLOCK_MARKER}</body></html>`));
    const result = await client.callTool({
      name: "search_listings",
      arguments: { keywords: "fahrrad" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("block");
  });

  it("surfaces the degenerate signature as isError", async () => {
    const doctored = fixture("search-page-1").replace(/1 - 25 von 39\.183[^<]*/u, "1 - 1 von 1");
    const client = await connect(serving(doctored));
    const result = await client.callTool({
      name: "search_listings",
      arguments: { category_id: 217 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("parse_failure");
  });
});
