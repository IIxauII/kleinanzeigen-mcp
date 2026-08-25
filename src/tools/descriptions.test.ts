import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIND_CATEGORY_DESCRIPTION } from "./find-category.ts";
import { FIND_LOCATION_DESCRIPTION } from "./find-location.ts";
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

/** §4.1 gives `search_listings`' description as a fence of its own, unindented. */
function searchDescriptionInSpec(): string {
  const section = /### 4\.1 `search_listings`\n([\s\S]*?)\n### /u.exec(spec());
  if (section === null) throw new Error("SPEC 4.1 no longer describes search_listings");
  const block = /\*\*Description\*\*\n\n```\n([\s\S]*?)\n```/u.exec(section[1]!);
  if (block === null) throw new Error("SPEC 4.1 no longer gives a description block");
  return block[1]!;
}

describe("the tool descriptions", () => {
  it("are the resolvers' from SPEC 4.4, verbatim", () => {
    expect(FIND_CATEGORY_DESCRIPTION).toBe(resolverDescriptionInSpec("find_category"));
    expect(FIND_LOCATION_DESCRIPTION).toBe(resolverDescriptionInSpec("find_location"));
  });

  it("are search_listings' from SPEC 4.1, verbatim", () => {
    expect(SEARCH_LISTINGS_DESCRIPTION).toBe(searchDescriptionInSpec());
  });
});
