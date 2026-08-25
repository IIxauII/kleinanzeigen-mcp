import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIND_CATEGORY_DESCRIPTION } from "./find-category.ts";
import { FIND_LOCATION_DESCRIPTION } from "./find-location.ts";

const SPEC = new URL("../../SPEC.md", import.meta.url);

/**
 * SPEC 4.4 gives both resolvers' descriptions as literal text, and a tool
 * description is the whole of what an agent reads before choosing a tool. So
 * "verbatim" is checked against the spec file itself rather than trusted to a
 * careful copy-paste: a spec edit that the code does not follow fails here.
 */
function descriptionInSpec(tool: string): string {
  const spec = readFileSync(SPEC, "utf8");
  const block = new RegExp(`^${tool}\\n((?:  .*\\n)+)`, "m").exec(spec);
  if (block === null) throw new Error(`SPEC 4.4 no longer describes ${tool}`);
  return block[1]!
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(2))
    .join("\n");
}

describe("the resolver descriptions", () => {
  it("are SPEC 4.4's, verbatim", () => {
    expect(FIND_CATEGORY_DESCRIPTION).toBe(descriptionInSpec("find_category"));
    expect(FIND_LOCATION_DESCRIPTION).toBe(descriptionInSpec("find_location"));
  });
});
