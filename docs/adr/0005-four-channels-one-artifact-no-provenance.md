# Four channels, one artifact, and no provenance

**Status:** accepted

kleinanzeigen-mcp is published to **npm** (the primary channel, installed as `npx -y kleinanzeigen-mcp`), listed in the **MCP Registry**, packed as an **MCPB** for Claude Desktop, and offered as a **Claude Code plugin** that bundles the server together with one skill. All four serve the same `dist/index.js` from the same release, cut by **one maintainer-triggered workflow dispatch**, gated by the dataset drift check.

The repository stays **private**, so the published package carries **no npm provenance**, and nothing ties the installed 3.4 MB bundle to the source that makes every promise this project makes.

## Why this needs an ADR

Three things here are hard to reverse, and one of them is surprising enough that a reader will otherwise try to fix it.

**Two `package.json` fields are immutable the moment the first version publishes.** `"license": "Unlicense"` and `"mcpName": "io.github.IIxauII/kleinanzeigen"` cannot be added, corrected or re-cased afterwards — npm version metadata is frozen, so a mistake costs a version bump rather than a commit. `mcpName` is the string the MCP Registry reads out of npm to prove the package belongs to the authenticated namespace, and its casing is *inferred from the registry's source*, not documented: `io.github.%s/*` is formatted from the GitHub login verbatim, with no case folding anywhere in the matching path. `IIxauII` is therefore load-bearing, and the first publish attempt is where it gets confirmed against a real 403.

**Publishing claims a name.** `kleinanzeigen-mcp` on npm and `io.github.IIxauII/kleinanzeigen` in the registry are permanent identities for a tool that reads a site whose terms of service, on the site's own reading, forbid it (§12). That is a deliberate act of standing behind the position rather than a packaging step.

**And the artifact is unverifiable, on a project whose whole argument is verifiable restraint.** That deserves its own section.

## The provenance hole, stated without comfort

`dist/` is gitignored, `tsup` bundles every dependency inline, and the repository is private. So:

- there is nothing in git to diff the shipped bundle against;
- npm provenance is unavailable, because GitHub retired it for private source repositories in July 2023 — a design limitation, not a configuration problem;
- every claim this project makes — read-only, `robots.txt` honoured literally (ADR-0001), nothing on disk (ADR-0002), no circumvention and a fixed User-Agent (ADR-0003) — lives in source that a user cannot verify they received.

**The README says nothing extra about this**, and that is the decision rather than an oversight. A paragraph explaining that the artifact cannot be verified would be a disclosure aimed at a reader who has no way to act on it, sitting on a page whose §12 position is already the honest, uncomfortable part. The one thing that *is* true and does help is left as a property of the artifact rather than promoted into a claim: **the bundle is not minified**, so `dist/index.js` ships as 77 863 lines of readable JavaScript, and a user who wants to check the guards can read them. Minification is off partly for that reason (§8.2).

The alternative — hold the release until the repository opens — was refused. It makes an unrelated decision (visibility, with its own audit of fixtures, datasets and issue history) a prerequisite for shipping, and provenance switches on later with no workflow change and no re-publish.

Consequences that follow from the same fact, so they move together: publishing uses a **granular npm token** rather than OIDC, since trusted publishing's headline benefit is exactly the thing that is unavailable; the **MCPB is built and attached to every release although nobody outside can download it**, because the step costs nothing, keeps the artefact provably in step with the npm tarball from the first release, and exercises its four packing traps now rather than under release pressure; and the **plugin channel is owner-only**, since a marketplace resolves a plugin from a source the user can clone. npm and the Registry are unaffected — the package is public, and the namespace authenticates against the account rather than the repository.

## Why four channels rather than one

`npx` alone satisfies the goal — installable by a stranger in one command. The other three are not redundancy:

- **MCPB is the only way a Claude Desktop user installs this without hand-editing JSON.** `claude mcp` has no `.mcpb` path, so it is not a second route into Claude Code. The channels overlap far less than they look.
- **The MCP Registry is where an agent or a client goes looking**, and it costs one file and one CLI call. It is free, automated and unreviewed.
- **The Claude Code plugin exists for the skill, not for the server.** `claude mcp add kleinanzeigen -- npx -y kleinanzeigen-mcp` already installs the server in one line; what bundling buys is that the skill arrives *with* it. The skill carries the six things the tool descriptions cannot (§8.8) — resolver-first ordering, the null resolution on a colliding location, `total` against `reachable`, dedupe on ad id — and those are quiet failures, the kind a user never reports because the answer looked fine.

