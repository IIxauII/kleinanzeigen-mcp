import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mcpbAssetName } from "../scripts/pack-mcpb.ts";
import {
  PLACEHOLDER_SHA256,
  SERVER_JSON_PATH,
  type ServerPackage,
  stampServerJson,
  stamped,
} from "../scripts/stamp-server-json.ts";

const server = JSON.parse(readFileSync(SERVER_JSON_PATH, "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

const npmEntry = server.packages.find((entry: { registryType: string }) => entry.registryType === "npm");
const mcpbEntry = server.packages.find((entry: { registryType: string }) => entry.registryType === "mcpb");

/**
 * The MCP Registry channel (SPEC 8.7). The registry's own `mcp-publisher
 * validate` is a Go binary installed with brew, so it is the maintainer's and
 * the release workflow's gate and not something `npm test` can run. What this
 * file covers is everything that survives a passing validation and breaks
 * afterwards: a value stated twice and drifted, and — the one that cannot be
 * caught downstream — a `fileSha256` the registry accepts without checking and
 * every client then rejects.
 */
describe("server.json", () => {
  it("pins the dated schema rather than anything called latest", () => {
    // The registry is in preview and its schema is versioned by date. A
    // floating URL would change the rules under a file nothing re-validates
    // between releases; this one changes when someone changes it.
    expect(server.$schema).toBe("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  });

  it("carries the namespace the published npm package proves, byte for byte", () => {
    // The registry reads `mcpName` out of the npm version's metadata and
    // compares it to this name to prove the package belongs to the
    // authenticated namespace. npm metadata is immutable, so a mismatch costs a
    // version bump rather than a commit — and the casing is inferred from the
    // registry's source, not documented (SPEC 8.7).
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(server.name.split("/")).toHaveLength(2);
  });

  it("repeats the one shared description, inside the cap the schema enforces", () => {
    // SPEC 4.6's single string, stated here for the fifth time and never
    // paraphrased. `maxLength: 100` is schema-enforced: a future rewrite that
    // grows it fails `mcp-publisher validate` at release time, which is late.
    expect(server.description).toBe(pkg.description);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it("repeats the display name and the links it duplicates from elsewhere", () => {
    expect(server.title).toBe(manifest.display_name);
    expect(server.repository).toEqual({ url: pkg.repository, source: "github" });
    // `websiteUrl` is where the ToS position is disclosed: it resolves to the
    // README whose install section leads with it (SPEC 8.7).
    expect(server.websiteUrl).toBe(pkg.homepage);
  });

  it("declares none of the fields the registry does not model", () => {
    // There is no licence field, no category and no keywords — listing is free,
    // automated and unreviewed. Inventing them would validate and then be
    // dropped silently, which reads as a listing that says something it does
    // not (SPEC 8.7). `remotes` is the schema's own field and is absent for a
    // different reason: this server is stdio-only (SPEC 8.2), so there is no
    // hosted endpoint to advertise and a client must never be pointed at one.
    for (const absent of ["license", "categories", "keywords", "remotes"]) {
      expect(server, absent).not.toHaveProperty(absent);
    }
  });

  it("offers exactly the two package channels, both over stdio", () => {
    expect(server.packages).toHaveLength(2);
    expect(npmEntry).toBeDefined();
    expect(mcpbEntry).toBeDefined();
    for (const entry of server.packages) {
      // `transport` is required on every entry, and this server is stdio-only
      // (SPEC 8.2) — there is no remote to advertise.
      expect(entry.transport).toEqual({ type: "stdio" });
      // The MCPB entry forbids it outright, and the npm entry does not need it:
      // the registry fetches registry.npmjs.org by default, and naming it would
      // be a second place for the default to drift.
      expect(entry, "registryBaseUrl").not.toHaveProperty("registryBaseUrl");
      expect(entry.version).not.toBe("latest");
      expect(entry.version).not.toMatch(/[\^~*x><]|\s/);
    }
  });

  it("points npm at the package by name, with no hash the registry would not use", () => {
    expect(npmEntry.identifier).toBe(pkg.name);
    // Required on MCPB, forbidden here — validation rejects it on an npm entry.
    expect(npmEntry, "fileSha256").not.toHaveProperty("fileSha256");
  });

  it("points MCPB at a release asset of this repository, by hash", () => {
    // Release assets only, https only, and the URL must contain `mcp` — three
    // rules the registry enforces, all satisfied by the name `pack:mcpb` packs.
    // It also does a **redirect-refusing `HEAD`** on this URL, so the asset has
    // to be uploaded before the registry step runs (SPEC 8.7).
    //
    // The URL is spelled out here from the package's own `repository` and the
    // packed file's name rather than asked of the stamp: the stamp is the thing
    // under test, and a restatement is the only version of this check that
    // fails when the stamp builds a plausible wrong URL.
    expect(mcpbEntry.identifier).toBe(
      `${pkg.repository}/releases/download/v${mcpbEntry.version}/${mcpbAssetName(mcpbEntry.version)}`,
    );
    expect(mcpbEntry.identifier).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//);
    expect(mcpbEntry.identifier).toContain("mcp");
    expect(mcpbEntry.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is committed unstamped, so a hash nobody computed can never be published", () => {
    // The registry does not verify `fileSha256`; clients do. A wrong hash
    // publishes cleanly and then fails every install, which makes a plausible
    // committed hash the worst thing this file could carry. The placeholder is
    // schema-valid and unmistakable, and the release replaces it with the hash
    // of the asset it actually uploaded (SPEC 8.7).
    expect(mcpbEntry.fileSha256).toBe(PLACEHOLDER_SHA256);
    // The three versions agree with each other and with the tag in the asset
    // URL, and deliberately **not** with `package.json`. `server.json` is not in
    // SPEC 8.7's commit-back list — the release stamps it, submits it and never
    // commits the result — so after the first release the committed version
    // trails the package's by design. `manifest.json` is the opposite case and
    // is pinned to the package in `tests/mcpb.test.ts`, because it is in that
    // list and ships inside the bundle.
    expect(new Set([server.version, npmEntry.version, mcpbEntry.version]).size).toBe(1);
    expect(mcpbEntry.identifier).toContain(`/download/v${server.version}/`);
  });
});

/**
 * The version stamp. Nothing propagates: the registry never polls npm, so every
 * release is a fresh submission of this file, and three of its values move with
 * the release — the version, the asset URL that carries the tag and the hash of
 * the asset itself. The reference workflow's one-line `jq` version bump covers
 * one of the three (SPEC 8.7).
 */
describe("the release stamp", () => {
  const temporary: string[] = [];
  afterAll(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** A stand-in for the packed bundle, under the name the release uploads. */
  function asset(version: string, contents: string): string {
    const workspace = mkdtempSync(join(tmpdir(), "kleinanzeigen-registry-"));
    temporary.push(workspace);
    const path = join(workspace, mcpbAssetName(version));
    writeFileSync(path, contents);
    return path;
  }

  it("moves the version, the asset URL and the hash together", () => {
    const path = asset("9.9.9", "not really a bundle");
    const result = stamped(server, "9.9.9", createHash("sha256").update("not really a bundle").digest("hex"));

    expect(result.version).toBe("9.9.9");
    expect(result.packages.map((entry) => entry.version)).toEqual(["9.9.9", "9.9.9"]);
    const mcpb = result.packages.find((entry) => entry.registryType === "mcpb")!;
    expect(mcpb.identifier).toBe(`${pkg.repository}/releases/download/v9.9.9/kleinanzeigen-mcp-9.9.9.mcpb`);
    expect(mcpb.fileSha256).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
    expect(result.packages.find((entry) => entry.registryType === "npm")).not.toHaveProperty("fileSha256");
  });

  it("changes nothing else about the file", () => {
    const stampedServer = stamped(server, "9.9.9", PLACEHOLDER_SHA256);
    const moving = (value: ServerPackage) => ({ ...value, version: null, identifier: null });
    expect({ ...stampedServer, version: null, packages: stampedServer.packages.map(moving) }) //
      .toEqual({ ...server, version: null, packages: server.packages.map(moving) });
  });

  it("hashes the packed bundle on disk and writes the file the publisher reads", () => {
    const path = asset("1.2.3", "bundle bytes");
    const target = join(join(path, ".."), "server.json");
    writeFileSync(target, readFileSync(SERVER_JSON_PATH));

    const result = stampServerJson({ version: "1.2.3", asset: path, serverJson: target });

    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(result);
    expect(result.packages.find((entry) => entry.registryType === "mcpb")!.fileSha256) //
      .toBe(createHash("sha256").update("bundle bytes").digest("hex"));
    // Written back as a file a human can read in a diff, newline included.
    expect(readFileSync(target, "utf8").endsWith("\n")).toBe(true);
  });

  it("refuses to stamp a hash of an asset that is not there", () => {
    // The failure this guards is silent otherwise: the registry accepts any
    // hash, so a stamp over a missing or unbuilt bundle would publish a listing
    // that fails every client's integrity check. Loud at release time instead.
    const path = asset("1.2.3", "bundle bytes");
    expect(() => stampServerJson({ version: "4.5.6", asset: join(path, "..", "absent.mcpb") })) //
      .toThrow(/absent\.mcpb/);
  });

  it("refuses a version the registry would reject", () => {
    // Ranges are rejected by the schema, and a version that fails to parse as
    // semver is marked latest by the registry *even when it sorts earlier* — so
    // a stamp from a malformed release input would quietly repoint `latest`.
    const path = asset("1.2.3", "bundle bytes");
    for (const version of ["latest", "^1.2.3", "1.x", ""]) {
      expect(() => stampServerJson({ version, asset: path }), version).toThrow(/version/);
    }
  });
});
