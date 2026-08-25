import { describe, expect, it } from "vitest";
import { GetListingArgsSchema, listingUrl, readFinalUrl } from "./listing-url.ts";

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
  it("reads a listing detail URL, in either of the forms the site serves", () => {
    expect(readFinalUrl("https://www.kleinanzeigen.de/s-anzeige/x/3490780801")).toBe("listing");
    expect(readFinalUrl("https://www.kleinanzeigen.de/s-anzeige/ein-slug/3490780801-217-4070")).toBe("listing");
  });

  it("reads the site's apex host as the site, not as a listing that is gone", () => {
    // A redirect that comes to rest there has still served the listing.
    expect(readFinalUrl("https://kleinanzeigen.de/s-anzeige/x/3490780801")).toBe("listing");
  });

  it("reads every page a missing listing is redirected to as not a listing", () => {
    // Neither answers 404 and neither leaves a tombstone: one is a browse page
    // synthesised from the URL's own codes, the other is the homepage
    // (SPEC 5.3).
    expect(readFinalUrl("https://www.kleinanzeigen.de/s-fahrraeder/weisswasser/c217l4069")).toBe("not-a-listing");
    expect(readFinalUrl("https://www.kleinanzeigen.de/")).toBe("not-a-listing");
    expect(readFinalUrl("https://kleinanzeigen.de/")).toBe("not-a-listing");
  });

  it("reads anywhere else as unreadable, which is a failure and never an answer", () => {
    // "We could not tell" must not arrive as "this listing is gone".
    expect(readFinalUrl("https://kleinanzeigen.de.example.com/s-anzeige/x/3490780801")).toBe("unreadable");
    expect(readFinalUrl("/s-anzeige/x/3490780801")).toBe("unreadable");
    expect(readFinalUrl("")).toBe("unreadable");
  });
});
