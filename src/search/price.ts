import { z } from "zod";
import { ParseError } from "../fetch/errors.ts";

/**
 * A listing's price is one of four mutually exclusive shapes, and **never an
 * absent field** (SPEC 3.1).
 *
 * Two properties are the whole reason this is a union rather than
 * `{ amount?: number; type?: string }`:
 *
 * - **The amount is optional only on `Negotiable`.** A bare `VB` with no figure
 *   is structurally unconfusable with `Giveaway`.
 * - **`Unpriced` is an explicit variant.** Whole categories carry no price
 *   field by design; modelling that as absence makes "the site has no price
 *   here" indistinguishable from "we failed to parse one".
 */
export const PriceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Fixed"), amount: z.number() }),
  z.object({ kind: z.literal("Negotiable"), amount: z.number().optional() }),
  z.object({ kind: z.literal("Giveaway") }),
  z.object({ kind: z.literal("Unpriced") }),
]);

export type Price = z.infer<typeof PriceSchema>;

/** German grouping: `1.999`, `6.850`, and a `,` decimal if the site ever renders one. */
const AMOUNT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

function amount(text: string): number {
  const parts = AMOUNT.exec(text);
  if (parts === null) throw new ParseError(`unreadable price amount ${JSON.stringify(text)}`);
  return Number(`${parts[1]!.replaceAll(".", "")}.${parts[2] ?? "0"}`);
}

/**
 * The rendered price string on a search row, as one of the four shapes.
 *
 * An **empty** cell is `Unpriced` — the category has no price field — and a
 * bare `VB` is `Negotiable` with no amount. Anything else is a DOM change and
 * throws, because a price the parser cannot read must not arrive as one it
 * could (SPEC 5.8).
 */
export function parsePrice(rendered: string): Price {
  const text = rendered.replace(/\s+/gu, " ").trim();
  if (text === "") return { kind: "Unpriced" };
  if (text === "Zu verschenken") return { kind: "Giveaway" };
  if (text === "VB") return { kind: "Negotiable" };
  const negotiable = /^(.+) € VB$/u.exec(text);
  if (negotiable !== null) return { kind: "Negotiable", amount: amount(negotiable[1]!) };
  const fixed = /^(.+) €$/u.exec(text);
  if (fixed !== null) return { kind: "Fixed", amount: amount(fixed[1]!) };
  throw new ParseError(`unreadable price ${JSON.stringify(text)}`);
}
