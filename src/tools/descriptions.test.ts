import { Client, InMemoryTransport, type Tool } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createServer } from "../server.ts";
import { FIND_CATEGORY_DESCRIPTION } from "./find-category.ts";
import { FIND_LOCATION_DESCRIPTION } from "./find-location.ts";
import { FIND_SHOP_DESCRIPTION } from "./find-shop.ts";
import { GET_LISTING_DESCRIPTION } from "./get-listing.ts";
import { GET_SHOP_DESCRIPTION } from "./get-shop.ts";
import { SEARCH_LISTINGS_DESCRIPTION } from "./search-listings.ts";

const SPEC = new URL("../../SPEC.md", import.meta.url);

const spec = (): string => readFileSync(SPEC, "utf8");

/**
 * A tool description is the whole of what an agent reads before choosing a
 * tool, and the spec gives each one as literal text. So "verbatim" is checked
 * against the spec file itself rather than trusted to a careful copy-paste: a
 * spec edit the code does not follow fails here.
 */

/** §4.4 lists both resolvers under one fence, each indented beneath its name. */
function resolverDescriptionInSpec(tool: string): string {
  const block = new RegExp(`^${tool}\\n((?:  .*\\n)+)`, "m").exec(spec());
  if (block === null) throw new Error(`SPEC 4.4 no longer describes ${tool}`);
  return block[1]!
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(2))
    .join("\n");
}

/** §4.1, §4.2, §4.3 and §4.5 each give their tool's description as a fence of its own, unindented. */
function descriptionInSpec(section: string, tool: string): string {
  // The section ends at the next `##` or `###` heading, or at the rule that
  // closes §4 — §4.5 is the last one and has no `###` after it.
  const body = new RegExp(`### ${section.replace(".", "\\.")} \`${tool}\`\\n([\\s\\S]*?)\\n(?:#{2,3} |---\\n)`, "u").exec(spec());
  if (body === null) throw new Error(`SPEC ${section} no longer describes ${tool}`);
  const block = /\*\*Description\*\*\n\n```\n([\s\S]*?)\n```/u.exec(body[1]!);
  if (block === null) throw new Error(`SPEC ${section} no longer gives a description block`);
  return block[1]!;
}

describe("the tool descriptions", () => {
  it("are the resolvers' from SPEC 4.4, verbatim", () => {
    expect(FIND_CATEGORY_DESCRIPTION).toBe(resolverDescriptionInSpec("find_category"));
    expect(FIND_LOCATION_DESCRIPTION).toBe(resolverDescriptionInSpec("find_location"));
  });

  it("are search_listings' from SPEC 4.1, verbatim", () => {
    expect(SEARCH_LISTINGS_DESCRIPTION).toBe(descriptionInSpec("4.1", "search_listings"));
  });

  it("are get_listing's from SPEC 4.2, verbatim", () => {
    expect(GET_LISTING_DESCRIPTION).toBe(descriptionInSpec("4.2", "get_listing"));
  });

  it("are get_shop's from SPEC 4.3, verbatim", () => {
    expect(GET_SHOP_DESCRIPTION).toBe(descriptionInSpec("4.3", "get_shop"));
  });

  it("are find_shop's from SPEC 4.5, verbatim", () => {
    expect(FIND_SHOP_DESCRIPTION).toBe(descriptionInSpec("4.5", "find_shop"));
  });
});

/**
 * §4.6 gives the annotations as a table, one row per tool, cell values in
 * backticks and the two `false`s bolded. It is read from the spec for the same
 * reason the descriptions are: annotations are wire-visible and agent-facing,
 * so a spec edit the code does not follow fails here rather than passing.
 */
type SpecAnnotations = { title: string; readOnlyHint: boolean; openWorldHint: boolean };

function annotationsInSpec(): Map<string, SpecAnnotations> {
  const section = /### 4\.6 [^\n]*\n([\s\S]*?)\n---\n/u.exec(spec());
  if (section === null) throw new Error("SPEC 4.6 no longer states what each tool declares");
  const cell = (text: string): string => text.replaceAll("*", "").replaceAll("`", "").trim();
  const rows = section[1]!.matchAll(/^\| `(\w+)` \|([^|]+)\|([^|]+)\|([^|]+)\|$/gmu);
  const table = new Map<string, SpecAnnotations>();
  for (const [, tool, title, readOnly, openWorld] of rows) {
    table.set(tool!, {
      title: cell(title!),
      readOnlyHint: cell(readOnly!) === "true",
      openWorldHint: cell(openWorld!) === "true",
    });
  }
  if (table.size !== 6) throw new Error(`SPEC 4.6 no longer tables six tools, got ${table.size}`);
  return table;
}

/** Over MCP, not off the registration call: what a client sees is the claim. */
async function listedTools(): Promise<Tool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return (await client.listTools()).tools;
}

describe("the tool annotations", () => {
  it("state a title and both hints from SPEC 4.6, on every tool", async () => {
    const tools = await listedTools();
    const table = annotationsInSpec();
    expect(tools.map((tool) => tool.name)).toEqual([...table.keys()]);
    for (const [name, expected] of table) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      expect({
        title: tool.title,
        readOnlyHint: tool.annotations?.readOnlyHint,
        openWorldHint: tool.annotations?.openWorldHint,
      }).toEqual(expected);
    }
  });

  /**
   * The protocol makes both meaningful only when `readOnlyHint` is false, so
   * §4.6 omits them rather than defaulting them. Asserted positively, so
   * re-adding either fails instead of passing quietly.
   */
  it("omit destructiveHint and idempotentHint entirely", async () => {
    for (const tool of await listedTools()) {
      expect(tool.annotations).not.toHaveProperty("destructiveHint");
      expect(tool.annotations).not.toHaveProperty("idempotentHint");
    }
  });

  /** One slot, one string: clients prefer `annotations.title`, so it stays empty (§4.6). */
  it("carry the title in the top-level slot only, never annotations.title", async () => {
    for (const tool of await listedTools()) {
      expect(tool.annotations).not.toHaveProperty("title");
    }
  });

  /** A data URI inflates every `tools/list` six times over, a remote one is a fetch (§4.6). */
  it("ship no icons", async () => {
    for (const tool of await listedTools()) {
      expect(tool.icons).toBeUndefined();
    }
  });
});
