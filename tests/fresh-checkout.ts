import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const checkouts: string[] = [];

/**
 * A copy of the tree as a fresh clone has it — no `dist/`, dependencies
 * borrowed through a symlink so the copy needs no install of its own.
 *
 * Both packaging tests pack from one of these rather than from the repo, for
 * the same two reasons: a checkout without `dist/` is the fresh-clone case
 * `prepack` exists for, so packing from one is the honest test of it (SPEC
 * 8.2); and it keeps `prepack`'s `clean: true` from deleting `dist/index.js`
 * underneath the stdio tests spawning it in a parallel worker (SPEC 8.6).
 */
export function freshCheckout(): string {
  const dir = mkdtempSync(join(tmpdir(), "kleinanzeigen-pack-"));
  checkouts.push(dir);
  cpSync(ROOT, dir, {
    recursive: true,
    filter: (source) => !/(?:^|[/\\])(?:node_modules|\.git|\.claude|dist)$/.test(source),
  });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

/**
 * Removes every checkout handed out so far. Call it from `afterAll`.
 *
 * `checkouts` is module state, so under vitest's default per-file isolation
 * each test file gets its own and removes only what it made. Turning
 * `isolate: false` on would share one array across files, and one file's
 * teardown would delete another's checkout mid-pack — worth knowing before
 * anyone reaches for that setting to speed the suite up (SPEC 8.6).
 */
export function removeCheckouts(): void {
  while (checkouts.length > 0) rmSync(checkouts.pop()!, { recursive: true, force: true });
}
