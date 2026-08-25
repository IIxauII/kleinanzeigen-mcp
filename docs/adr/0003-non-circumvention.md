# Non-circumvention: identify honestly, send less, never evade

**Status:** accepted

The server identifies itself truthfully, rate-limits itself to one request per ~1500 ms with no bursting, honours `Retry-After`, and stops when it is blocked. It uses no headless browser, no fingerprint spoofing, no proxy rotation, no header impersonation, and no third-party scraping service. **The rate-limit delay is the only knob; everything else in this list is fixed in code and cannot be turned off.**

## Why this needs an ADR

Because the technically obvious moves are all available and all rejected, and each rejection looks like a bug to someone optimising the server.

The site is defended by Akamai Bot Manager on both hosts (`_abck`, `bm_sz` cookies, `*.akamaiedge.net`), but the posture is far softer than that implies: no interstitial, no JS challenge, no CAPTCHA on a cold request. **Blocking is IP-reputation and volume driven, not request-shape driven.** The observed block is an *IP-range* ban (`IP-Bereich vorübergehend gesperrt`) that survives UA rotation and takes out everyone on the same address range.

That single fact decides the whole design. If blocking keyed on request shape, looking like a browser would buy something. It does not — so the only thing that actually reduces the chance of a block is **sending fewer requests**, which is free, honest and already required by the design.

And the legal reasoning points the same way. BGH I ZR 224/12 holds that breaching an automated-access ban is **not by itself** a UWG violation, and locates the *Unlauterkeitsmoment* in technical **circumvention**. So circumvention is not merely impolite here: it is the axis on which risk actually moves. Adding evasion would convert a defensible posture into the one thing the case law singles out.

## The User-Agent is fixed in code and deliberately not configurable

```
kleinanzeigen-mcp/<version> (+https://github.com/IIxauII/kleinanzeigen-mcp)
```

A full Chrome header set (`Sec-Fetch-*`, `sec-ch-ua`, as one existing scraper uses) was considered and refused. A **completely naked request with the default `curl/8.x` UA and no other headers already returns HTTP 200 with all listings** — so impersonation buys nothing measurable at one request per 1.5 seconds. It only trades away the project's clearest ethical signal, and the site operator's ability to identify and block this tool specifically.

It is **not** an environment variable, and that is a deliberate asymmetry with the rate limit below. The "operator's IP, operator's risk" argument justifies an unfloored delay; it does not extend here, because **the only real use for a configurable User-Agent is impersonation**, and shipping the knob is shipping spoofing as a feature.

## The rate limit is a politeness dial the operator owns

One global serialised limiter, shared by every tool because every request hits one host — per-tool budgets would let two tools stack up load the site experiences as a single client. Default gap 1500 ms. No bursting: a token bucket would give a multi-page sweep better first-result latency, and a burst is the exact shape volume-driven blocking notices. An adaptive limiter that tightens on success was rejected more firmly still, because **tightening is throttle-probing**.

`KLEINANZEIGEN_MCP_RATE_LIMIT_MS` overrides the default **with no floor**. It is the operator's machine, the operator's IP and the operator's risk, and a project that ships the knob should be honest about who bears the consequence rather than performing a restraint it cannot enforce. An invalid value **refuses to start** rather than falling back silently — an operator who set `5000` and got a typo-driven fallback to 1500 would believe they were being polite while they were not.

The 1500 ms figure is field folk wisdom, not a measurement. **No rate-limit probing was done, deliberately**: probing a throttle means triggering it on the operator's home IP.

## What cannot be disabled

These are the project's compliance stance rather than its tuning surface, and there is no flag that turns any of them off. That is what makes the README's claim verifiable rather than aspirational.

- **`Retry-After` is honoured exactly, up to a 60 s cap**, then the call fails loud. Beyond the cap, sleeping would be indistinguishable from a hang to an MCP client that has no way to learn why.
- **A block trips a circuit breaker.** Further requests are refused for a cooldown and the refusal says so. **A block is never retried.**
- **A block is never presented as an empty result list.** The observed failure mode is HTTP 200 with zero listings; reporting that as "no matches" would be the server quietly hammering a site that has already said stop. This is also what makes a genuine empty list safe to return as a real answer elsewhere in the surface.
- **The honest User-Agent**, above.
- **The deleted-listing guard**, which asserts the final URL still starts with `/s-anzeige/` — a correctness rule, but one that also stops the server from parsing a page the site redirected it away from.

## The shape of the thing is part of the argument

The server is single-user, local, spawned over stdio, and does no background work: no saved searches, no watching, no polling for new listings. Nothing runs unless a human's agent asked for it in that moment.

That matters because the most on-point authority turns on exactly this shape. BGH 22.06.2011 – I ZR 159/10 (*Automobil-Onlinebörse*) concerned desktop software that queried car marketplaces on a user's behalf and rendered results locally: each query takes only an insubstantial part, and uses by separate users **do not aggregate** absent concerted action. A hosted, multi-tenant, or polling version of this server would give that reasoning away — which is why all three are out of scope, and why they are out of scope *here* rather than merely unimplemented.
