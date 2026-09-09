import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

/**
 * Where the `.mcpb` contents are assembled, and what `mcpb pack` is pointed at.
 * Gitignored, and rebuilt from scratch on every build.
 */
export const MCPB_STAGING_DIR = fileURLToPath(new URL("build/mcpb/", ROOT));

/**
 * Everything that goes in the bundle, at the same path inside it as in the repo.
 *
 * **This list is the packaging rule, not a convenience.** `mcpb pack` honours
 * neither `.gitignore` nor `package.json:files` — its exclusion list is 34 fixed
 * patterns, and nothing in it matches `*.json` beyond `package-lock.json` and
 * `tsconfig.json` — so `mcpb pack .` at the repo root would ship `src/`,
 * `data/`, `scripts/` and the fixtures. A staging directory is an allowlist; a
 * `.mcpbignore` is a denylist that fails open, and this project's packaging
 * history is already one story about a denylist failing open (SPEC 8.7).
 *
 * `package.json` is here for `"type": "module"` alone: without it Node reparses
 * the ESM entry by syntax detection and warns `MODULE_TYPELESS_PACKAGE_JSON` on
 * every cold start. No `node_modules` — SPEC 8.2's bundle inlines all three
 * dependencies — and no Node runtime, which the host supplies.
 */
export const MCPB_STAGING_FILES = [
  "manifest.json",
  "package.json",
  "README.md",
  "dist/index.js",
  "dist/cities.json",
  "dist/category-tree.json",
] as const;

/** Assemble the staging directory from scratch. Returns its absolute path. */
export function stageMcpb(): string {
  rmSync(MCPB_STAGING_DIR, { recursive: true, force: true });
  for (const file of MCPB_STAGING_FILES) {
    const destination = join(MCPB_STAGING_DIR, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(fileURLToPath(new URL(file, ROOT)), destination);
  }
  return MCPB_STAGING_DIR;
}
