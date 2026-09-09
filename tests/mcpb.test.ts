import { getMcpConfigForManifest } from "@anthropic-ai/mcpb";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mcpb, packMcpb } from "../scripts/pack-mcpb.ts";
import { MCPB_STAGING_DIR, MCPB_STAGING_FILES } from "../scripts/stage-mcpb.ts";

const MANIFEST_PATH = fileURLToPath(new URL("../manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/**
 * What Claude Desktop would spawn for this manifest, produced by
 * `getMcpConfigForManifest` — the function it actually runs — rather than by
 * this test's idea of what it does. `entry_point` is informational; this is the
 * launch (SPEC 8.7).
 */
async function hostConfig(extensionPath: string, userConfig: Record<string, string | number> = {}) {
  const config = await getMcpConfigForManifest({
    manifest,
    extensionPath,
    systemDirs: { HOME: "/home/nobody", DESKTOP: "/home/nobody/Desktop", DOCUMENTS: "/home/nobody/Documents" },
    userConfig,
    pathSeparator: sep,
  });
  // `hasRequiredConfigMissing` makes the host skip generating a config
  // entirely, which is the failure `required: true` would have bought us.
  if (!config) throw new Error("the host generated no MCP config for this manifest");
  return config;
}

/** Every file under a directory, as bundle-relative POSIX paths. */
function tree(root: string, from: string = root): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name);
    return entry.isDirectory() ? tree(child, from) : [relative(from, child).split(sep).join("/")];
  });
}

/**
 * The Claude Desktop channel (SPEC 8.7). Everything here is about one failure:
 * a file that was supposed to be beside the bundle wasn't. The manifest is
 * hand-written, so its claims are checked against the package they duplicate;
 * the bundle is packed from an allowlist, so what the allowlist produced is
 * checked against what was asked for.
 */
describe("the MCPB manifest", () => {
  it("validates against the format's own schema", () => {
    expect(mcpb("validate", MANIFEST_PATH)).toContain("Manifest schema validation passes!");
  });

  it("pins manifest_version 0.4 as a literal", () => {
    // The package's own bundled `mcpb-manifest-latest.schema.json` still says
    // `"const": "0.3"` while `LATEST_MANIFEST_VERSION` is `0.4` — nothing
    // called "latest" is trustworthy here, so the version is written out.
    expect(manifest.manifest_version).toBe("0.4");
  });

  it("carries the version, which therefore lives in two files", () => {
    // `package.json` and `manifest.json` both state it and nothing derives one
    // from the other: `mcpb init` never reads `package.json`. The release
    // stamps both, and a stale manifest would otherwise ship silently — so the
    // stale manifest fails the suite instead (SPEC 8.7). `src/version.ts` is
    // pinned to `package.json` in turn by `src/version.test.ts`.
    expect(manifest.version).toBe(pkg.version);
  });

  it("repeats every field it duplicates from the package, byte for byte", () => {
    // The manifest is hand-written and shares no code with `package.json` —
    // `mcpb init` never reads one — so every value stated twice is a value that
    // can drift silently. `description` is the one shared string of SPEC 4.6,
    // never paraphrased; the rest is the same metadata `packaging.test.ts` pins
    // on the package side, pinned again here rather than trusted (SPEC 8.7).
    expect(manifest.description).toBe(pkg.description);
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.author.name).toBe(pkg.author);
    expect(manifest.license).toBe(pkg.license);
    expect(manifest.homepage).toBe(pkg.homepage);
    expect(manifest.repository.url).toBe(pkg.repository);
    expect(manifest.support).toBe(pkg.bugs);
    expect(manifest.keywords).toEqual(pkg.keywords);
  });

  it("declares no privacy policy, which is a decision", () => {
    // The field is required "when the extension connects to external services
    // … that process user data", and the trigger does not fire: no account, no
    // identity, no telemetry, nothing retained past the process (ADR-0002).
    // The only thing leaving the machine is the caller's search string, going
    // to the site the tool exists to read. Declaring a policy would assert a
    // data relationship that does not exist (ADR-0005, SPEC 8.7).
    expect(manifest).not.toHaveProperty("privacy_policies");
  });

  it("launches the bundled entry with the host's own Node", () => {
    // `entry_point` is informational; `mcp_config` is what the host executes,
    // with `${__dirname}` substituted to the extension's directory. Nothing
    // node-shaped is in the zip — Claude Desktop supplies the runtime, and
    // `compatibility.runtimes.node` is a requirement declaration, not a
    // bundling instruction.
    expect(manifest.server.entry_point).toBe("dist/index.js");
    expect(manifest.server.mcp_config.command).toBe("node");
    expect(manifest.server.mcp_config.args).toEqual(["${__dirname}/dist/index.js"]);
    expect(manifest.compatibility.runtimes.node).toBe(pkg.engines.node);
  });

  /**
   * Substitution is unprefixed, so the value lands in `process.env` under
   * exactly this name and `src/config.ts` needs no change (SPEC 8.4).
   */
  describe("hands the rate-limit knob to the server as an environment value", () => {
    async function env(userConfig: Record<string, string | number>): Promise<Record<string, string>> {
      const config = await hostConfig("/extensions/kanzeigen-mcp", userConfig);
      return (config.env ?? {}) as Record<string, string>;
    }

    it("substitutes the declared default when the user leaves the field alone", async () => {
      // `default: 1500` is not decoration. Without it the host has no entry in
      // its substitution table, leaves the `${user_config.rate_limit_ms}` token
      // in the string verbatim, and the server refuses to start before the
      // transport opens — a clean install that fails with only stderr to say
      // why. `required: true` is not the fix: the host then skips generating
      // the MCP config entirely (SPEC 8.7).
      expect(manifest.user_config.rate_limit_ms).toMatchObject({
        type: "number",
        default: 1500,
        min: 0,
        required: false,
      });
      expect(await env({})).toEqual({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "1500" });
    });

    it("substitutes what the user typed", async () => {
      expect(await env({ rate_limit_ms: 5000 })).toEqual({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "5000" });
    });

    it("hands over an empty string when the user clears the field, which reads as unset", async () => {
      // The one invalid value a host can produce without the operator typing
      // anything, and the reason SPEC 8.4 makes `""` mean unset rather than
      // fatal. Every other non-integer still kills the process.
      expect(await env({ rate_limit_ms: "" })).toEqual({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "" });
    });
  });
});

