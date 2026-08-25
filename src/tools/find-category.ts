import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CategoryNodeSchema, type CategoryTree } from "../categories/category-tree.ts";
import { findCategories } from "../categories/find-categories.ts";
import { ENVELOPE_OUTPUT_SHAPE, localEnvelope } from "../envelope.ts";
import { log } from "../logging.ts";
import { toolResult } from "./tool-result.ts";

/** SPEC 4.4, verbatim. */
export const FIND_CATEGORY_DESCRIPTION =
  "Category ids matching a name. Always returns candidates — names and slugs\ncollide, so only the numeric id identifies a category.";

const inputSchema = {
  query: z.string().describe("A German category name, optionally qualified as \"Parent > Child\"."),
};

const outputSchema = {
  ...ENVELOPE_OUTPUT_SHAPE,
  matches: z.array(CategoryNodeSchema),
  count: z.number().int().nonnegative(),
};

/**
 * Zero requests: resolves in-process against the bundled tree.
 *
 * Always a list, never a bare object and never a `best:` hint, even on a single
 * exact hit — a shape that sometimes resolves for you is a shape that teaches
 * the caller to stop reading (SPEC 4.4).
 */
export function registerFindCategory(server: McpServer, readCategoryTree: () => CategoryTree): void {
  server.registerTool(
    "find_category",
    { description: FIND_CATEGORY_DESCRIPTION, inputSchema, outputSchema },
    ({ query }) => {
      const matches = findCategories(readCategoryTree(), query);
      // The envelope rides on every result, request or no request: `fetched_at`
      // is uniform so a caller can reason about recency without knowing which
      // tools fetch, and `source_url` is null here because none was read
      // (SPEC 3.6).
      const result = { ...localEnvelope(), matches, count: matches.length };
      log("find_category", { count: result.count });
      return toolResult(result);
    },
  );
}
