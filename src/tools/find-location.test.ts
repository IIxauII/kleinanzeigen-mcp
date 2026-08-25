import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isCityDatasetLoaded,
  loadCityDataset,
  resetCityDataset,
  type CityDataset,
} from "../locations/city-dataset.ts";
import { createServer } from "../server.ts";
import { FIND_LOCATION_DESCRIPTION } from "./find-location.ts";

const BUNDLED = new URL("../../data/cities.json", import.meta.url);

async function connect(readCityDataset?: () => CityDataset): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    createServer({ readCityDataset }).connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

const dataset = () => loadCityDataset(BUNDLED);

type FindLocationResult = {
  matches: { location_id: number; name: string; slug: string; level: string; state: string }[];
  count: number;
  fetched_at: string;
  stale: boolean;
  source_url: string | null;
};

async function findLocation(client: Client, query: string): Promise<FindLocationResult> {
  const result = await client.callTool({ name: "find_location", arguments: { query } });
  expect(result.isError).toBeFalsy();
  return result.structuredContent as FindLocationResult;
}

describe("find_location over MCP", () => {
  beforeEach(resetCityDataset);

  it("is listed with the spec's description", async () => {
    const { tools } = await (await connect(dataset)).listTools();
    const tool = tools.find((candidate) => candidate.name === "find_location");
    expect(tool).toBeDefined();
    expect(tool!.description).toBe(FIND_LOCATION_DESCRIPTION);
    expect(tool!.inputSchema.properties).toHaveProperty("query");
  });

  it("does not touch the bundled dataset until the first call", async () => {
    const client = await connect();
    await client.listTools();
    expect(isCityDatasetLoaded()).toBe(false);
  });

  it("returns a list even on a single exact hit, with no best hint", async () => {
    const result = await findLocation(await connect(dataset), "Köln");
    expect(result.count).toBe(1);
    expect(result.matches).toEqual([
      {
        location_id: 945,
        name: "Köln",
        slug: "koeln",
        level: "locality",
        state: "Nordrhein-Westfalen",
      },
    ]);
    expect(result).not.toHaveProperty("best");
  });

  it("hands back every location a colliding name could mean", async () => {
    const result = await findLocation(await connect(dataset), "Neustadt");
    expect(result.count).toBeGreaterThan(1);
    expect(new Set(result.matches.map((match) => match.state)).size).toBeGreaterThan(1);
  });

  it("narrows that collision through the qualified form", async () => {
    const result = await findLocation(await connect(dataset), "Bremen > Neustadt");
    expect(result.matches.map((match) => match.location_id)).toEqual([41]);
  });

  it("resolves the three city-states the sitemap omits", async () => {
    const client = await connect(dataset);
    for (const [query, location_id] of [
      ["Berlin", 3331],
      ["Hamburg", 9409],
      ["Bremen", 1],
    ] as const) {
      const result = await findLocation(client, query);
      expect(result.matches.map((match) => match.location_id)).toContain(location_id);
    }
  });

  it("hands back both spellings the site itself carries, never one of them", async () => {
    // The site lists Füssen l9915 and Fuessen l9747 as two distinct Bayern
    // locations sharing one slug. Expanding ä ö ü brings them together under
    // either spelling, which is the always-a-list contract earning its keep:
    // the caller sees two ids and picks, instead of silently getting one.
    const client = await connect(dataset);
    for (const query of ["Füssen", "Fuessen"]) {
      const result = await findLocation(client, query);
      expect(result.matches.map((match) => match.location_id).sort()).toEqual([9747, 9915]);
    }

    // The expansion runs one way only. `Fussen` strips a mark and so reaches
    // Füssen, but nothing contracts `ue` back to `ü` — that guess is wrong far
    // more often than right (Neuss, Neuenkirchen, Duisburg), and a resolver
    // that guesses is the thing this whole surface is built to avoid.
    const stripped = await findLocation(client, "Fussen");
    expect(stripped.matches.map((match) => match.location_id)).toEqual([9915]);
  });

  it("answers a postcode with an empty list — an answer, not an error", async () => {
    const result = await findLocation(await connect(dataset), "10115");
    expect(result).toMatchObject({ matches: [], count: 0 });
  });

  it("answers a name it does not know with an empty list, not an error", async () => {
    const result = await findLocation(await connect(dataset), "Atlantis");
    expect(result).toMatchObject({ matches: [], count: 0 });
  });

  it("carries the envelope, with no source url because it reads none", async () => {
    const before = Date.now();
    const result = await findLocation(await connect(dataset), "Köln");
    expect(result.stale).toBe(false);
    expect(result.source_url).toBeNull();
    expect(result).not.toHaveProperty("stale_reason");
    expect(Date.parse(result.fetched_at)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("also serialises the result as text content", async () => {
    const client = await connect(dataset);
    const result = await client.callTool({ name: "find_location", arguments: { query: "Köln" } });
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]!.text)).toEqual(result.structuredContent);
  });

  it("refuses a call with no query", async () => {
    const client = await connect(dataset);
    const result = await client.callTool({ name: "find_location", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("refuses an argument it does not have, rather than ignoring it", async () => {
    // The same rule the filter surface follows: a caller that invents `radius`
    // is told, instead of reading the whole dataset's matches as a scoped set
    // (SPEC 2.6).
    const client = await connect(dataset);
    const result = await client.callTool({
      name: "find_location",
      arguments: { query: "Köln", radius: 20 },
    });
    expect(result.isError).toBe(true);
  });
});
