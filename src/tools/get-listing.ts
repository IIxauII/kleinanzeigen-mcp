import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ENVELOPE_OUTPUT_SHAPE } from "../envelope.ts";
import { getFetchCore } from "../fetch/core.ts";
import { GetListingArgsSchema, listingUrl, type GetListingArgs } from "../listing/listing-url.ts";
import { ListingSchema } from "../listing/listing.ts";
import { parseListingPage } from "../listing/parse-listing-page.ts";
import { log } from "../logging.ts";
import { toolError, toolResult } from "./tool-result.ts";

/** SPEC 4.2, verbatim. */
export const GET_LISTING_DESCRIPTION = "One listing in full, by ad id.";

export const LISTING_STATUSES = ["ok", "gone"] as const;

/**
 * `Envelope & ({ status: "ok" } & Listing | { status: "gone" })` (SPEC 4.2),
 * as the one object shape a tool's output schema can be.
 *
 * The union is real in the value and in `ListingResultSchema`, which is what
 * the tests assert against; here the listing's fields are marked optional
 * because **exactly one of the two variants carries them**, and a `gone`
 * result carries none of them at all. `status` is the discriminant a caller
 * branches on, and it is never absent.
 */
const OutputSchema = z.object({
  ...ENVELOPE_OUTPUT_SHAPE,
  status: z.enum(LISTING_STATUSES),
  ...ListingSchema.partial().shape,
});

export type GetListingResult = z.infer<typeof OutputSchema>;

/**
 * One listing in full, by ad id — **exactly one request, and never a fan-out**
 * (SPEC 2.5, 4.2).
 *
 * Two things about this tool are the reason it exists rather than being a
 * search row with more fields:
 *
 * - **The deleted-ad guard.** A missing listing does not 404 and leaves no
 *   tombstone: it 301s to a synthesised browse page and answers HTTP 200 with
 *   a full page of *other* listings. The final URL after redirects is checked
 *   before anything is parsed, and a page that is no longer a listing detail
 *   page yields `status: "gone"` with nothing read off it (SPEC 5.3).
 * - **`gone` is a normal result, not an error.** "This listing no longer
 *   exists" is an answer, and an answer is not retried; an error is
 *   (SPEC 6.3). Which failure *kind* it was — deleted, or expired and purged —
 *   is not knowable from a public page, so it is not claimed.
 */
export function registerGetListing(server: McpServer): void {
  server.registerTool(
    "get_listing",
    {
      description: GET_LISTING_DESCRIPTION,
      inputSchema: GetListingArgsSchema,
      outputSchema: OutputSchema.shape,
    },
    async ({ ad_id }: GetListingArgs) => {
      try {
        const { data, envelope } = await getFetchCore().fetch(listingUrl(ad_id), (body, response) =>
          // The response's own URL, not the one that was asked for: the whole
          // point is where the redirects came to rest (SPEC 5.3).
          parseListingPage(body, { finalUrl: response.url, ad_id }),
        );
        const result = { ...envelope, ...data };
        log("get_listing", { ad_id, status: result.status, stale: result.stale });
        return toolResult(result);
      } catch (error) {
        return toolError(error, "get_listing");
      }
    },
  );
}
