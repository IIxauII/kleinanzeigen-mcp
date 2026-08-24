# Nothing on disk, ever. Nothing survives the process.

**Status:** accepted

The server writes **nothing** to disk at runtime — no cache, no log file, no dataset refresh, no captured HTML. The only thing it retains is an in-memory cache of **parsed domain objects**, keyed by normalised URL, fresh for 5 minutes, bounded at ~200 entries by LRU, which dies with the process. Raw HTML is discarded the moment parsing finishes.

Both sentences are phrased as claims a reader can verify against the code, which is the point of writing them this way.

## Why, and why it is a legal posture rather than a performance choice

**Reading is not extraction; persisting is.** Under § 87b UrhG and CJEU C-304/07 and C-545/07, both permanent **and temporary** transfer count as extraction of a database, and § 87c's private-use exception is **expressly unavailable for electronic databases**. An ephemeral fetch-and-render server therefore sits materially differently from a caching one, and the difference is not rhetorical.

Cutting the other way: caching *reduces* load on the site, which is what the AGB's *übermäßige Belastung* clause cares about, and it makes a ~1500 ms rate limit tolerable in an interactive tool. An agent re-reads the same listing several times in one conversation, and every avoided fetch is load the site does not carry.

The middle ground is the decision: retain as little as possible for as short as possible, and never produce an artefact that outlives the session. Rendering a page requires a RAM copy regardless, so the in-memory copy is not a new category of act — a file on disk is.

## The consequences a reader will otherwise try to "fix"

**Parsed objects, not HTML.** The retained set is what the caller asked for, not 25 listings plus tracking payload. Someone optimising for re-parse speed will be tempted to cache the HTML; that is the thing this decision forbids.

**LRU is the only eviction rule; there is no time ceiling.** An entry past 5 minutes is not evicted — it stops being *fresh* and becomes servable only under the stale rule. TTL here is a freshness marker, not a timer.

**On any fetch failure, a stale entry is served flagged; otherwise fail loud.** One rule, no per-failure-type policy: block, network failure, timeout, 5xx after retries **and parse failure** all take the same path.

⚠️ This has a sharp edge that must not be filed off: **because parse failures also fall back, a DOM change can be masked by stale data instead of surfacing.** The mitigation is load-bearing and is a hard requirement, not a nicety — **the stderr log must shout on a parse failure even when the stale serve succeeds.** That log line is the only signal that the parser broke.

**No cache-bypass flag and no clear-cache tool.** Every result carries `fetched_at`, and that timestamp is the answer. A bypass parameter is precisely what an agent in a retry loop sets on every call — turning the cache off and putting load back on the site exactly when things are already failing. It would also be useless: a stale entry is only ever returned *after* a fresh fetch has already failed, so bypassing it would simply fail again.

**Logging is stderr, metadata only.** URL, status, timing, counts, parse outcome, block detection, limiter waits — and **no listing content ever**. A log file is a persisted copy of listing data by another name, and keeping content out of it is what makes "writes nothing to disk" true rather than nominal. (`stdout` is reserved for the MCP stdio transport.)

**Images are URLs, never bytes.** The server never fetches image data: no copying of media, no rate-limit budget spent on it, no second fetch path to throttle. Inline MCP image content was considered and rejected — it buys a visual agent something and costs load, latency and a materially larger copying question.

**No query-scoped state.** This is why the page-50 clamp detector had to be stateless — page N's honest range starts at `(N − 1) × 25 + 1`, so a single page can be checked against itself — and why cross-page dedupe is the caller's job rather than the server's.

## The two things that touch the filesystem, and why they don't count

**The bundled category tree and city dataset** ship inside the package as build-time artefacts and are read lazily on first use. Static reference data shipped with the package is not persistence; listing data is, and none of that touches disk. The drift check **reads and reports; it writes nothing** — drift is fixed by shipping a new version, not by a runtime write.

**Test fixtures are committed** — which is the same § 87b question moved from runtime into source control, plus live personal data in a public repository under DSGVO. They are therefore **hand-captured out of band by a dev-time script (never by the server), minimised to the DOM the parser actually reads, and redacted** of seller names, exact locations, image URLs and free text.

The alternatives were each worse: verbatim capture republishes real ads and real personal data; gitignored-only means CI and new contributors cannot run parser tests; fully synthetic fixtures drift from the real DOM until the tests prove only that the parser parses the fixture.
