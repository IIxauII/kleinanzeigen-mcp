import { ParseError } from "../fetch/errors.ts";

/**
 * The five readings every shop decoder does, written once (SPEC 5.8).
 *
 * Both `_actions` endpoints answer in the same flattened encoding and are
 * decoded into ordinary values before anything here runs, so what is left is
 * the same job twice: assert the shape the site published, and **throw rather
 * than default** where it is not there. The helpers live beside the decoders
 * rather than inside one of them so the inventory RPC and the directory cannot
 * drift into different notions of how loud an absent field is.
 */

export const record = (value: unknown, what: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ParseError(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
};

export const list = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new ParseError(`${what} is not a list`);
  return value;
};

export const string = (source: Record<string, unknown>, key: string, what: string): string => {
  const value = source[key];
  if (typeof value !== "string" || value === "") throw new ParseError(`${what} has no ${key}`);
  return value;
};

export const integer = (source: Record<string, unknown>, key: string, what: string): number => {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ParseError(`${what} has no ${key}`);
  return value;
};

/** A field a surface may genuinely not have. `null`, never a stand-in. */
export const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
