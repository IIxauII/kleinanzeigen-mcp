import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CategoryTree } from "../categories/category-tree.ts";
import { ENVELOPE_OUTPUT_SHAPE } from "../envelope.ts";
import { getFetchCore } from "../fetch/core.ts";
import { log } from "../logging.ts";
import {
  DIRECTORY_PAGE_SIZE,
  directoryRequest,
  findShopArgsSchema,
  type FindShopArgs,
} from "../shop/directory-request.ts";
import { parseShopDirectory } from "../shop/parse-directory.ts";
import { ShopCandidateSchema } from "../shop/shop.ts";
import { READS_LIVE_SITE } from "./annotations.ts";
import { toolError, toolResult } from "./tool-result.ts";

/** SPEC 4.5, verbatim. */
export const FIND_SHOP_DESCRIPTION =
  "Shop slugs for COMMERCIAL sellers matching a name. Makes a live request,\nunlike the other resolvers. A match may be a mention in a shop's profile\ntext rather than its name, so check before using one.";

const OutputSchema = z.object({
  ...ENVELOPE_OUTPUT_SHAPE,
  /**
   * **Always a list, and never auto-selected — not even at a count of one.**
   *
   * On the other two resolvers that rule guards against homonyms. Here it is a
   * **correctness** guard: `fulltext` matches a shop's profile prose and not
   * just its name, so `"decathlon"` returns a systems-integration firm whose
   * `about` text merely names Decathlon as a customer. A single exact hit can
   * still be the wrong shop, and there is no `searchScope` that excludes the
   * prose match (SPEC 4.5).
   */
  matches: z.array(ShopCandidateSchema),
  /**
   * The directory's `totalHits` — **the whole match set, not this page**. Where
   * it exceeds `matches.length` it is the value that says *narrow the query*,
   * which is the same `total` / `reachable` separation the search envelope
   * makes (SPEC 4.1, 4.5).
   */
  count: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  /** Fixed in code, and reported so a caller can see what the offset was a multiple of. */
  page_size: z.literal(DIRECTORY_PAGE_SIZE),
});

export type FindShopResult = z.infer<typeof OutputSchema>;

/**
 * The odd resolver out: **one live request**, subject to the same limiter, the
 * same cache and every error rule the network tools share (SPEC 4.5, 6).
 *
 * `find_category` and `find_location` resolve in-process against bundled
 * datasets, and the shop directory is deliberately not bundled: `liveAds` is a
 * live inventory count a snapshot would freeze, the ordering reseeds nightly,
 * `totalHits` drifted by three inside thirty minutes, and sweeping the 53 808
 * shops would be 1 077 requests — precisely the crawl the AGB describes
 * (SPEC 1, 7).
 *
 * The bundled category tree is still read here, at zero request cost, to check
 * `category_id` before a request is spent on one the taxonomy does not have —
 * and it is not touched by a name-only lookup (SPEC 7). `location_id` gets no
 * such check: see `directory-request.ts` for why the city dataset cannot back
 * one.
 */
export function registerFindShop(server: McpServer, readCategoryTree: () => CategoryTree): void {
  server.registerTool(
    "find_shop",
    {
      title: "Find shops",
      description: FIND_SHOP_DESCRIPTION,
      // The resolver that fetches, so its world is open despite the `find_`
      // prefix the other two share (SPEC 4.6).
      annotations: READS_LIVE_SITE,
      inputSchema: findShopArgsSchema(readCategoryTree),
      outputSchema: OutputSchema,
    },
    async (args: FindShopArgs) => {
      const request = directoryRequest(args);
      try {
        const { data, envelope } = await getFetchCore().fetch(
          request.url,
          (body) => parseShopDirectory(body),
          request.body,
        );
        const result = { ...envelope, ...data, page: request.page, page_size: DIRECTORY_PAGE_SIZE } as const;
        // **No name.** §6.4 keeps seller names out of the log, and the string
        // this tool searches on is a seller's name — `search_listings` logs
        // neither its keyword nor its location for the same reason. The
        // `fetch` line's URL is the permitted metadata, and it carries no
        // query: the parameters ride the POST body.
        log("find_shop", {
          page: request.page,
          matches: result.matches.length,
          count: result.count,
          stale: result.stale,
        });
        return toolResult(result);
      } catch (error) {
        return toolError(error, "find_shop");
      }
    },
  );
}
