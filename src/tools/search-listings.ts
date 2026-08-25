import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ENVELOPE_OUTPUT_SHAPE } from "../envelope.ts";
import { getFetchCore } from "../fetch/core.ts";
import type { CityDataset } from "../locations/city-dataset.ts";
import { findLocations, qualifiedLocationName } from "../locations/find-locations.ts";
import { log } from "../logging.ts";
import { parseSearchPage } from "../search/parse-search-page.ts";
import { SearchRowSchema } from "../search/search-row.ts";
import {
  isDegenerateForm,
  REACHABLE,
  searchUrl,
  SearchQuerySchema,
  SORTS,
  type SearchQuery,
} from "../search/search-url.ts";
import { toolError, toolResult } from "./tool-result.ts";

/** SPEC 4.1, verbatim. */
export const SEARCH_LISTINGS_DESCRIPTION =
  "One page of listings matching a search query. Promoted listings repeat on\nevery page; high-volume queries drift between pages, so a listing can be\nmissed or seen twice across a walk.";

const CandidateSchema = z.object({ id: z.number().int().positive(), label: z.string() });

/**
 * **The ambiguity ships as a value, not as a warning** (SPEC 4.1).
 *
 * `?locationStr=` resolves server-side and silently *picks* among colliding
 * nodes without saying which it rejected. The bundled dataset sees the
 * collision at zero request cost, so the caller is told the alternatives
 * instead of being told to be careful.
 */
const LocationResolutionSchema = z.object({
  input: z.string(),
  resolved_to: CandidateSchema.nullable(),
  ambiguous: z.boolean(),
  alternatives: z.array(CandidateSchema),
});

const outputSchema = {
  ...ENVELOPE_OUTPUT_SHAPE,
  listings: z.array(SearchRowSchema),
  /** The site's stated count, read as a number off the results summary (SPEC 5.5). */
  total: z.number().int().nonnegative().nullable(),
  /**
   * 25 × 50. **Separate from `total` and it stays separate** — collapsing them
   * into `min(stated, 1250)` is the "25 results vs 25 of 40 000" failure this
   * surface exists to avoid (SPEC 2.4, 4.1).
   */
  reachable: z.literal(REACHABLE),
  range: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
  clamped: z.boolean(),
  organic_count: z.number().int().nonnegative(),
  promoted_count: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  /** What was **sent**, never what was applied: the applied sort cannot be read back (SPEC 4.1). */
  sort: z.enum(SORTS).nullable(),
  location_resolution: LocationResolutionSchema.optional(),
};

/**
 * A postcode resolves to nothing here — the postcode layer's ids are absent
 * from every allowed source — so it reaches the site as free text and the site
 * picks for itself. That shortfall is recorded in SPEC §4.1's correction rather
 * than hidden behind a guess.
 */
function resolveLocation(dataset: CityDataset, input: string): z.infer<typeof LocationResolutionSchema> {
  const candidates = findLocations(dataset, input).map((location) => ({
    id: location.location_id,
    label: qualifiedLocationName(location),
  }));
  const only = candidates.length === 1 ? candidates[0]! : null;
  return {
    input,
    resolved_to: only,
    // More than one match and no pick: naming one would be the silent picking
    // this field exists to expose.
    ambiguous: candidates.length > 1,
    alternatives: only === null ? candidates : [],
  };
}

/**
 * One page per call, **exactly one request**, and never a fan-out over the rows
 * it returns (SPEC 2.5).
 *
 * Page N is addressed directly, so it never replays 1…N−1, and there is no
 * internal walk and no opaque cursor: a cursor would be a fiction maintained
 * over a source that has none, and `nextCursor: null` can say the walk stopped
 * but never that the page was *clamped*.
 */
export function registerSearchListings(server: McpServer, readCityDataset: () => CityDataset): void {
  server.registerTool(
    "search_listings",
    {
      description: SEARCH_LISTINGS_DESCRIPTION,
      inputSchema: SearchQuerySchema,
      outputSchema,
    },
    async (query: SearchQuery) => {
      const page = query.page ?? 1;
      const url = searchUrl(query);
      try {
        const { data, envelope } = await getFetchCore().fetch(url, (body) =>
          parseSearchPage(body, { page, degenerate_form: isDegenerateForm(query) }),
        );
        const result = {
          ...envelope,
          ...data,
          reachable: REACHABLE,
          page,
          sort: query.sort ?? null,
          // Present only where the site was asked to resolve free text, because
          // that is the only place it silently picks. The bundled dataset is
          // read here and nowhere else, so a keyword-only search never touches
          // it (SPEC 7).
          ...(query.location === undefined
            ? {}
            : { location_resolution: resolveLocation(readCityDataset(), query.location) }),
        };
        log("search_listings", {
          page,
          organic_count: result.organic_count,
          promoted_count: result.promoted_count,
          total: result.total,
          clamped: result.clamped,
          stale: result.stale,
        });
        return toolResult(result);
      } catch (error) {
        return toolError(error, "search_listings");
      }
    },
  );
}
