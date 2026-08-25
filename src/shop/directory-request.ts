import { z } from "zod";
import type { CategoryTree } from "../categories/category-tree.ts";
import type { CityDataset } from "../locations/city-dataset.ts";
import { ORIGIN } from "../search/search-url.ts";

/** The shop directory's search action. No CSRF token, no cookies, no session (SPEC 2.2). */
const DIRECTORY_ACTION = "/_actions/proPublicWeb.brandingIndex.searchBrandings/";

/**
 * **Fixed in code and not exposed** (SPEC 4.5, 8.4), and this one is not a
 * matter of taste: **the ordering is a function of `pageSize`**. The same
 * query, the same daily seed and the same offset return a *different order* at
 * 21 than at 50, so a caller-set page size would silently reshuffle results
 * between calls and a walk would overlap and miss. 50 is also the action's hard
 * ceiling — 51 answers HTTP 204 with a zero-byte body, which the request path
 * refuses outright.
 */
export const DIRECTORY_PAGE_SIZE = 50;

/** The shop view, and the only one in scope: `TILE` is the browse surface (SPEC 1, 4.5). */
const DIRECTORY_VIEW = "CARD";

/**
 * `BRANDING` behaved identically to `BOTH` and did not suppress the prose
 * match, and `ADS` was never sent — so the parameter is unexplored rather than
 * a name-only mode, and nothing here specifies around it (SPEC 11, §4.5).
 */
const DIRECTORY_SEARCH_SCOPE = "BOTH";

const BaseArgsSchema = z
  // **Strict**, as everywhere else on the surface: `page_size`, `view` and
  // `search_scope` are fixed in code, and an argument that does not exist must
  // not look answered (SPEC 2.6, 4.5).
  .strictObject({
    name: z
      .string()
      .min(1)
      .describe("The commercial seller's name, passed to the directory's full-text search unchanged."),
    category_id: z.number().int().positive().optional(),
    location_id: z.number().int().positive().optional(),
    page: z.number().int().min(1).optional(),
  });

export type FindShopArgs = z.infer<typeof BaseArgsSchema>;

/**
 * The arguments, with the two filter ids checked against the **bundled** trees.
 *
 * The check is possible at all because **the directory's filter ids are the
 * same numeric ids** the bundled datasets carry, and it costs nothing: no
 * request, and the dataset behind an id that was not given is never even read
 * (SPEC 4.5, 7).
 *
 * It is worth doing because an id the taxonomy does not have is not a question
 * the site can answer honestly. The action takes it, filters by it, and returns
 * a result set the caller reads as "no shops in that category" when what
 * happened is that there is no such category — a plausible wrong answer rather
 * than an honest empty set, which is the seam §11.4 draws. `search_listings`
 * does not make this check because its ids ride a URL path code the site
 * resolves for itself; here the id goes to a filter field, and the bundled tree
 * is the same authority the caller got the id from.
 */
export function findShopArgsSchema(
  readCategoryTree: () => CategoryTree,
  readCityDataset: () => CityDataset,
): typeof BaseArgsSchema {
  return BaseArgsSchema.superRefine((args, ctx) => {
    if (args.category_id !== undefined && !readCategoryTree().some((node) => node.category_id === args.category_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["category_id"],
        message: `no bundled category has id ${args.category_id}; resolve the name with find_category first`,
      });
    }
    if (args.location_id !== undefined && !readCityDataset().some((node) => node.location_id === args.location_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["location_id"],
        message: `no bundled location has id ${args.location_id}; resolve the name with find_location first`,
      });
    }
  });
}

export type DirectoryRequest = { url: string; body: Record<string, unknown> };

/**
 * One page of the directory search.
 *
 * Every wire name is the site's, and this is the one place the mapping from
 * `snake_case` arguments lives (SPEC 11.5).
 *
 * **The caller's string reaches `fulltext` byte for byte.** Nothing folds an
 * umlaut on the way: the site's own handling of one is uncharacterised, and
 * the folded form is not a wider net but a *different, tiny* one — `köln`
 * returns 492 hits, `koln` returns 3, and those 3 include a shop whose name has
 * the umlaut (SPEC 4.5, 9). §4.4's fold is a local comparison against a
 * bundled dataset and does not reach here.
 */
export function directoryRequest(args: FindShopArgs): DirectoryRequest {
  const body: Record<string, unknown> = {
    view: DIRECTORY_VIEW,
    fulltext: args.name,
    searchScope: DIRECTORY_SEARCH_SCOPE,
  };
  if (args.category_id !== undefined) body["categoryId"] = args.category_id;
  if (args.location_id !== undefined) body["locationId"] = args.location_id;
  body["from"] = ((args.page ?? 1) - 1) * DIRECTORY_PAGE_SIZE;
  body["pageSize"] = DIRECTORY_PAGE_SIZE;
  return { url: new URL(DIRECTORY_ACTION, ORIGIN).toString(), body };
}
