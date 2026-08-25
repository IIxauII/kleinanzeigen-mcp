import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCategoryTree, type CategoryTree } from "./categories/category-tree.ts";
import { loadCityDataset, type CityDataset } from "./locations/city-dataset.ts";
import { registerFindCategory } from "./tools/find-category.ts";
import { registerFindLocation } from "./tools/find-location.ts";
import { registerSearchListings } from "./tools/search-listings.ts";
import { VERSION } from "./version.ts";

/**
 * Builds the server and registers the tool surface. Nothing is read from disk
 * and no request is made here — each bundled dataset loads on first use
 * (SPEC 7).
 *
 * Each reader is overridable so a test can supply one dataset without a built
 * sidecar file — and without passing a positional `undefined` for the other.
 */
export type DatasetReaders = {
  readCategoryTree?: () => CategoryTree;
  readCityDataset?: () => CityDataset;
};

export function createServer({
  readCategoryTree = loadCategoryTree,
  readCityDataset = loadCityDataset,
}: DatasetReaders = {}): McpServer {
  const server = new McpServer(
    { name: "kleinanzeigen-mcp", version: VERSION },
    { capabilities: { tools: {} } },
  );
  registerSearchListings(server, readCityDataset);
  registerFindCategory(server, readCategoryTree);
  registerFindLocation(server, readCityDataset);
  return server;
}
