import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ENVELOPE_OUTPUT_SHAPE, localEnvelope } from "../envelope.ts";
import { LocationNodeSchema, type CityDataset } from "../locations/city-dataset.ts";
import { findLocations } from "../locations/find-locations.ts";
import { log } from "../logging.ts";
import { toolResult } from "./tool-result.ts";

/** SPEC 4.4, verbatim. */
export const FIND_LOCATION_DESCRIPTION =
  "Location ids matching a name or postcode. Always returns candidates — a\npostcode can map to several locations.";

// **Strict**, as on `search_listings`: an argument this resolver does not have
// is refused rather than stripped, so a caller that invents `limit` or `parent`
// is told, instead of reading an unfiltered list as a filtered one (SPEC 2.6).
const inputSchema = z.strictObject({
  query: z
    .string()
    .describe(
      'A German place name, optionally qualified as "Bundesland > Ort". ' +
        "A five-digit postcode matches nothing: the postcode layer's ids are " +
        "absent from every source this dataset may read. Pass a postcode to " +
        "search_listings' free-text `location` instead, which the site resolves " +
        "itself — silently picking when the postcode spans several locations.",
    ),
});

const outputSchema = {
  ...ENVELOPE_OUTPUT_SHAPE,
  matches: z.array(LocationNodeSchema),
  count: z.number().int().nonnegative(),
};

/**
 * Zero requests: resolves in-process against the bundled dataset.
 *
 * Always a list, never a bare object and never a `best:` hint, even on a single
 * exact hit — a shape that sometimes resolves for you is a shape that teaches
 * the caller to stop reading (SPEC 4.4). A location id implies its whole
 * subtree, so one id is the whole catchment and nothing downstream searches a
 * city's districts one by one (SPEC 7).
 */
export function registerFindLocation(server: McpServer, readCityDataset: () => CityDataset): void {
  server.registerTool(
    "find_location",
    { description: FIND_LOCATION_DESCRIPTION, inputSchema, outputSchema },
    ({ query }) => {
      const matches = findLocations(readCityDataset(), query);
      // The envelope rides on every result, request or no request: `fetched_at`
      // is uniform so a caller can reason about recency without knowing which
      // tools fetch, and `source_url` is null here because none was read
      // (SPEC 3.6).
      const result = { ...localEnvelope(), matches, count: matches.length };
      log("find_location", { count: result.count });
      return toolResult(result);
    },
  );
}
