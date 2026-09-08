/**
 * The two annotation sets every tool picks from (SPEC 4.6).
 *
 * `readOnlyHint: true` is stated on all six and never left to the default,
 * which is `false` — silence on the wire would assert the opposite of the
 * whole project. `get_shop`'s `POST …brandProfile.getAds` does not complicate
 * that: the field asks whether the tool modifies its environment, and a POST
 * is a transport verb.
 *
 * `openWorldHint` is what splits the surface, and not on "does it touch the
 * network": it asks whether the reachable set is bounded and knowable in
 * advance. So a tool picks its set by **what it reads**, which is why these
 * are named for that rather than for the flag values.
 *
 * `destructiveHint` and `idempotentHint` are absent from both, deliberately.
 * The protocol makes them meaningful only when `readOnlyHint` is false, and
 * `idempotentHint: true` on a fetching tool would read as a claim about result
 * stability — exactly what the envelope's `stale` flag denies (SPEC 2.7, 9.3).
 * `descriptions.test.ts` asserts their absence, so re-adding one fails.
 */

/** A live site whose contents move underneath the caller. */
export const READS_LIVE_SITE = { readOnlyHint: true, openWorldHint: true } as const;

/** A snapshot frozen into the tarball at build time, read at zero requests (SPEC 4.4). */
export const READS_BUNDLED_DATASET = { readOnlyHint: true, openWorldHint: false } as const;