Each channel is a version that must be published separately: nothing propagates. That is the recurring cost, and it is why there is exactly one dispatch rather than four procedures.

## Migrate first, publish once

The v2 SDK migration lands **before** the first publish. The wire delta is zero — both SDK lines declare the same protocol version and this server advertises a byte-identical capability object either way — so this is not a compatibility argument. It is that a channel with no update mechanism (MCPB) and a registry that never re-reads npm both make "publish, then change the foundation" a decision every installed user is stuck with, and there are no installed users yet. Publishing v1 first buys nothing and spends the one moment where changing the SDK costs nobody anything.

## Maintainer-triggered, and why that is not laziness

The release fires on `workflow_dispatch`, never on a push to `main`. The drift check gates every release and **blocks on exit 1 and on exit 2 with no override** — including the case where the site was simply unreachable. Automatic-on-merge releasing plus a no-override, network-dependent gate means `main` goes red in any month the site does not answer, which trains everyone to ignore it. Maintainer-triggered keeps the gate absolute instead of making it negotiable.

That gate is also what makes *the version is the provenance* true, in the one sense this project can still offer: no release ships without establishing dataset currency, so the publish date **is** the dataset-current date, and neither dataset needs a `generated_at` stamp. It is a weaker guarantee than npm provenance and a different one — it says the *data* is current, not that the *code* is what the source says. Both were wanted; only one is available.

## Relation to the existing decisions

**[ADR-0002](./0002-nothing-on-disk-nothing-survives-the-process.md) is strengthened, not contradicted — but its text needed a correction.** A monthly cron in CI is a maintainer with a timer, not the server: nothing fetches on a tool call and nothing writes to disk at runtime. A startup drift check was never put to a decision, because it is both a request the user did not make and a violation of §7's lazy-first-use rule. What did become false is ADR-0002's own sentence placing the drift check among the things the server touches — the check now lives in `scripts/` and is not in the shipped binary at all. **That sentence is rewritten in place**; this ADR does not override it silently.

**[ADR-0003](./0003-non-circumvention.md) is not contradicted, and one half of it is degraded.** The User-Agent does two jobs. The **identify** half — the `kleinanzeigen-mcp/<version>` token a site operator writes a block rule against — is what ADR-0003's non-circumvention argument actually rests on, and it works exactly as before. The **explain** half, the `+https://…` URL, 404s while the repository is private. The URL stays anyway: it is not wrong, it is early, and changing it would mean editing `src/user-agent.ts`, its test, SPEC §8.5 and ADR-0003, then editing them all back. Recorded as a real cost rather than filed away.

ADR-0003 was also never put to the test by the release infrastructure. A GitHub Actions runner **is** served: three runs on three distinct Azure IPs, HTTP 200 on both gateway routes the drift check touches, no interstitial and no `Retry-After`. There was no block to route around, and had there been one, ADR-0003 forbids the obvious workaround — a self-hosted runner is not the fallback.

**[ADR-0001](./0001-robots-clean-html-read-literally.md) is untouched.** Nothing here changes what the server reads.

**The licence does not get an ADR.** The Unlicense was chosen deliberately, knowing § 29(1) UrhG voids the public-domain dedication for a German author and leaves the licence standing on its plain grant, and knowing that **no OSI-approved licence can forbid a fork from stripping the rate limiter, the circuit breaker and the honest User-Agent** — OSD § 6 rules that out, and AGPL § 13 never fires for a local stdio binary. Copyleft would have bought source visibility, never behaviour. That reasoning is carried by the README's *Licence and publishing* section, where a reader deciding whether to fork will actually look.

## What a reader will otherwise try to "fix"

**Do not add `dependencies` back.** The three are inlined by `noExternal: [/.*/]`; declaring them cost every `npx` cold start 110 packages and 33 MB for code already in the tarball. The cold-install verification test is what makes their absence safe — it drives a full MCP handshake against an installed tarball and proves the bundle resolves nothing at runtime. **Removing that test re-opens the question**, and the two decisions must move together.

**Do not switch the release to push-triggered.** See the gate above.

**Do not self-sign the MCPB.** `mcpb sign --self-signed` reports success and then fails its own `verify`, because verification checks the chain against the OS trust store. It also writes its key into the installed npm package directory, so the identity dies at the next `npm install`. Unsigned with a warning is the honest state; a real certificate is a purchase and a separate decision.

**Do not add `privacy_policies` to the MCPB manifest.** There is no account, no identity, no telemetry and nothing retained past the process. The only thing that leaves the machine is the caller's search string, going to the site the tool exists to read. Declaring a policy would assert a data relationship that does not exist.
