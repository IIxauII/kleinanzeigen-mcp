import { z } from "zod";
import type { CategoryTree } from "../categories/category-tree.ts";
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

/**
 * `view` is the one field the action refuses to default, and `CARD` is the one
 * value that answers the question this tool asks: it returns `brandingCards` —
 * a shop per hit. The enum the action leaked on a bad value has a second entry,
 * `TILE`, which returns `brandingTiles` instead; that is the directory as a
 * **browse** surface, which is out of scope on the ToS grounds §1 states, and
 * its record shape was never read. So `CARD` is fixed here rather than exposed
 * (SPEC 1, 4.5).
 */
const DIRECTORY_VIEW = "CARD";

/**
 * `BRANDING` behaved identically to `BOTH` and did not suppress the prose
 * match, and `ADS` was never sent — so the parameter is unexplored rather than
 * a name-only mode, and nothing here specifies around it (SPEC 4.5, 10).
 */
const DIRECTORY_SEARCH_SCOPE = "BOTH";

const BaseArgsSchema = z
  // **Strict**, as everywhere else on the surface: `page_size`, `view` and
  // `search_scope` are fixed in code, and an argument that does not exist must
  // not look answered (SPEC 2.6, 4.5).
  .strictObject({
    // **Refused when empty**, which §11.4's rule needs stated: the action
    // treats `fulltext` as optional and answers an omitted one with the whole
    // 53 808-shop directory rather than with a `400`. That is the browse
    // surface §1 puts out of scope, and it is not what a caller asking for a
    // shop by name meant.
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
 * The arguments, with **`category_id`** checked against the bundled tree.
 *
 * The check is possible at all because **the directory's filter ids are the
 * same numeric ids** the bundled datasets carry, and it costs nothing: no
 * request, and the tree is not read at all unless a category id was given
 * (SPEC 4.5, 7).
 *
 * It is worth doing because an id the taxonomy does not have is not a question
 * the site can answer honestly. The action takes it, filters by it, and returns
 * a result set the caller reads as "no shops in that category" when what
 * happened is that there is no such category — a plausible wrong answer rather
 * than an honest empty set, which is the seam §11.4 draws. `search_listings`
 * does not make this check because its ids ride a URL path code the site
 * resolves for itself; here the id goes to a filter field.
 *
 * **`location_id` is deliberately not checked the same way**, and the
 * difference is the datasets rather than the ids. The category tree is
 * complete — 159 of 159 nodes, byte-identical to the disallowed tree — while
 * the city dataset knowingly holds the first two tiers only: sub-Ortsteile
 * (Wedding `l3503`) and the whole postcode layer are absent from every allowed
 * source (SPEC 7's correction). Refusing `l3503` would reject an id the
 * directory filters by and answers honestly, which is the *opposite* of the
 * failure this check exists to prevent — and a caller can hold such an id
 * legitimately, since the third number in a listing URL is a location id.
 */
export function findShopArgsSchema(readCategoryTree: () => CategoryTree): typeof BaseArgsSchema {
  return BaseArgsSchema.superRefine((args, ctx) => {
    if (args.category_id !== undefined && !readCategoryTree().some((node) => node.category_id === args.category_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["category_id"],
        message: `no bundled category has id ${args.category_id}; resolve the name with find_category first`,
      });
    }
  });
}

export type DirectoryRequest = {
  url: string;
  body: Record<string, unknown>;
  /** The 1-based page this request asks for, resolved here so the default has one home. */
  page: number;
};

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
  const page = args.page ?? 1;
  const body: Record<string, unknown> = {
    view: DIRECTORY_VIEW,
    fulltext: args.name,
    searchScope: DIRECTORY_SEARCH_SCOPE,
  };
  if (args.category_id !== undefined) body["categoryId"] = args.category_id;
  if (args.location_id !== undefined) body["locationId"] = args.location_id;
  body["from"] = (page - 1) * DIRECTORY_PAGE_SIZE;
  body["pageSize"] = DIRECTORY_PAGE_SIZE;
  return { url: new URL(DIRECTORY_ACTION, ORIGIN).toString(), body, page };
}
