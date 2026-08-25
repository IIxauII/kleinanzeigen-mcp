import { ParseError } from "../fetch/errors.ts";

/**
 * **The third of the three decoders** (SPEC 5.1).
 *
 * The shop paging RPC answers in a *different* encoding from the island props
 * it is meant to continue: an index/reference table, where the payload is a
 * flat array, every value is addressed by its position in it, and position `0`
 * is the root. Repeated strings — every row's `location`, every row's `date` —
 * are stored once and referenced, which is why a 25-row page arrives in 18 kB.
 *
 * Two encodings for one surface is the thing to keep in view: the island
 * decoder cannot read this and this cannot read the island. Neither is the
 * HTML parser. Collapsing them would mean one decoder that guesses which it is
 * looking at.
 *
 * The references form a graph rather than a tree — a value may be pointed at
 * from several places, and may point back — so decoded values are memoised by
 * index. That is not an optimisation: it is what terminates on a cycle.
 */

/** The six negative indices that address a value rather than a slot. */
const UNDEFINED = -1;
const HOLE = -2;
const NOT_A_NUMBER = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

/**
 * The flattened payload as an ordinary value.
 *
 * A **string** in first position marks one of the encoding's tagged types —
 * `Date`, `Map`, `Set`, and the rest. None appears in either shop RPC, and one
 * that started to is a loud failure rather than a value read as the array it
 * is spelled as (SPEC 5.8).
 */
export function decodeFlattened(payload: unknown): unknown {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ParseError("the RPC payload is not a flattened array");
  }
  const values = payload as unknown[];
  const decoded = new Map<number, unknown>();

  const at = (index: unknown): unknown => {
    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new ParseError(`the RPC payload holds ${JSON.stringify(index)} where an index belongs`);
    }
    if (index === UNDEFINED) return undefined;
    if (index === NOT_A_NUMBER) return Number.NaN;
    if (index === POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    if (index === NEGATIVE_INFINITY) return Number.NEGATIVE_INFINITY;
    if (index === NEGATIVE_ZERO) return -0;
    if (index < 0 || index >= values.length) {
      throw new ParseError(`the RPC payload references index ${index}, which it does not have`);
    }
    if (decoded.has(index)) return decoded.get(index);

    const value = values[index];
    if (value === null || typeof value !== "object") {
      decoded.set(index, value);
      return value;
    }
    if (Array.isArray(value)) {
      if (typeof value[0] === "string") {
        throw new ParseError(`the RPC payload carries an unsupported ${value[0]} value`);
      }
      const list: unknown[] = new Array(value.length);
      // Registered before its elements are read, so a self-reference lands on
      // the array being built rather than recursing forever.
      decoded.set(index, list);
      for (const [slot, reference] of value.entries()) {
        // A hole is a slot the source array never had, not a slot holding
        // `undefined`; leaving it unwritten is the difference.
        if (reference === HOLE) continue;
        list[slot] = at(reference);
      }
      return list;
    }
    const object: Record<string, unknown> = {};
    decoded.set(index, object);
    for (const [key, reference] of Object.entries(value)) object[key] = at(reference);
    return object;
  };

  return at(0);
}
