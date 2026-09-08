import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCK_MARKER } from "../fetch/breaker.ts";
import { configureFetchCore, resetFetchCore, type FetchImpl } from "../fetch/core.ts";
import { ListingResultSchema } from "../listing/listing.ts";
import { createServer } from "../server.ts";
import { GET_LISTING_DESCRIPTION, type GetListingResult } from "./get-listing.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.html`, import.meta.url), "utf8");

/** The ad id the private-offer fixture was captured under (SPEC 8.6). */
const AD_ID = "3400000000";

let requested: string[];

/**
 * A response that knows where it ended up, which is what the guard reads. The
 * `Response` constructor leaves `url` empty, and the site's own answer never
 * does.
 */
function landing(body: string, url: string): Response {
  const response = new Response(body);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function serving(body: string, url = `https://www.kleinanzeigen.de/s-anzeige/x/${AD_ID}`): FetchImpl {
  return async (asked) => {
    requested.push(asked);
    return landing(body, url);
  };
}

async function connect(fetchImpl: FetchImpl): Promise<Client> {
  configureFetchCore({ rateLimitMs: 0, fetchImpl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function get(client: Client, args: Record<string, unknown>): Promise<GetListingResult> {
  const result = await client.callTool({ name: "get_listing", arguments: args });
  expect(result.isError).toBeFalsy();
  return result.structuredContent as unknown as GetListingResult;
}

beforeEach(() => {
  requested = [];
  resetFetchCore();
  vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  resetFetchCore();
});

describe("get_listing over MCP", () => {
  it("is listed with the spec's description, and asks for the ad id alone", async () => {
    // The slug and the trailing codes in a listing URL are cosmetic, so they
    // are not asked of the caller (SPEC 4.2).
    const { tools } = await (await connect(serving(fixture("listing-private-offer")))).listTools();
    const tool = tools.find((candidate) => candidate.name === "get_listing");
    expect(tool).toBeDefined();
    expect(tool!.description).toBe(GET_LISTING_DESCRIPTION);
    expect(Object.keys(tool!.inputSchema.properties ?? {})).toEqual(["ad_id"]);
  });

  it("costs exactly one request, and never fans out over what it read", async () => {
    // Not the seller's other listings, not the related ones, not the view
    // counter — all of which this very page links to (SPEC 2.5).
    const client = await connect(serving(fixture("listing-private-offer")));
    const listing = await get(client, { ad_id: AD_ID });
    expect(requested).toEqual([`https://www.kleinanzeigen.de/s-anzeige/x/${AD_ID}`]);
    expect(listing).toMatchObject({ status: "ok", ad_id: AD_ID, title: "Synthetisches Inserat 0" });
  });

  it("answers with the listing, the envelope, and a shape the spec's union accepts", async () => {
    const client = await connect(serving(fixture("listing-private-offer")));
    const { fetched_at, stale, source_url, ...listing } = await get(client, { ad_id: AD_ID });
    expect(typeof fetched_at).toBe("string");
    expect(stale).toBe(false);
    expect(source_url).toBe(`https://www.kleinanzeigen.de/s-anzeige/x/${AD_ID}`);
    expect(ListingResultSchema.parse(listing)).toMatchObject({
      status: "ok",
      price: { kind: "Fixed", amount: 730 },
      seller: { seller_type: "PRIVATE" },
      flags: { expired: false, paused: false, deleted_veil: false },
    });
  });

  it("serves a second call for the same listing from the cache", async () => {
    // The fresh window is uniform for search and detail alike (SPEC 6.1).
    const client = await connect(serving(fixture("listing-private-offer")));
    await get(client, { ad_id: AD_ID });
    await get(client, { ad_id: AD_ID });
    expect(requested).toHaveLength(1);
  });
});

describe("the deleted-ad guard", () => {
  it("says gone rather than handing back the page of other listings it landed on", async () => {
    // A missing listing 301s to a browse page and answers 200 with a full page
    // of *other* listings. Without the guard this call returns one of them,
    // confidently (SPEC 5.3).
    const client = await connect(serving(fixture("search-page-1"), "https://www.kleinanzeigen.de/"));
    const result = await get(client, { ad_id: "1000000000" });
    expect(result.status).toBe("gone");
    expect(requested).toHaveLength(1);
  });

  it("returns gone as a normal result, with a discriminant and no listing on it", async () => {
    // Dressing "this listing no longer exists" as an error invites the agent
    // to retry it (SPEC 6.3).
    const client = await connect(serving(fixture("search-page-1"), "https://www.kleinanzeigen.de/"));
    const raw = await client.callTool({ name: "get_listing", arguments: { ad_id: "1000000000" } });
    expect(raw.isError).toBeFalsy();
    const { fetched_at, stale, source_url, ...result } = raw.structuredContent as unknown as GetListingResult;
    expect(ListingResultSchema.parse(result)).toEqual({ status: "gone" });
    expect(typeof fetched_at).toBe("string");
    expect(stale).toBe(false);
    expect(source_url).toBe("https://www.kleinanzeigen.de/s-anzeige/x/1000000000");
  });

  it("says gone for a browse page synthesised from a URL's own codes", async () => {
    const client = await connect(
      serving(fixture("search-page-1"), "https://www.kleinanzeigen.de/s-fahrraeder/weisswasser/c217l4069"),
    );
    expect((await get(client, { ad_id: "1000000000" })).status).toBe("gone");
  });
});

describe("the arguments the tool does not have", () => {
  it("refuses a listing URL where an ad id belongs, before spending a request", async () => {
    const client = await connect(serving(fixture("listing-private-offer")));
    for (const ad_id of [`https://www.kleinanzeigen.de/s-anzeige/x/${AD_ID}`, `${AD_ID}-217-4070`]) {
      const result = await client.callTool({ name: "get_listing", arguments: { ad_id } });
      expect(result.isError).toBe(true);
    }
    expect(requested).toHaveLength(0);
  });

  it("refuses an argument the surface does not have, rather than ignoring it", async () => {
    // Accepted-and-ignored would let a caller believe a listing was fetched
    // some other way than it was (SPEC 2.6).
    const client = await connect(serving(fixture("listing-private-offer")));
    const result = await client.callTool({
      name: "get_listing",
      arguments: { ad_id: AD_ID, include_view_count: true },
    });
    expect(result.isError).toBe(true);
    expect(requested).toHaveLength(0);
  });
});

describe("the operational failures", () => {
  it("surfaces a block as isError, never as a gone listing", async () => {
    // A block is an operational failure; "gone" is an answer. Reading one as
    // the other would tell a caller a live listing had been deleted (SPEC 5.4, 6.3).
    const client = await connect(serving(`<html><body>${BLOCK_MARKER}</body></html>`));
    const result = await client.callTool({ name: "get_listing", arguments: { ad_id: AD_ID } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("block");
  });

  it("surfaces a page it can no longer read as isError, never as a gone listing", async () => {
    const doctored = fixture("listing-private-offer").replace("viewad-title", "viewad-moved-on");
    const client = await connect(serving(doctored));
    const result = await client.callTool({ name: "get_listing", arguments: { ad_id: AD_ID } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("parse_failure");
  });

  it("surfaces a listing served under an ad id nobody asked for as isError", async () => {
    const client = await connect(serving(fixture("listing-wanted")));
    const result = await client.callTool({ name: "get_listing", arguments: { ad_id: AD_ID } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("parse_failure");
  });
});
