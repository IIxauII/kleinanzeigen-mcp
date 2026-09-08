import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createServer } from "./server.ts";
import { specSection } from "./spec-section.ts";
import { VERSION } from "./version.ts";

const PACKAGE = new URL("../package.json", import.meta.url);

/**
 * §4.6 gives the server's `Implementation` as a literal object. `name` and
 * `version` were always there; `title`, `description` and `websiteUrl` are the
 * fields whose absence left a client listing installed servers showing the
 * bare slug, so they are pinned to the spec rather than to a copy of it.
 */
type SpecIdentity = { name: string; title: string; description: string; websiteUrl: string };

function identityInSpec(): SpecIdentity {
  const block = /```ts\n\{\n([\s\S]*?)\n\}\n```/u.exec(specSection("4.6"));
  if (block === null) throw new Error("SPEC 4.6 no longer gives the server Implementation");
  const fields = Object.fromEntries(
    [...block[1]!.matchAll(/^ {2}(\w+): "([^"]*)",$/gmu)].map(([, key, value]) => [key!, value!]),
  );
  // `version: VERSION` is the one unquoted field, so it is absent by design;
  // every other one is named here, so a spec that drops one fails loudly.
  for (const field of ["name", "title", "description", "websiteUrl"]) {
    if (fields[field] === undefined) throw new Error(`SPEC 4.6 no longer gives the server's ${field}`);
  }
  return fields as SpecIdentity;
}

async function serverIdentity() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client.getServerVersion();
}

describe("the server identity", () => {
  it("declares the name, title, description and site from SPEC 4.6", async () => {
    expect(await serverIdentity()).toEqual({ ...identityInSpec(), version: VERSION });
  });

  /**
   * The description is one string reused in five slots (§4.6). `package.json`
   * is the one this repo already carries, so drift between the two fails here.
   */
  it("shares its description with package.json, verbatim", async () => {
    const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"));
    expect((await serverIdentity())?.description).toBe(pkg.description);
  });

  /** No icon on the server either, for the reasons §4.6 gives on the tools. */
  it("ships no icons", async () => {
    expect(await serverIdentity()).not.toHaveProperty("icons");
  });
});
