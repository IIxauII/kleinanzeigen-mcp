/**
 * The raw-page cache both fixture captures fetch through (SPEC 8.6).
 *
 * Raw pages are written to a gitignored scratch directory and reused on a
 * re-run, so iterating on a minimiser costs no further requests. The
 * politeness gap lives here rather than in either script, so the two cannot
 * drift into different notions of polite.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { USER_AGENT } from "../src/user-agent.ts";

const RAW_DIR = fileURLToPath(new URL("../.fixture-capture/", import.meta.url));

/** Personal-scale politeness: serialised, no bursting (SPEC 2.8). */
const REQUEST_GAP_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One page, from the scratch directory if it is there and from the site if it is not. */
export async function raw(name: string, url: string, refetch: boolean): Promise<string> {
  const path = `${RAW_DIR}${name}.html`;
  if (!refetch && existsSync(path)) return readFileSync(path, "utf8");
  process.stderr.write(`GET ${url}\n`);
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const body = await response.text();
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(path, body);
  await sleep(REQUEST_GAP_MS);
  return body;
}
