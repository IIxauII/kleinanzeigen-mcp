import { z } from "zod";
import { ParseError } from "../fetch/errors.ts";

/**
 * When a listing was published, at whichever of the site's **two precisions**
 * the surface it was read from renders (SPEC 3.2).
 *
 * The discriminant is mandatory: a search row gives `Heute, 20:08` and a detail
 * page gives `18.08.2026` for the same listing, and a bare ISO string would
 * claim the second one happened at midnight.
 */
export const PostingDateSchema = z.discriminatedUnion("precision", [
  z.object({ value: z.string(), precision: z.literal("minute") }),
  z.object({ value: z.string(), precision: z.literal("day") }),
]);

export type PostingDate = z.infer<typeof PostingDateSchema>;

/**
 * **Never the machine's local date.** At 00:30 Berlin the machine's UTC date is
 * still yesterday, and resolving `Heute` locally shifts every recent listing by
 * a day. Node 22 ships full ICU, so this costs no dependency (SPEC 3.2).
 */
const BERLIN = "Europe/Berlin";

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

type CalendarDate = { year: number; month: number; day: number };

/** The Berlin calendar date an instant falls on. */
function berlinDate(instant: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BERLIN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const field = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { year: field("year"), month: field("month"), day: field("day") };
}

/** Berlin's UTC offset **at that instant**, so a `Gestern` across a DST switch keeps its own. */
function berlinOffsetMinutes(instant: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: BERLIN, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(name ?? "");
  if (offset === null) return 0;
  const minutes = Number(offset[2]) * 60 + Number(offset[3]);
  return offset[1] === "-" ? -minutes : minutes;
}

/** Calendar arithmetic only — a pure date has no time to shift, so UTC is safe here. */
function theDayBefore({ year, month, day }: CalendarDate): CalendarDate {
  const previous = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return {
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  };
}

/**
 * A Berlin wall-clock reading as an offset-bearing ISO string.
 *
 * The offset is resolved twice: once from the naive instant and once from the
 * instant that first offset implies, which is what settles the hour on either
 * side of a DST switch.
 */
function berlinWallClock(date: CalendarDate, hour: number, minute: number): string {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = berlinOffsetMinutes(new Date(naive));
  const offset = berlinOffsetMinutes(new Date(naive - first * 60_000));
  const sign = offset < 0 ? "-" : "+";
  const magnitude = Math.abs(offset);
  return (
    `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}` +
    `T${pad(hour)}:${pad(minute)}:00` +
    `${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`
  );
}

const RELATIVE = /^(Heute|Gestern), (\d{1,2}):(\d{2})$/u;
const ABSOLUTE = /^(\d{2})\.(\d{2})\.(\d{4})$/u;

/**
 * The three spellings a search row renders: `Heute, HH:MM`, `Gestern, HH:MM`
 * and `DD.MM.YYYY`. The first two are minute-precise, the third is not.
 *
 * `now` is a seam, not a knob: the relative spellings resolve against the
 * **Berlin** calendar date, and a test needs to stand at 00:30 to prove it.
 */
export function parsePostingDate(rendered: string, now: Date = new Date()): PostingDate {
  const text = rendered.replace(/\s+/gu, " ").trim();

  const relative = RELATIVE.exec(text);
  if (relative !== null) {
    const today = berlinDate(now);
    const date = relative[1] === "Heute" ? today : theDayBefore(today);
    return {
      value: berlinWallClock(date, Number(relative[2]), Number(relative[3])),
      precision: "minute",
    };
  }

  const absolute = ABSOLUTE.exec(text);
  if (absolute !== null) {
    return { value: `${absolute[3]}-${absolute[2]}-${absolute[1]}`, precision: "day" };
  }

  throw new ParseError(`unreadable posting date ${JSON.stringify(text)}`);
}
