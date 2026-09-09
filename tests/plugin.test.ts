import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { specSection } from "../src/spec-section.ts";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path));

const pkg = json("package.json");
const marketplace = json(".claude-plugin/marketplace.json");
const manifest = json("plugin/.claude-plugin/plugin.json");
const mcp = json("plugin/.mcp.json");
const skill = read("plugin/skills/searching-kanzeigen/SKILL.md");

/**
 * §8.8 gives the skill's normative content as a fence of its own, introduced
 * by the sentence that names the test doing the pinning. "Verbatim" is checked
 * against the spec file rather than trusted to a careful copy-paste, the same
 * mechanism `src/tools/descriptions.test.ts` uses for the tool descriptions.
 */
function skillRulesInSpec(): string {
  const block = /the same mechanism that pins the tool descriptions:\n\n```\n([\s\S]*?)\n```/u.exec(specSection("8.8"));
  if (block === null) throw new Error("SPEC 8.8 no longer gives the skill's normative content as a fence");
  return block[1]!;
}

describe("the marketplace", () => {
  it("resolves the plugin from the subdirectory, never from the repository root", () => {
    // `source: "./"` would make the whole repository the plugin and drag
    // `src/`, `tests/`, `data/` and all of `dist/` onto every user's disk
    // (SPEC 8.8). The payload is the three files under `plugin/`.
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].source).toBe("./plugin");
  });

  it("takes the trademark clip in its own slug and in the plugin's", () => {
    // §4.6's clip governs every slug the project owns downstream, and the cost
    // the npm name `kanzeigen-mcp` now carries the same clip (SPEC 8.8).
    expect(marketplace.name).toBe("kanzeigen");
    expect(marketplace.plugins[0].name).toBe("kanzeigen");
  });
});

describe("the plugin manifest", () => {
  it("carries §4.6's one description string, byte-identical to package.json's", () => {
    // Five slots, one string to keep true rather than five to keep in step.
    expect(manifest.description).toBe(pkg.description);
  });

  it("is named for the clip and versioned in lockstep with npm", () => {
    expect(manifest.name).toBe("kanzeigen");
    expect(manifest.version).toBe(pkg.version);
  });
});

describe("the plugin's .mcp.json", () => {
  it("pins the server version exactly, never floating", () => {
    // The skill describes a result *shape*; a floating server under a fixed
    // skill means the first output-shape change silently invalidates the
    // skill's text (SPEC 8.8). The pin moves with the release (SPEC 8.7).
    expect(Object.keys(mcp.mcpServers)).toEqual(["kleinanzeigen"]);
    expect(mcp.mcpServers.kleinanzeigen.command).toBe("npx");
    expect(mcp.mcpServers.kleinanzeigen.args).toEqual(["-y", `kanzeigen-mcp@${pkg.version}`]);
  });

  it("carries no env block at all, so the one knob a plugin user has still works", () => {
    // A plugin manifest has no MCPB-style `user_config`, so anything written
    // here is static for every user — and the block *overrides* the
    // environment. Writing the rate limit for visibility would break it;
    // omitting it is the only way an exported value reaches the server, which
    // then falls back to its own default (SPEC 8.8, 8.4).
    expect(mcp.mcpServers.kleinanzeigen).not.toHaveProperty("env");
  });
});

describe("the skill", () => {
  it("names the site in its description, because that string is what makes it trigger", () => {
    // The clip stops at prose: naming the site you read is descriptive use,
    // and an intent-triggered skill has to load before the first bad
    // `search_listings` call (SPEC 8.8).
    const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(skill);
    expect(frontmatter).not.toBeNull();
    const description = /^description: (.+)$/mu.exec(frontmatter![1]!)?.[1] ?? "";
    expect(description).toContain("kleinanzeigen.de");
    expect(/^name: searching-kanzeigen$/mu.test(frontmatter![1]!)).toBe(true);
  });

  it("contains SPEC 8.8's normative lines verbatim", () => {
    // Hand review was rejected: the skill and the spec drift silently the
    // first time one moves without the other.
    expect(skill).toContain(skillRulesInSpec());
  });

  it("shows the worked sequence, because 'resolve first' as a bare rule is what agents skip", () => {
    expect(skill).toContain("find_location");
    expect(skill).toContain("location_id");
  });

  it("is self-contained, with no links out", () => {
    // A link to the spec resolves for nobody without the repository, and the
    // on-disk path under a plugin install is not stable (SPEC 8.8).
    expect(skill).not.toMatch(/\]\(|https?:\/\//u);
  });

  it("leaves §2.6's strict-argument rule out", () => {
    // An unrecognised key is refused, loudly. The skill's budget goes to quiet
    // failures, so saving that round trip is not worth a line (SPEC 8.8).
    expect(skill).not.toContain("unrecognised");
    expect(skill).not.toContain("unrecognized");
  });
});
