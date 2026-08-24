# Robots-clean HTML, read literally

**Status:** accepted

kleinanzeigen.de has a better machine-readable source than its website: `api.kleinanzeigen.de`, the mobile app's JSON API, answers a plain `curl` with a credential baked into the APK and returns typed fields, GPS coordinates, ISO timestamps, exact counts and **no page cap**. We do not use it, because `robots.txt` says `Disallow: /api`. We read the HTML site instead, restricted to URLs matched by no `Disallow` under `User-agent: *` — and we read that file **literally**: a URL the file does not match is a URL the file did not fence, regardless of what the surrounding rules appear to be reaching for.

## Why this is worth recording

Every expensive thing about this project follows from it: the 1 250-result ceiling, the silent page-50 clamp, the three-decoder parser, the drift between pages, the missing radius sort, the missing attribute filters, and a DOM contract we do not own. A future reader looking at 500 lines of cheerio selectors and a stateless clamp detector will reasonably ask why we did not spend an afternoon on the JSON API instead. This is the answer.

## The literal rule, and why it replaced the intent rule

The map started with an intent-flavoured rule: *take where `robots.txt` wrote no rule about the capability; refuse where a rule exists and only a spelling escaped it.* Under it we refused slugless pagination — `/*/seite:6*` requires a literal `/seite:6`, which `/s-seite:6/…` does not contain — on the grounds that 54 hand-written lines from `seite:6` to `seite:59` are not an oversight.

That rule collapsed when the commercial shop surface was surveyed. `POST /_actions/proPublicWeb.brandProfile.getAds/` is **also** unmatched by any rule, and taking it while refusing slugless pagination put unmatched-and-taken beside unmatched-and-refused with nothing principled between them. Applied honestly, the intent rule refuses the RPC too — `/api` and `/*.json` read as a rule about machine-readable endpoints — which would have cost the entire commercial seller capability.

So the rule became literal. **Unmatched by any `Disallow` means allowed.** Intent, resemblance and "they clearly meant to fence this" carry no weight.

Consequences of the switch, in both directions:

- The 5-page cap fell, and the ceiling rose from ≈130 to **1 250** organic listings per query.
- Three unmatched paths are taken deliberately: slugless `/s-seite:N/…` pagination, `…brandProfile.getAds`, and `…brandingIndex.searchBrandings`. None of `unternehmensseiten`, `verzeichnis`, `_actions`, `brandingIndex`, `searchBrandings`, `brandProfile` or `/pro/` appears anywhere in the file's 252 `*` rules.
- The `r{km}` radius question went moot rather than being won — `?radius=` covers radius entirely on any allowed URL, so nothing rode on the path spelling either way.
- Nothing else reopened. The refusals of `/api`, `/s-kategorie-baum.html` and `/s-suchanfrage.html` rest on rules the file actually wrote.

## The corollary, which is the harder half

**Where the file did write a rule, we obey it even when a working path exists.**

`/s-bestandsliste.html` — a private seller's inventory — is `Disallow`'d on line 53, and there is no query-string escape: `?userId=`, `?sellerId=`, `?storeId=`, `?shopId=` and `?brandName=` are all inert on allowed search URLs. So this was never a spelling question; the file fences the capability.

It is refused **despite being the cheapest path on the board**. It works: naked `curl`, HTTP 200, no auth, no cookies, no CSRF. It renders in the search-results markup we already parse, so it would have cost **zero new parser**. It paginates on `&pageNum=` at 25/page, unbounded, terminating cleanly. And it serves **commercial** sellers on the same numeric handle — meaning one refused path would have delivered the whole seller-inventory capability for both seller types.

What ships instead is commercial-only, via `/pro/<slug>` and the RPC, which covers **5.9%** of inventory. The larger half is knowingly given up. A reader who finds that asymmetry strange should read it as the price of the rule, not as an oversight.

## Why the query-string filters are taken, which is the contestable part

`robots.txt` fences the **path-segment spelling** of the filters — `/preis:`, `/sortierung:`, `/anbieter:`, `/anzeige:`, `versand:`, `paketdienst:`, `direktkaufen:`, and 33 `r{km}` forms — and this project uses the query-string spelling of the same capabilities instead: `?minPrice`, `?maxPrice`, `?radius`, `?locationStr`, `?keywords`, `?sortingField`, `?posterType`, `?adType`, `?shipping`, `?shippingCarrier`, `?buyNowEnabled`. All verified live, all matched by no `Disallow`.

**This is the map's single most contestable decision.** The argument for it is mechanical rather than charitable: nothing in the file gestures at query-string filtering, and the authors used query-string exclusions three separate times elsewhere in the same file (`utm_source`, `simcid`, `view=karte`). The mechanism was available to them and was not applied here. Read as a whole, the disallow list is SEO facet and crawl-budget control — it fences the URL shapes a crawler would enumerate, not the parameters a user's browser sends.

The alternative was measured, not imagined. The maximally-conservative posture — same user need, no query-string filters, five pages, then filter client-side — returns **87 loose results for five requests** against **25 exact ones for one request**, with no distances anywhere, five listings whose price cannot be filtered at all, and an unquantifiable slice of 4 251 matches never seen. That version is a worse product than the website, and it would not have been built.

## What this does not claim

It does not resolve the contradiction with § 5 Nr. 1 of the AGB, which forbids automated mechanisms flatly and with no personal-use carve-out. `robots.txt` carries no TDM reservation and explicitly `Allow: /`s GPTBot and PerplexityBot on these same pages; the two documents disagree, and choosing robots-clean picks the machine-readable side of that disagreement rather than dissolving it. See `SPEC.md` §12 and ADR-0003.
