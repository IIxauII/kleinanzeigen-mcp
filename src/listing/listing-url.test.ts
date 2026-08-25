import { describe, expect, it } from "vitest";
import { GetListingArgsSchema, isListingDetailUrl, listingUrl } from "./listing-url.ts";

describe("the listing detail URL", () => {
  it("is the ad id alone, with a stand-in for the cosmetic slug", () => {
    expect(listingUrl("3490780801")).toBe("https://www.kleinanzeigen.de/s-anzeige/x/3490780801");
  });
});

describe("the argument the caller passes", () => {
  it("is the ad id, and nothing that decorates it in a listing URL", () => {
    // The slug and the trailing category and location codes are cosmetic, so
    // they are not asked of the caller (SPEC 4.2).
    expect(GetListingArgsSchema.parse({ ad_id: "3490780801" })).toEqual({ ad_id: "3490780801" });
    for (const ad_id of [
      "3490780801-217-4070",
      "/s-anzeige/x/3490780801",
      "https://www.kleinanzeigen.de/s-anzeige/x/3490780801",
      "",
      " 3490780801",
    ]) {
      expect(GetListingArgsSchema.safeParse({ ad_id }).success).toBe(false);
    }
  });

  it("refuses an argument the tool does not have, rather than ignoring it", () => {
    expect(GetListingArgsSchema.safeParse({ ad_id: "3490780801", fields: ["price"] }).success).toBe(false);
  });
});

describe("the deleted-ad guard's reading of a final URL", () => {
  it("accepts a listing detail URL, in either of the forms the site serves", () => {
    expect(isListingDetailUrl("https://www.kleinanzeigen.de/s-anzeige/x/3490780801")).toBe(true);
    expect(isListingDetailUrl("https://www.kleinanzeigen.de/s-anzeige/ein-slug/3490780801-217-4070")).toBe(true);
  });

  it("refuses every page a missing listing is redirected to", () => {
    // Neither answers 404 and neither leaves a tombstone: one is a browse page
    // synthesised from the URL's own codes, the other is the homepage
    // (SPEC 5.3).
    expect(isListingDetailUrl("https://www.kleinanzeigen.de/s-fahrraeder/weisswasser/c217l4069")).toBe(false);
    expect(isListingDetailUrl("https://www.kleinanzeigen.de/")).toBe(false);
  });

  it("refuses a listing path that is not on the site's own origin", () => {
    expect(isListingDetailUrl("https://kleinanzeigen.de.example.com/s-anzeige/x/3490780801")).toBe(false);
    expect(isListingDetailUrl("/s-anzeige/x/3490780801")).toBe(false);
    expect(isListingDetailUrl("")).toBe(false);
  });
});
