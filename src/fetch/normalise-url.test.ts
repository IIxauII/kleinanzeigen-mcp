import { describe, expect, it } from "vitest";
import { normaliseUrl } from "./normalise-url.ts";

describe("cache-key normalisation", () => {
  it("sorts the query string so parameter order cannot fragment the cache", () => {
    const a = normaliseUrl("https://www.kleinanzeigen.de/s-fahrrad/k0?radius=10&locationStr=Berlin");
    const b = normaliseUrl("https://www.kleinanzeigen.de/s-fahrrad/k0?locationStr=Berlin&radius=10");
    expect(a).toBe(b);
    expect(a).toBe("https://www.kleinanzeigen.de/s-fahrrad/k0?locationStr=Berlin&radius=10");
  });

  it("keeps repeated keys, in their own order, rather than collapsing them", () => {
    expect(normaliseUrl("https://x.de/s?a=2&a=1")).toBe("https://x.de/s?a=2&a=1");
  });

  it("leaves the path untouched — a shop slug is case-sensitive", () => {
    expect(normaliseUrl("https://www.kleinanzeigen.de/pro/Autohaus-Meyer-GmbH")).toBe(
      "https://www.kleinanzeigen.de/pro/Autohaus-Meyer-GmbH",
    );
    expect(normaliseUrl("https://www.kleinanzeigen.de/pro/autohaus-meyer-gmbh-1")).not.toBe(
      normaliseUrl("https://www.kleinanzeigen.de/pro/Autohaus-Meyer-GmbH"),
    );
  });

  it("drops an empty query string and any fragment", () => {
    expect(normaliseUrl("https://x.de/s-fahrrad/k0?")).toBe("https://x.de/s-fahrrad/k0");
    expect(normaliseUrl("https://x.de/s-fahrrad/k0#top")).toBe("https://x.de/s-fahrrad/k0");
  });

  it("refuses a string that is not a URL", () => {
    expect(() => normaliseUrl("/s-fahrrad/k0")).toThrow();
  });
});
