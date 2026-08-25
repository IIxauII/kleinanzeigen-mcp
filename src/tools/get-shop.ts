import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ENVELOPE_OUTPUT_SHAPE } from "../envelope.ts";
import { getFetchCore } from "../fetch/core.ts";
import { log } from "../logging.ts";
import { parseShopAds } from "../shop/parse-shop-ads.ts";
import { parseShopPage } from "../shop/parse-shop-page.ts";
import { GetShopArgsSchema, isFiltered, shopAdsRequest, shopPageUrl, type GetShopArgs } from "../shop/shop-request.ts";
import { ShopRowSchema, ShopSchema } from "../shop/shop.ts";
import { toolError, toolResult } from "./tool-result.ts";

/** SPEC 4.3, verbatim. */
export const GET_SHOP_DESCRIPTION =
  "Profile and listings for one COMMERCIAL seller. Private sellers have no\nshop page and cannot be reached by this server.";

const SHOP_STATUSES = ["ok", "gone"] as const;

const OutputSchema = z.object({
  ...ENVELOPE_OUTPUT_SHAPE,
  /** `gone` is a normal result: the slug named no shop (see `parse-shop-page.ts`). */
  status: z.enum(SHOP_STATUSES),
  /**
   * **Present exactly when the shop page was the surface that answered** —
   * page 1, unfiltered — and `null` otherwise.
   *
   * The profile lives in the shop page's islands and the paging RPC carries
   * none of it: no name, no seller id, no logo, no prose. Filling it in for a
   * deeper or a filtered page would mean a second request behind one call,
   * which is the hidden rate-limit multiplier §2.5 exists to refuse. So the
   * profile is fetched by the call that can have it for free, and a caller who
   * wants both asks twice — knowingly, at one request each.
   */
  shop: ShopSchema.nullable(),
  listings: z.array(ShopRowSchema),
  page: z.number().int().min(1),
  /**
   * The listings **on this page**, and nothing wider. It is deliberately not
   * reconciled with `shop.ads_online`: three shop counts exist, no authority
   * among them is known, and a total assembled here would be a fourth
   * (SPEC 9.14).
   */
  count: z.number().int().nonnegative(),
});

export type GetShopResult = z.infer<typeof OutputSchema>;

/**
 * Profile and inventory for one commercial seller, **one request per call**
 * (SPEC 4.3).
 *
 * Which surface answers is decided by the call, and the two are genuinely
 * different sources:
 *
 * - **Page 1, unfiltered — the shop page.** Its Astro island carries the
 *   profile *and* the first 25 listings in one blob, so the cheapest call is
 *   also the complete one.
 * - **Anything else — the inventory RPC.** The shop page does not paginate and
 *   it does not filter: both obvious query parameters return a byte-identical
 *   page 1 and the path form 404s (SPEC 5.2). The RPC's filters — keywords,
 *   category, location, price bounds — are genuinely server-side, which is
 *   what admits them under §2.6's rule.
 *
 * **This hands commercial sellers an in-shop search that private sellers have
 * no equivalent for.** That asymmetry is real and is stated rather than
 * papered over: it is a direct consequence of refusing the private
 * Bestandsliste, which `robots.txt` fences and this server therefore does not
 * read (SPEC 2.1, 4.3, 9.7). Declining the capability here would not give
 * private sellers parity; it would only make the gap harder to see.
 */
export function registerGetShop(server: McpServer): void {
  server.registerTool(
    "get_shop",
    {
      description: GET_SHOP_DESCRIPTION,
      inputSchema: GetShopArgsSchema,
      outputSchema: OutputSchema.shape,
    },
    async (args: GetShopArgs) => {
      const page = args.page ?? 1;
      const fromIsland = page === 1 && !isFiltered(args);
      try {
        const result = await (async (): Promise<GetShopResult> => {
          if (fromIsland) {
            const { data, envelope } = await getFetchCore().fetch(
              shopPageUrl(args.shop_slug),
              // The response's own URL, not the one that was asked for: an
              // unknown slug is a 200 with a shop-shaped page, so where the
              // redirects came to rest is half the guard.
              (body, response) => parseShopPage(body, { finalUrl: response.url }),
            );
            if (data.status === "gone") {
              return { ...envelope, status: "gone", shop: null, listings: [], page, count: 0 };
            }
            return {
              ...envelope,
              status: "ok",
              shop: data.shop,
              listings: data.listings,
              page,
              count: data.listings.length,
            };
          }
          const request = shopAdsRequest({ ...args, page });
          const { data, envelope } = await getFetchCore().fetch(
            request.url,
            (body) => parseShopAds(body),
            request.body,
          );
          // An empty page past the end of the inventory is the walk ending,
          // not a failure and not a missing page (SPEC 5.2).
          return {
            ...envelope,
            status: "ok",
            shop: null,
            listings: data.listings,
            page,
            count: data.listings.length,
          };
        })();
        log("get_shop", {
          shop_slug: args.shop_slug,
          page,
          source: fromIsland ? "island" : "rpc",
          status: result.status,
          count: result.count,
          stale: result.stale,
        });
        return toolResult(result);
      } catch (error) {
        return toolError(error, "get_shop");
      }
    },
  );
}
