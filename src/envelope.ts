import { z } from "zod";

/**
 * Why a fetch could not produce fresh data. The same five values name the
 * operational failures (SPEC 6.3) and the `stale_reason` of a stale serve
 * (SPEC 6.2) — one vocabulary, because the stale rule has no per-failure-type
 * policy.
 */
export const FAILURE_REASONS = ["block", "network", "timeout", "http_error", "parse_failure"] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Carried by every tool result, cached or not (SPEC 3.6). `fetched_at` is
 * uniform and never special-cased, so a caller can reason about recency
 * without knowing the cache exists — which is also why there is no
 * cache-bypass flag anywhere: the timestamp is the answer (SPEC 6.1).
 */
export type Envelope = {
  fetched_at: string;
  stale: boolean;
  stale_reason?: FailureReason;
  source_url: string | null;
};

/** The envelope as `registerTool` output-schema fields, spread into a result shape. */
export const ENVELOPE_OUTPUT_SHAPE = {
  fetched_at: z.iso.datetime(),
  stale: z.boolean(),
  stale_reason: z.enum(FAILURE_REASONS).optional(),
  source_url: z.string().nullable(),
};

/** The envelope of a result no request was made for: the zero-request resolvers (SPEC 4.4). */
export function localEnvelope(now: Date = new Date()): Envelope {
  return { fetched_at: now.toISOString(), stale: false, source_url: null };
}
