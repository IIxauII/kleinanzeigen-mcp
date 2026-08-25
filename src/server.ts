import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCategoryTree, type CategoryTree } from "./categories/category-tree.ts";
import { loadCityDataset, type CityDataset } from "./locations/city-dataset.ts";
import { registerFindCategory } from "./tools/find-category.ts";
import { registerFindLocation } from "./tools/find-location.ts";
import { VERSION } from "./version.ts";

/**
 * Builds the server and registers the tool surface. Nothing is read from disk
 * and no request is made here — each bundled dataset loads on first use
 * (SPEC 7).
 *
 * The two readers are overridable so tests can supply a dataset without a built
 * sidecar file.
 */
export function createServer(
  readCategoryTree: () => CategoryTree = loadCategoryTree,
  readCityDataset: () => CityDataset = loadCityDataset,
): McpServer {
  const server = new McpServer(
    { name: "kleinanzeigen-mcp", version: VERSION },
    { capabilities: { tools: {} } },
  );
  registerFindCategory(server, readCategoryTree);
  registerFindLocation(server, readCityDataset);
  return server;
}
