import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const spec = readFileSync(new URL("../SPEC.md", import.meta.url), "utf8");

/** The body of one `##` section of SPEC.md, up to the next one. */
function specSection(heading: string): string {
  const start = spec.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`SPEC no longer has a section "${heading}"`);
  const from = start + `\n## ${heading}\n`.length;
  const next = spec.indexOf("\n## ", from);
  return spec.slice(from, next === -1 ? undefined : next);
}

/**
 * One line of a SPEC section, found by its opening. The spec writes each
 * paragraph on a single unwrapped line, so a line is a claim.
 */
function specLine(heading: string, startsWith: string): string {
  const line = specSection(heading)
    .split("\n")
    .find((candidate) => candidate.startsWith(startsWith));
  if (line === undefined) throw new Error(`SPEC "${heading}" no longer says "${startsWith}…"`);
  return line;
}

describe("the README's install instructions", () => {
  it("gives the run-from-clone block exactly as SPEC 8.3 writes it", () => {
    const block = /```bash\n([\s\S]*?)```/u.exec(specSection("8. Stack, packaging, install"));
    expect(block, "SPEC 8.3 no longer shows an install block").not.toBeNull();
    expect(readme).toContain(block![1]!.trim());
  });

  it("gives an MCP client config block pointing at the built bundle by absolute path", () => {
    const config = /```json\n([\s\S]*?)```/u.exec(readme);
    expect(config).not.toBeNull();
    const parsed = JSON.parse(config![1]!);
    expect(parsed.mcpServers.kleinanzeigen.command).toBe("node");
    expect(parsed.mcpServers.kleinanzeigen.args[0]).toMatch(/^\/.*\/dist\/index\.js$/);
  });

  it("names Node 22 as the floor", () => {
    expect(readme).toMatch(/Node \*\*22 or newer\*\*/);
  });
});

describe("the README's configuration section", () => {
  it("documents the single knob, and that unset means 1500 ms", () => {
    expect(readme).toContain("KLEINANZEIGEN_MCP_RATE_LIMIT_MS");
    expect(readme).toContain("**Unset means 1500 ms.**");
  });

  it("says there is no floor, and why the operator owns that", () => {
    expect(readme).toContain("**There is no floor.**");
    expect(readme).toContain("your machine, your IP and your risk");
  });

  it("says an invalid value refuses to start rather than falling back", () => {
    expect(readme).toContain("**An invalid value refuses to start.**");
    expect(readme).toContain("no silent fallback to 1500 ms");
  });

  it("names all four things that are not configurable and cannot be disabled", () => {
    const section = /### What is not configurable, and cannot be disabled\n([\s\S]*?)\n---/u.exec(readme);
    expect(section, "the README no longer has that section").not.toBeNull();
    const body = section![1]!;
    for (const fixed of ["`Retry-After`", "circuit breaker", "User-Agent", "deleted-ad guard"]) {
      expect(body, fixed).toContain(fixed);
    }
    // The claim only means something if the README says it cannot be turned off.
    expect(body).toContain("There is no flag that turns them off");
  });
});

describe("the README's drift check documentation", () => {
  it("shows how it is invoked, and that it is not on the request path", () => {
    expect(readme).toContain("npm run check:drift");
    expect(readme).toContain("node dist/index.js --check-drift");
    expect(readme).toContain("it never runs on a tool call");
  });

  it("says it writes nothing, and points at the rebuild instead", () => {
    expect(readme).toContain("**It writes nothing.**");
    expect(readme).toContain("npm run generate:category-tree");
  });

  it("says it is not conditioned on the sitemap index's timestamp", () => {
    expect(readme).toContain("not conditioned on the sitemap index's `lastmod`");
  });
});

describe("the README's known limits", () => {
  const limits = /## Known limits\n([\s\S]*?)\n---/u.exec(readme)?.[1] ?? "";

  it("carries as many as SPEC 9 states", () => {
    const numbered = (text: string): number => (text.match(/^\d+\. /gmu) ?? []).length;
    expect(numbered(limits)).toBe(numbered(specSection("9. Known limits, stated plainly")));
    expect(numbered(limits)).toBe(16);
  });

  it("carries each limit the ticket names, as a thing a user will hit", () => {
    expect(limits).toContain("1 250 organic listings per query");
    expect(limits).toContain("silently re-serve page 50");
    expect(limits).toContain("drift between pages");
    expect(limits).toContain("No sort by distance");
    expect(limits).toContain("No category attribute filters");
    expect(limits).toContain("The applied sort cannot be read back");
    expect(limits).toContain("No private seller inventory");
    expect(limits).toContain("wrong shop on an exact single hit");
    expect(limits).toContain("A postcode is not an identifier");
    expect(readme).toContain("These are things you will hit. None of them is a bug.");
  });
});

describe("the README's terms-of-service position", () => {
  const TOS = "12. The ToS position";

  it("carries SPEC 12's claims verbatim, including the contradiction it does not resolve", () => {
    for (const opening of [
      "**There is a genuine contradiction",
      "**§ 5 Nr. 1 der Nutzungsbedingungen",
      "**§ 5 Nr. 1 of the Nutzungsbedingungen**",
      "**`robots.txt` says something different.**",
      "**Choosing robots-clean does not resolve",
      "- **It reads the machine-readable channel literally",
      "- **It never circumvents.**",
      "- **It keeps volume at personal scale**",
      "- **It persists nothing.**",
      "- **It is single-user and local.**",
      "**What this is not.**",
    ]) {
      let line: string;
      try {
        line = specLine(TOS, opening);
      } catch {
        continue; // an opening the spec does not use; another spelling above covers it
      }
      expect(readme, opening).toContain(line);
    }
  });

  it("closes on SPEC 12's risk statement, verbatim", () => {
    expect(readme).toContain(specLine(TOS, "**Use it on your own account"));
  });
});

describe("the README on what is left open", () => {
  it("says the licence and publishing are open on purpose, and decides neither", () => {
    expect(readme).toContain("**Both are deliberately left open.**");
    expect(readme).toContain("all-rights-reserved");
    expect(readme).toContain("one line of this README and nothing in the code");
  });
});
