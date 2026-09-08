# kleinanzeigen-mcp

A read-only, robots-clean MCP server over [kleinanzeigen.de](https://www.kleinanzeigen.de), the German classifieds site. Six tools, three runtime dependencies, stdio, nothing on disk.

It reads the pages `robots.txt` allows, parses them into a typed domain model, and hands them to an MCP client. It does not log in, does not write, does not persist, and does not circumvent anything. **Read [the terms-of-service position](#the-terms-of-service-position) before you install it** — there is a real contradiction here and this project sits inside it rather than resolving it.

---

## What it does

| Tool | What it answers | Requests |
| --- | --- | --- |
| `search_listings` | One page of listings matching a search query. | 1 |
| `get_listing` | One listing in full, by ad id. | 1 |
| `get_shop` | Profile and listings for one commercial seller. | 1 |
| `find_category` | Category ids matching a name. | 0 — bundled dataset |
| `find_location` | Location ids matching a name. | 0 — bundled dataset |
| `find_shop` | Shop slugs for commercial sellers matching a name. | 1 |

The three resolvers always return **candidates**, never a selection, even on a single exact hit: category and location names collide, and `find_shop` matches a shop's profile prose as well as its name.

## What it does not do

- **No private sellers.** Their inventory pages are `Disallow`ed, so the server refuses them. Commercial sellers are ~5.9% of inventory, and this is the largest deliberate gap in the tool surface.
- **No writing.** No posting, no messaging, no watchlists, no saved searches, no account of any kind.
- **No persistence.** The only cache is in memory, for five minutes, and dies with the process.
- **No browser.** No Playwright, no headless Chrome, no stealth plugin, no proxy pool.
- **No background work.** Every request is caused by a tool call you made.

---

## Install

Run from a clone. There is no published package yet — see [Licence and publishing](#licence-and-publishing).

```bash
git clone git@github.com:IIxauII/kleinanzeigen-mcp.git
cd kleinanzeigen-mcp
npm install
npm run build
```

`npm install` runs no code of ours — there is no `postinstall` — and pulls in no native dependency, so no compiler is involved. `npm run build` produces a single-file ESM bundle at `dist/index.js` plus two sidecar datasets beside it.

Node **22 or newer** is required.

### MCP client configuration

Point your client at the built bundle by absolute path. The transport is stdio only: no port, no bind address, no listener.

```json
{
  "mcpServers": {
    "kleinanzeigen": {
      "command": "node",
      "args": ["/absolute/path/to/kleinanzeigen-mcp/dist/index.js"]
    }
  }
}
```

That block goes in your client's config file — `claude_desktop_config.json` for Claude Desktop, `.mcp.json` for Claude Code, the equivalent for anything else. Restart the client afterwards.

To verify by hand without a client:

```bash
node dist/index.js
```

It writes one `server_started` line to stderr and then waits on stdin. `stdout` belongs to the transport and carries nothing else, ever.

---

## Configuration — exactly one knob

**`KLEINANZEIGEN_MCP_RATE_LIMIT_MS`** — the minimum gap between requests, in milliseconds.

- **Unset means 1500 ms.**
- **There is no floor.** It is your machine, your IP and your risk. A project that ships the knob should be honest about who bears the consequence rather than performing a restraint it cannot enforce.
- **An invalid value refuses to start.** Anything that is not a non-negative finite integer kills the process before the transport opens, with a non-zero exit and the reason on stderr. There is **no silent fallback to 1500 ms**: an operator who set `5000` and got a typo-driven fallback would believe they were being polite while they were not.

```json
{
  "mcpServers": {
    "kleinanzeigen": {
      "command": "node",
      "args": ["/absolute/path/to/kleinanzeigen-mcp/dist/index.js"],
      "env": { "KLEINANZEIGEN_MCP_RATE_LIMIT_MS": "3000" }
    }
  }
}
```

There is no second knob. A default location was considered and rejected: it is a tool-argument default, not an environment setting, and putting it in the environment would make an identical tool call return different results on different machines — invisibly to the calling agent, and unreproducibly in a bug report.

### What is not configurable, and cannot be disabled

- **`Retry-After` is honoured exactly**, up to a 60 s cap, after which the call fails loudly rather than hanging.
- **The block circuit breaker.** A detected block trips it, and it is never retried through.
- **The User-Agent**, which names this project and links to it: `kleinanzeigen-mcp/<version> (+https://github.com/IIxauII/kleinanzeigen-mcp)`. The site operator has something to block.
- **The deleted-ad guard**, which refuses to report the browse page a deleted listing redirects to as if it were a listing.

**The delay is a politeness dial you own; these four are the project's compliance stance, fixed in code.** There is no flag that turns them off, and that is what makes the claims above verifiable rather than aspirational.

---

## Known limits

These are things you will hit. None of them is a bug.

1. **1 250 organic listings per query, maximum.** Against category totals near a million. On a broad query you are seeing a *window*, and the right response is to narrow — which is why `total` and `reachable` are reported separately. The ceiling costs **nothing on the long tail**, which is where assistant-driven search actually lives: `stefan zweig erstausgabe` in Books returns `1 - 2 von 2` — complete recall.
2. **Page 51 and beyond silently re-serve page 50.** Detected and reported as `clamped: true`, never as data.
3. **High-volume queries drift between pages.** About 4% duplicates over a 13-second sweep, worse over a lazy walk. Every duplicate is also a listing missed. **Dedupe on `ad_id`** and count distinct ids — never pages × 25.
4. **No sort by distance.** Disallowed in every spelling, with no query-string equivalent.
5. **No category attribute filters** — condition, mileage, m², rooms, sizes. Attributes are readable on `get_listing` and never filterable.
6. **The applied sort cannot be read back.** `sort: null` means "the site chose", and `c216` (Autos) silently ranks by mobile.de's own default.
7. **No private seller inventory.** Commercial sellers only, ~5.9% of inventory. This is a `robots.txt` decision, not a technical one.
8. **`find_shop` can return the wrong shop on an exact single hit**, because the directory matches profile prose. Never auto-select from it.
9. **A postcode is not an identifier.** `10115` is two disjoint locations; the site's free-text resolution picks one silently, and `location_resolution` in the search envelope is the only reason a caller can tell.
10. **The DOM is the contract, and it is not ours.** The anchors have been stable across five scrapers and five years, but a redesign breaks the parser. A loud `parse_failure` line on stderr is the tripwire.
11. **Three site-side label bugs are live today**, and more may exist. The mitigation is structural: read numbers, never labels.
12. **The `shippingCarrier` enum could widen without warning.** It is a server-side closed set, so a new carrier arrives as a 400 on a value we never send — invisible rather than breaking. The cheap standing check is the `Paketdienst` facet group on `/s-k0`, one allowed request.
13. **Umlaut folding in `find_shop` is uncharacterised.** `köln` returns 492 hits, `koln` returns 3. Your string is passed through untouched.
14. **Shop inventory totals do not reconcile.** One shop reports `18 Anzeigen online` on its page, 17 rows through the inventory RPC, and `71 Anzeigen gesamt` separately — three counts with no known authority. A **fourth** figure turned up while building `get_shop`: the shop directory's `liveAds` read `11` for a shop whose own `adsOnline` read `10` minutes later. One listing expiring in between would explain it, so it is recorded rather than claimed. `ads_online` is reported as the site states it and is never promised to equal the listings actually returned.
15. **How deep the shop RPC goes before clamping is unprobed.** `pageSize` is honoured to at least 100 and paging terminates cleanly past the end — but the largest shop sampled had 170 listings, so no analogue of the page-50 wall has been ruled out.
16. **No radius-free rural fallback beyond what the site gives.** `radius` covers this properly, but kleinanzeigen's own catchment is administrative containment: only 5 `Kr.` nodes exist in Bayern's 2 079 children.

---

## The terms-of-service position

This is deliberately not a comfort blanket.

**There is a genuine contradiction, and this project sits inside it rather than resolving it.**

**§ 5 Nr. 1 of the Nutzungsbedingungen** forbids *"Crawler, Spider, Scraper oder andere automatisierte Mechanismen"* without written consent. It is flat. There is **no personal-use carve-out**, it has been unchanged since before 2024, and it never mentions "API" — so an argument that it targets only bulk commercial extraction is an argument the text does not make.

**`robots.txt` says something different.** It carries **no TDM reservation**, and it explicitly `Allow: /`s GPTBot, OAI-SearchBot, ChatGPT-User and PerplexityBot on the same pages this server reads. `ClaudeBot` is not named and falls under `*`. § 44b(3) UrhG requires a text-and-data-mining reservation to be **machine-readable**, and whether prose ToS qualifies is unsettled — LG Hamburg's *LAION* decision said yes, in obiter, as the minority position, with a Sprungrevision permitted to the BGH.

**Choosing robots-clean does not resolve that contradiction. It picks the machine-readable side of it, knowingly.**

What the project does about it:

- **It reads the machine-readable channel literally and obeys it**, including where obeying costs real capability — the private Bestandsliste works, and is refused.
- **It never circumvents.** No stealth browser, no fingerprint spoofing, no proxy rotation, no header impersonation, no evading a block. The User-Agent names the project and links to it, so the site operator has something to block. German case law on automated access points here rather than at the ToS: BGH I ZR 224/12 holds that breaching an automated-access ban is **not by itself** a UWG violation, and locates the *Unlauterkeitsmoment* in technical **circumvention**. See [ADR-0003](./docs/adr/0003-non-circumvention.md).
- **It keeps volume at personal scale**, serialised at ~1.5 s per request, with no bursting, no background polling and no saved searches.
- **It persists nothing.** Reading is not extraction; persisting is. Under § 87b UrhG and CJEU C-304/07 / C-545/07, both permanent *and* temporary transfer count as extraction, and § 87c's private-use exception is **expressly unavailable for electronic databases** — so the in-memory, process-lifetime, parsed-object-only cache is a deliberate legal posture, not a performance choice. See [ADR-0002](./docs/adr/0002-nothing-on-disk-nothing-survives-the-process.md).
- **It is single-user and local.** The most on-point authority is favourable to exactly this shape: **BGH 22.06.2011 – I ZR 159/10 (*Automobil-Onlinebörse*)** concerned AUTOBINGOOO, desktop software that queried car marketplaces on a user's behalf and rendered results locally — structurally almost exactly a local MCP server. Held: each query takes only an insubstantial part; uses by separate users **do not aggregate** absent concerted action; and § 87b requires conduct *aimed at reconstituting* the database. *Paperboy* points the same way.

**What this is not.** It is not legal advice, it is not written consent, and it does not make § 5 Nr. 1 go away. A reader who concludes that the AGB forbid this tool is reading the AGB correctly. The position taken here is that the site publishes a machine-readable permission file, that this server obeys it to the letter, that it circumvents nothing, and that it operates at a volume and a persistence level the case law treats as insubstantial — and that if kleinanzeigen wants this stopped, the User-Agent gives them a name to block and one line in `robots.txt` would settle it.

**Use it on your own account, at your own risk, and don't point it at anything but your own machine.**

---

## Licence and publishing

**The licence is [The Unlicense](https://spdx.org/licenses/Unlicense.html)** — sole copyright holder Felix (IIxauII). § 29(1) UrhG voids the public-domain dedication for a German author, so what is actually in force is the licence's second half: a plain grant to copy, modify, publish, use, compile, sell and distribute. Nothing travels into a fork — no attribution, no NOTICE, no change-marking, no name clause. (The `LICENSE` file and `package.json`'s `license` field land with the packaging work; the choice itself is settled.)

That was chosen rather than settled for. **No OSI-approved licence can stop a fork from stripping the rate limiter, the circuit breaker and the honest User-Agent** — the Open Source Definition's § 6 forbids exactly that kind of restriction, and AGPL's network clause never fires for a binary you run on your own machine, so copyleft would have bought a fork's *source*, never its *behaviour*. Taking the parsers and deleting the guards is permitted under every licence that was on the table. The compliance stance above is this server's, and was never a claim over anyone else's. One consequence is worth naming: a fork that strips the guards and keeps the User-Agent gets **this** project identified and blocked, and nothing in the licence addresses that.

The licence does not reach what is not ours. The bundled category tree and city dataset are read off kleinanzeigen's own pages, and the § 87b UrhG database rights in that material are theirs either way.

**Publishing.** Nothing is on npm yet. The route is decided rather than open: **one maintainer-triggered dispatch, one version, four channels** — npm (`npx -y kleinanzeigen-mcp`), the MCP Registry, an MCPB for Claude Desktop, and a Claude Code plugin carrying the server and one skill — gated by the dataset drift check, so no release ships without first establishing that the bundled datasets still match the site.

npm publishing goes through **trusted publishing** over OIDC, which means **every published tarball carries npm provenance**: an attestation that it was built by this repository's release workflow, from this source, at a named commit. There is no npm token in this repository's CI secrets and there is not meant to be one. The bundle also ships unminified, so the four things that cannot be disabled are readable in `dist/index.js` and not only here.

Reasoning: [ADR-0005](./docs/adr/0005-four-channels-one-artifact.md). Procedure: [`docs/maintenance.md`](./docs/maintenance.md).

---

## Development

```bash
npm test           # the whole suite
npm run typecheck  # tsc --noEmit, which is the real typecheck
npm run build      # tsup, into dist/
```

Parser tests run against committed fixtures: hand-captured out of band by a dev-time script — never by the server — minimised to the DOM the parser actually reads, and redacted. The redaction rule is *everything personal or identifying in the captured markup*, including attributes the parser never reads: a pass aimed only at the fields the parser touches is how partner-ad ids and shop names once survived in tracking attributes. A test pins the rule.

The two bundled datasets are regenerated by a maintainer, never by the server:

```bash
npm run generate:category-tree   # 1 sitemap request + labels
npm run generate:cities          # the sitemap plus the location catalogue
```

Further reading: [`SPEC.md`](./SPEC.md) for the full contract, [`CONTEXT.md`](./CONTEXT.md) for the vocabulary every name in the codebase uses, and [`docs/adr/`](./docs/adr) for the decisions behind the posture.
