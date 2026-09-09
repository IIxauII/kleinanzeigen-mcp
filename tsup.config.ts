import { chmodSync, copyFileSync } from "node:fs";
import { defineConfig } from "tsup";
import { stageMcpb } from "./scripts/stage-mcpb.ts";

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
  // cheerio's HTML decoding reaches `require("buffer")` through `safer-buffer`,
  // and esbuild's ESM output otherwise answers that with a throw. Handing the
  // bundle a real `require` resolves it to the Node builtin — the shim the
  // bundle already emits picks this up by name (SPEC 8.2).
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __createRequire } from "node:module";',
      "var require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  onSuccess: async () => {
    copyFileSync("data/category-tree.json", "dist/category-tree.json");
    copyFileSync("data/cities.json", "dist/cities.json");
    chmodSync("dist/index.js", 0o755);
    // The MCPB bundle is assembled here rather than at pack time so that what
    // ships is an allowlist written down in one place, and so a build is enough
    // to reproduce the artefact locally (SPEC 8.7).
    stageMcpb();
  },
});
