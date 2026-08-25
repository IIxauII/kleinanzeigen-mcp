import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { readViewAdInit } from "./view-ad-init.ts";

/** The site's own spelling: mixed quoting, and spacing that is not consistent. */
const init = (body: string): string => `
  <script>
    Belen.Search.ViewAdView.init({
    ${body}
    libertyPageType: "VIP",
    });
  </script>
`;

const LIVE = `
    adExpired:false,
    adId:'3490780801',
    adPrice: 730.00,
    adPriceType: 'FIXED',
    isCommercialUser: false,
    isWantedAdType: false,
    showDeletedVeil: false,
    showPausedVeil: false,
`;

describe("the listing detail page's JS init", () => {
  it("reads the ad id, the price and the three veil flags", () => {
    expect(readViewAdInit(init(LIVE))).toEqual({
      ad_id: "3490780801",
      price_type: "FIXED",
      price_amount: 730,
      commercial: false,
      flags: { expired: false, paused: false, deleted_veil: false },
    });
  });

  it("reads a veil that is set, which the live page does render", () => {
    // `showDeletedVeil: true` was read off a page still being served: the
    // flags are not the "always false" prior research assumed (SPEC 3.4).
    const veiled = readViewAdInit(init(LIVE.replace("showDeletedVeil: false", "showDeletedVeil: true")));
    expect(veiled.flags).toEqual({ expired: false, paused: false, deleted_veil: true });
  });

  it("reads a missing amount as missing, never as zero", () => {
    // A bare `VB` is `adPrice: null`, and it must stay structurally
    // unconfusable with a giveaway (SPEC 3.1).
    const bare = readViewAdInit(init(LIVE.replace("adPrice: 730.00", "adPrice: null").replace("'FIXED'", "'NEGOTIABLE'")));
    expect(bare).toMatchObject({ price_type: "NEGOTIABLE", price_amount: null });
  });

  it("reads a category with no price field as the empty price type", () => {
    expect(readViewAdInit(init(LIVE.replace("'FIXED'", "''"))).price_type).toBe("");
  });

  it("reads an unreadable seller type as unknown, never as a pole", () => {
    // "not commercial" is a weaker claim than "private" (SPEC 3.5).
    expect(readViewAdInit(init(LIVE.replace("isCommercialUser: false,", ""))).commercial).toBeNull();
  });

  it("refuses a page with no init block at all", () => {
    expect(() => readViewAdInit("<html><body>a page, but not that one</body></html>")).toThrow(ParseError);
  });

  it("refuses a page whose veil flags have gone", () => {
    // A flag read as false because it was absent is a state claimed rather
    // than observed, so the absence is loud instead (SPEC 5.8).
    expect(() => readViewAdInit(init(LIVE.replace("showPausedVeil: false,", "")))).toThrow(ParseError);
  });

  it("reads the init block only, never a value that merely appears on the page", () => {
    const decoy = `<script>var elsewhere = { adExpired: true };</script>${init(LIVE)}`;
    expect(readViewAdInit(decoy).flags.expired).toBe(false);
  });
});