describe("the packed MCPB bundle", () => {
  const temporary: string[] = [];
  let unpacked: string;

  afterAll(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  beforeAll(() => {
    // No skip: a missing staging directory is a failure, not a silent pass. A
    // guard that turns the only test of a thing into a no-op under the exact
    // conditions the thing is untested is worse than no guard (SPEC 8.6).
    expect(existsSync(MCPB_STAGING_DIR), "no staged bundle — run `npm run build` first").toBe(true);

    const workspace = mkdtempSync(join(tmpdir(), "kleinanzeigen-mcpb-"));
    temporary.push(workspace);
    unpacked = join(workspace, "unpacked");
    mcpb("unpack", packMcpb(join(workspace, "bundle.mcpb")), unpacked);
  }, 120_000);

  it("stages exactly the allowlist, and `mcpb pack` ships exactly what was staged", () => {
    // `mcpb pack` honours neither `.gitignore` nor `package.json:files`, so the
    // staging directory is the whole of the packaging rule. Asserted on both
    // sides of the pack: the allowlist is what was assembled, and the archive
    // is what the allowlist held — no `src/`, no `data/`, no `scripts/`, no
    // fixtures, no `node_modules` (SPEC 8.7).
    const expected = [...MCPB_STAGING_FILES].sort();
    expect(tree(MCPB_STAGING_DIR).sort()).toEqual(expected);
    expect(tree(unpacked).sort()).toEqual(expected);
  });

  it("keeps `\"type\": \"module\"` beside the entry, so no cold start warns", () => {
    // The whole reason `package.json` is in the bundle: without it Node
    // reparses the ESM entry by syntax detection and emits
    // MODULE_TYPELESS_PACKAGE_JSON on stderr every time.
    expect(JSON.parse(readFileSync(join(unpacked, "package.json"), "utf8")).type).toBe("module");
  });

  it("starts from the extracted directory with both datasets beside it", async () => {
    // The acceptance shape of this channel, and the two halves of it meet here:
    // the command, arguments and environment are the ones the host's own
    // resolver produced for this manifest against this extracted directory —
    // `${__dirname}` substituted for real — rather than a path this test built
    // itself. Install is a plain extraction to a real directory, so
    // `import.meta.url` resolves beside the sidecars and the lazy first-use
    // reads work unchanged, but only if both files are in the zip. That is the
    // one thing that would break silently (SPEC 8.2, 8.7).
    const launch = await hostConfig(unpacked);
    expect(launch.args).toEqual([`${unpacked}/dist/index.js`]);

    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        // `command` is the bare `node` the manifest asks for: the host supplies
        // the runtime and nothing node-shaped is in the zip, so this resolves
        // against PATH exactly as it would on a user's machine.
        command: launch.command,
        args: launch.args,
        env: { ...(process.env as Record<string, string>), ...launch.env },
      }),
    );
    try {
      const category = await client.callTool({ name: "find_category", arguments: { query: "Bahn & ÖPNV" } });
      expect(category.structuredContent).toMatchObject({ count: 1, matches: [{ category_id: 286 }] });

      const location = await client.callTool({ name: "find_location", arguments: { query: "koeln" } });
      expect(location.structuredContent).toMatchObject({ count: 1, matches: [{ location_id: 945 }] });
    } finally {
      await client.close();
    }
  }, 60_000);
});
