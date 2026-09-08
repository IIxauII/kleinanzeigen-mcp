import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createServer } from "./server.ts";
import { VERSION } from "./version.ts";

const SPEC = new URL("../SPEC.md", import.meta.url);
const PACKAGE = new URL("../package.json", import.meta.url);

/**
 * §4.6 gives the server's `Implementation` as a literal object. `name` and
 * `version` were always there; `title`, `description` and `websiteUrl` are the
 * fields whose absence left a client listing installed servers showing the
 * bare slug, so they are pinned to the spec rather than to a copy of it.
 */
function identityInSpec(): Record<string, string> {
  const section = /### 4\.6 [^\n]*\n([\s\S]*?)\n---\n/u.exec(readFileSync(SPEC, "utf8"));
  if (section === null) throw new Error("SPEC 4.6 no longer states what each tool declares");
  const block = /```ts\n\{\n([\s\S]*?)\n\}\n```/u.exec(section[1]!);
  if (block === null) throw new Error("SPEC 4.6 no longer gives the server Implementation");
  const fields = Object.fromEntries(
    [...block[1]!.matchAll(/^ {2}(\w+): "([^"]*)",$/gmu)].map(([, key, value]) => [key!, value!]),
  );
  // `version: VERSION` is the one unquoted field, so it is absent by design.
  if (fields.title === undefined) throw new Error("SPEC 4.6 no longer names the server's title");
  return fields;
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
