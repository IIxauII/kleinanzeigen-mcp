import { chmodSync, copyFileSync } from "node:fs";
import { defineConfig } from "tsup";

// One single-file ESM bundle with every dependency inlined (SPEC 8.2), plus the
// two datasets as sidecar JSON beside it — never inlined, so first-use reading
// stays lazy and the files stay diffable for the drift check (SPEC 7).
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    copyFileSync("data/category-tree.json", "dist/category-tree.json");
    copyFileSync("data/cities.json", "dist/cities.json");
    chmodSync("dist/index.js", 0o755);
  },
});
