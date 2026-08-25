import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCategoryTree, type CategoryTree } from "./categories/category-tree.ts";
import { registerFindCategory } from "./tools/find-category.ts";
import { VERSION } from "./version.ts";

/**
 * Builds the server and registers the tool surface. Nothing is read from disk
 * and no request is made here — the bundled tree loads on first use (SPEC 7).
 *
 * `readCategoryTree` is overridable so tests can supply a tree without a built
 * sidecar file.
 */
export function createServer(readCategoryTree: () => CategoryTree = loadCategoryTree): McpServer {
  const server = new McpServer(
    { name: "kleinanzeigen-mcp", version: VERSION },
    { capabilities: { tools: {} } },
  );
  registerFindCategory(server, readCategoryTree);
  return server;
}
