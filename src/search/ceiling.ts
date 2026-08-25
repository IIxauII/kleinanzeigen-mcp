/**
 * The ceiling a search query actually has, which is not the total it states
 * (SPEC 2.4).
 *
 * **25 organic listings per page × 50 pages = 1 250 organic listings per
 * query.** Measured, not assumed. TOP listings are extra and consume no result
 * slot, so a page reporting `51 - 75` can carry 27 rows.
 */
export const LISTINGS_PER_PAGE = 25;
export const LAST_HONEST_PAGE = 50;
export const REACHABLE = LISTINGS_PER_PAGE * LAST_HONEST_PAGE;
