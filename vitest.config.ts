import { configDefaults, defineConfig } from "vitest/config";

// Agent worktrees live under `.claude/`, and each is a full copy of this tree.
// Without the exclusion vitest globs them alongside the real suite and runs it
// once per worktree — the count inflates and stale checkouts fail against code
// that no longer exists here, which is how a 40-file suite once reported itself
// as 160 files and 1 784 tests, quietly passing (SPEC 8.6).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
