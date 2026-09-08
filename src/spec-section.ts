import { readFileSync } from "node:fs";

const SPEC = new URL("../SPEC.md", import.meta.url);

/**
 * The body of one numbered `###` section of `SPEC.md`, up to the rule that
 * closes it.
 *
 * Test support, and deliberately not on the bundle's import graph: the tests
 * that pin descriptions and annotations read the spec file itself rather than
 * trusting a careful copy-paste, so a spec edit the code does not follow fails
 * loudly. Two of them read the same §4.6, so the reader lives in one place.
 */
export function specSection(section: string): string {
  const heading = section.replaceAll(".", "\\.");
  const body = new RegExp(`### ${heading} [^\\n]*\\n([\\s\\S]*?)\\n---\\n`, "u").exec(spec());
  if (body === null) throw new Error(`SPEC ${section} is no longer a section of its own`);
  return body[1]!;
}

/** The whole spec, for the pins that match across sections. */
export function spec(): string {
  return readFileSync(SPEC, "utf8");
}
