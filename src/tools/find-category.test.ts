import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isCategoryTreeLoaded,
  loadCategoryTree,
  resetCategoryTree,
  type CategoryTree,
} from "../categories/category-tree.ts";
import { createServer } from "../server.ts";
import { FIND_CATEGORY_DESCRIPTION } from "./find-category.ts";

const BUNDLED = new URL("../../data/category-tree.json", import.meta.url);

async function connect(readCategoryTree?: () => CategoryTree): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    createServer(readCategoryTree).connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

const tree = () => loadCategoryTree(BUNDLED);

type FindCategoryResult = {
  matches: { category_id: number; name: string; parent_name: string | null }[];
  count: number;
};

async function findCategory(client: Client, query: string): Promise<FindCategoryResult> {
  const result = await client.callTool({ name: "find_category", arguments: { query } });
  expect(result.isError).toBeFalsy();
  return result.structuredContent as FindCategoryResult;
}

describe("find_category over MCP", () => {
  beforeEach(resetCategoryTree);

  it("is listed with the spec's description", async () => {
    const { tools } = await (await connect(tree)).listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["find_category"]);
    expect(tools[0]!.description).toBe(FIND_CATEGORY_DESCRIPTION);
    expect(tools[0]!.inputSchema.properties).toHaveProperty("query");
  });

  it("does not touch the bundled tree until the first call", async () => {
    const client = await connect();
    await client.listTools();
    expect(isCategoryTreeLoaded()).toBe(false);
  });

  it("returns a list even on a single exact hit, with no best hint", async () => {
    const result = await findCategory(await connect(tree), "Autos");
    expect(result.count).toBe(1);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.category_id).toBe(216);
    expect(result).not.toHaveProperty("best");
  });

  it("hands back every category a colliding name could mean", async () => {
    const result = await findCategory(await connect(tree), "auto, rad & boot");
    expect(result.count).toBe(2);
    expect(result.matches.map((match) => match.category_id)).toEqual([210, 289]);
    expect(result.matches.map((match) => match.parent_name)).toEqual([null, "Dienstleistungen"]);
  });

  it("narrows that collision through the qualified form", async () => {
    const result = await findCategory(await connect(tree), "Dienstleistungen > Auto, Rad & Boot");
    expect(result.matches.map((match) => match.category_id)).toEqual([289]);
  });

  it("answers a name it does not know with an empty list, not an error", async () => {
    const result = await findCategory(await connect(tree), "Raumfahrt");
    expect(result).toEqual({ matches: [], count: 0 });
  });

  it("also serialises the result as text content", async () => {
    const client = await connect(tree);
    const result = await client.callTool({ name: "find_category", arguments: { query: "Autos" } });
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]!.text)).toEqual(result.structuredContent);
  });

  it("refuses a call with no query", async () => {
    const client = await connect(tree);
    const result = await client.callTool({ name: "find_category", arguments: {} });
    expect(result.isError).toBe(true);
  });
});
