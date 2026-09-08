import { McpServer } from "@modelcontextprotocol/server";
import { loadCategoryTree, type CategoryTree } from "./categories/category-tree.ts";
import { loadCityDataset, type CityDataset } from "./locations/city-dataset.ts";
import { registerFindCategory } from "./tools/find-category.ts";
import { registerFindLocation } from "./tools/find-location.ts";
import { registerFindShop } from "./tools/find-shop.ts";
import { registerGetListing } from "./tools/get-listing.ts";
import { registerGetShop } from "./tools/get-shop.ts";
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
    {
      name: "kleinanzeigen-mcp",
      version: VERSION,
      // The clipped stem, lowercase and verbatim: it deliberately does not
      // match the `claude mcp add kleinanzeigen` install handle, and puts
      // distance between this project's display name and the site's
      // trademark. It states neither read-only nor unofficial — the
      // description and the README carry those (SPEC 4.6).
      title: "kanzeigen",
      // One string, reused verbatim in five slots: `package.json`, here,
      // `server.json`, the MCPB manifest and `plugin.json` (SPEC 4.6, 8.7).
      description: "A read-only, robots-clean MCP server over kleinanzeigen.de",
      websiteUrl: "https://github.com/IIxauII/kleinanzeigen-mcp",
      // No `icons`, here or on any tool: a data URI inflates every
      // `tools/list`, a remote URL is a fetch this server has no business
      // making, and the site's own logo would imply the endorsement ADR-0003
      // exists to avoid claiming (SPEC 4.6).
    },
    { capabilities: { tools: {} } },
  );
  registerSearchListings(server, readCityDataset);
  registerGetListing(server);
  registerGetShop(server);
  registerFindCategory(server, readCategoryTree);
  registerFindLocation(server, readCityDataset);
  registerFindShop(server, readCategoryTree);
  return server;
}
