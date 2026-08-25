import { afterEach, describe, expect, it, vi } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { parsePostingDate } from "./posting-date.ts";

afterEach(() => vi.useRealTimers());

describe("a search row's posting date", () => {
  it("carries its precision discriminant", () => {
    const at = new Date("2026-08-25T12:00:00Z");
    expect(parsePostingDate("Heute, 14:14", at).precision).toBe("minute");
    expect(parsePostingDate("23.08.2026", at).precision).toBe("day");
  });

  it("resolves Heute and Gestern in Europe/Berlin", () => {
    const at = new Date("2026-08-25T12:00:00Z");
    expect(parsePostingDate("Heute, 14:14", at)).toEqual({
      value: "2026-08-25T14:14:00+02:00",
      precision: "minute",
    });
    expect(parsePostingDate("Gestern, 22:00", at)).toEqual({
      value: "2026-08-24T22:00:00+02:00",
      precision: "minute",
    });
  });

  it("never resolves Heute against the machine's local date", () => {
    // 00:30 Berlin on the 26th is still 22:30 UTC on the 25th. Reading the
    // machine's date here shifts every recent listing by a day (SPEC 3.2).
    const at = new Date("2026-08-25T22:30:00Z");
    expect(parsePostingDate("Heute, 00:20", at).value).toBe("2026-08-26T00:20:00+02:00");
    expect(parsePostingDate("Gestern, 23:50", at).value).toBe("2026-08-25T23:50:00+02:00");
  });

  it("carries Berlin's own offset on either side of a DST switch", () => {
    // CEST ends 03:00 → 02:00 on 2026-10-25.
    const winter = new Date("2026-10-26T09:00:00Z");
    expect(parsePostingDate("Heute, 09:00", winter).value).toBe("2026-10-26T09:00:00+01:00");
    expect(parsePostingDate("Gestern, 23:00", winter).value).toBe("2026-10-25T23:00:00+01:00");

    const summer = new Date("2026-03-30T09:00:00Z");
    expect(parsePostingDate("Gestern, 04:00", summer).value).toBe("2026-03-29T04:00:00+02:00");
  });

  it("reads a day-precise date with no time attached to it", () => {
    expect(parsePostingDate("23.08.2026")).toEqual({ value: "2026-08-23", precision: "day" });
  });

  it("crosses a month boundary backwards", () => {
    const at = new Date("2026-09-01T10:00:00Z");
    expect(parsePostingDate("Gestern, 08:00", at).value).toBe("2026-08-31T08:00:00+02:00");
  });

  it("defaults to the process clock, which a test can stand still", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    expect(parsePostingDate("Heute, 07:05").value).toBe("2026-08-25T07:05:00+02:00");
  });

  it("throws on a spelling it does not know", () => {
    expect(() => parsePostingDate("Vorgestern, 10:00")).toThrow(ParseError);
    expect(() => parsePostingDate("")).toThrow(ParseError);
  });
});
