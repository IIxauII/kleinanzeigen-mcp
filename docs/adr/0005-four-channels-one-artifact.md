# Four channels, one artifact

**Status:** accepted

kleinanzeigen-mcp is published to **npm** (the primary channel, installed as `npx -y kleinanzeigen-mcp`), listed in the **MCP Registry**, packed as an **MCPB** for Claude Desktop, and offered as a **Claude Code plugin** that bundles the server together with one skill. All four serve the same `dist/index.js` from the same release, cut by **one maintainer-triggered workflow dispatch**, gated by the dataset drift check.

The repository is **public**. The package therefore carries **npm provenance**, published over OIDC by **trusted publishing**, and **no npm token exists anywhere in Actions secrets**.

**This ADR was first written the other way round, and is amended in place rather than superseded.** Every channel here was chosen, and every trade-off accepted, while the repository was private and provenance was impossible. Visibility then flipped before a single build ticket ran, which turns four switched-off things on and replaces the publish credential outright — but it does not change the shape, and the shape is the decision. Keeping the private-first reasoning legible is deliberate: a reader who finds one dispatch, one artifact and a no-override drift gate should be able to see that they were reasoned out under a constraint that no longer applies, and that they survived its removal rather than being built for it.

## Why this needs an ADR

Three things here are hard to reverse, and one of them runs in the wrong direction.

**Two `package.json` fields are immutable the moment the first version publishes.** `"license": "Unlicense"` and `"mcpName": "io.github.IIxauII/kleinanzeigen"` cannot be added, corrected or re-cased afterwards — npm version metadata is frozen, so a mistake costs a version bump rather than a commit. `mcpName` is the string the MCP Registry reads out of npm to prove the package belongs to the authenticated namespace, and its casing is *inferred from the registry's source*, not documented: `io.github.%s/*` is formatted from the GitHub login verbatim, with no case folding anywhere in the matching path. `IIxauII` is therefore load-bearing, and the first publish attempt is where it gets confirmed against a real 403.

**Publishing claims a name.** `kleinanzeigen-mcp` on npm and `io.github.IIxauII/kleinanzeigen` in the registry are permanent identities for a tool that reads a site whose terms of service, on the site's own reading, forbid it (§12). That is a deliberate act of standing behind the position rather than a packaging step.

**And the publish credential cannot be configured until after the first publish.** Trusted publishing is a per-package setting on npmjs.com, and the settings page does not exist for a package that does not exist. Every other sequencing constraint on this project points backwards — get it right *before* the first publish, or pay a version bump. This one points forwards, and its resolution is a version on npm that nobody is meant to install. That deserves its own section.

## No token, and the placeholder that buys it

**A granular npm token was the earlier decision, and two facts retired it.** It was chosen because trusted publishing's headline benefit — provenance — was exactly the thing a private source repository could not have, which left OIDC's setup cost buying nothing. Since then: granular write tokens **expire, 7 days by default and 90 days at the outside**, which turns a credential in Actions secrets into a standing quarterly chore on a project that dispatches a release a handful of times a year — so the token is expired more often than it is valid, and it fails at the moment a release is being cut, which is the worst available moment to discover a credential problem. And **trusted publishing emits provenance by default**: there is no `--provenance` flag to remember and none to lose in a later workflow edit.

So: **no npm token ever enters Actions secrets.** On our side the whole of the setup is `id-token: write` on the publish job and npm CLI **≥ 11.5.1**; the rest lives in the package's *Access* settings on npmjs.com.

**The bootstrap is a hand-published `0.0.1`, deprecated on arrival.** In order:

1. `npm publish` a stub `0.0.1` from a maintainer's machine — with `"license"` and `"mcpName"` already correct, because it is a real publish and the immutable fields freeze on it too.
2. Configure trusted publishing at `npmjs.com/package/kleinanzeigen-mcp/access`, pointing at this repository and the release workflow.
3. `npm deprecate kleinanzeigen-mcp@0.0.1` with a message that says what it is.
4. Dispatch the release. CI publishes **`0.2.0`, with provenance**, and `latest` moves to it.

Nobody installs the placeholder: `npx -y kleinanzeigen-mcp` resolves `latest`, which is `0.2.0` from the moment the real release lands, and the deprecation warning explains the one on the shelf behind it.

The alternatives, and why each is worse:

- **Hand-publish `0.2.0` and wire OIDC afterwards.** It makes the first real release — the version an early reader actually inspects, and the one an MCPB user is stuck with until they go and download a file again — the only release with no provenance. It also puts an `npm publish` of the shipping artifact on a laptop, which is the thing the release workflow exists to prevent.
- **Keep a granular token as a break-glass fallback.** A fallback credential is a credential: it sits in secrets, it expires exactly like the primary would have, and the release that reaches for it is by definition a release nobody is watching closely. Removing the token is the decision; a second path back to it is the decision not taken.
- **Unpublish the placeholder rather than deprecating it.** npm's unpublish window is narrow, and what it leaves behind is a version number that can never be reused and reads, to anyone auditing the version list, as something withdrawn. A deprecation says precisely what happened, permanently, in the place a reader is already looking.

**`@semantic-release/npm`'s OIDC support is young, and that is flagged rather than assumed away.** Two issues are open against it: [`#1069`](https://github.com/semantic-release/npm/issues/1069) (`ENONPMTOKEN` on an OIDC-only setup, where the plugin's verify step demands the token it is not supposed to need) and [`#1023`](https://github.com/semantic-release/npm/issues/1023) (a first publish from a maintenance branch). The placeholder bootstrap already routes around the sharper half — the first publish is not CI's problem — but the release job should be **expected** to need a workaround, and finding one is build work rather than evidence that this decision was wrong.

## The provenance hole, and what closing it does not change

`dist/` is gitignored and `tsup` bundles every dependency inline, so there is nothing in git to diff the shipped bundle against. While the repository was private that was the end of it — npm provenance is unavailable for private sources, retired by GitHub in July 2023, a design limitation rather than a configuration problem — and every claim this project makes (read-only, `robots.txt` honoured literally (ADR-0001), nothing on disk (ADR-0002), no circumvention and a fixed User-Agent (ADR-0003)) lived in source a user could not verify they had received. Provenance now attests that the tarball on npm was built by this workflow, from this repository, at a named commit.

Two things written as compensation for that hole stay, because neither was only that:

- **The bundle is not minified.** `dist/index.js` ships as 77 863 lines of readable JavaScript (§8.2). Provenance tells a reader that the artifact matches the source; it does not read the source for them, and the guards are the part worth reading.
- ***The version is the provenance*** — the drift gate's guarantee — is not absorbed either. It says the *data* is current; npm provenance says the *code* is what the source says. Both were wanted, only one was available, and the other arriving does not collapse them into one claim.

**One thing is retired.** The earlier decision that *the README says nothing extra about unverifiability* was an argument about a disclosure aimed at a reader with no way to act on it. The artifact is verifiable now, so that paragraph is not being withheld — it is simply untrue, and does not get written.

**The refusal to wait was right, it cost nothing, and it was overtaken.** The earlier form of this ADR refused to hold the release until the repository opened, on the grounds that it makes an unrelated decision — visibility, with its own audit of fixtures, datasets and issue history — a prerequisite for shipping. Visibility was then settled first anyway, before any build ticket ran, so no release ever waited on it. The audit that refusal named as the cost is also why this is worth recording rather than quietly deleting: **it found a real defect.** The committed fixtures were redacted across everything the parser reads, and carried partner-ad ids and shop names in attributes it does not — invisible to a private-repo review, permanent under a public one (§8.6). That is the thing "with its own audit" was pointing at, and it was not rhetorical.

Three consequences moved together with visibility, because they were one fact wearing three sets of clothes, and all three have flipped:

- publishing is OIDC rather than a token, above;
- the **MCPB attached to every release is downloadable by anyone**. It was built and attached throughout the private period regardless — the step costs nothing, it keeps the artefact provably in step with the npm tarball from the first release, and it exercises its four packing traps outside release pressure. That reasoning never depended on visibility, which is why nothing about the step changes now that people can use its output;
- the **plugin marketplace resolves for anyone**, not only for its owner, because a marketplace resolves a plugin from a source the user can clone (§8.8).

npm and the Registry were never affected either way: the package is public regardless, and the `io.github.IIxauII` namespace authenticates against the account rather than the repository.

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

That gate is also what makes *the version is the provenance* true: no release ships without establishing dataset currency, so the publish date **is** the dataset-current date, and neither dataset needs a `generated_at` stamp. It is a *different* guarantee from npm provenance rather than a weaker version of one — the attestation says where the code came from, the gate says the data was checked on the way out — and having the attestation is not a reason to let the gate relax.

## `main` gets a ruleset, which it could not have before

Branch protection and rulesets are unavailable on GitHub Free for a private repository and available for a public one, so this is a thing visibility bought rather than a thing anyone chose to skip. `main` takes one: **pull request required, force-push and deletion blocked.** It is cheap, and the branch it protects is the one `semantic-release` commits back to.

**Required status checks are deliberately left out of it for now.** The PR checks do not exist yet — they land with the CI ticket ([#57](https://github.com/IIxauII/kleinanzeigen-mcp/issues/57)) — and a ruleset that requires a check no workflow produces blocks every merge, including the merge that would add the workflow. It goes in when there is something to require.

**And the release job has to be bypassed, which is the uncomfortable half.** `semantic-release` commits `package.json`, `src/version.ts`, `CHANGELOG.md` and the two plugin files straight to `main` (§8.7) — precisely the push a pull-request-required rule exists to refuse. The bypass is named for the identity that job pushes as and for nothing else. A rule with a hole in it is worth less than one without, and it is still worth more than no rule: the hole is one workflow on one dispatch, and what stays closed is the accidental force-push and the accidental deletion, which are the failures a single-maintainer repository actually suffers. If the bypass cannot be scoped that narrowly, the pull-request rule is the one to drop rather than the other two.

## Relation to the existing decisions

**[ADR-0002](./0002-nothing-on-disk-nothing-survives-the-process.md) is strengthened, not contradicted — but its text needed a correction.** A monthly cron in CI is a maintainer with a timer, not the server: nothing fetches on a tool call and nothing writes to disk at runtime. A startup drift check was never put to a decision, because it is both a request the user did not make and a violation of §7's lazy-first-use rule. What did become false is ADR-0002's own sentence placing the drift check among the things the server touches — the check now lives in `scripts/` and is not in the shipped binary at all. **That sentence is rewritten in place**; this ADR does not override it silently.

**[ADR-0003](./0003-non-circumvention.md) is not contradicted, and the half of it that was degraded works again.** The User-Agent does two jobs. The **identify** half — the `kleinanzeigen-mcp/<version>` token a site operator writes a block rule against — is what ADR-0003's non-circumvention argument actually rests on, and it worked throughout. The **explain** half, the `+https://…` URL, 404'd while the repository was private and now resolves, as do `repository`, `homepage` and `bugs`. The split stays written down even though both halves work, because it is what decides the answer if the URL ever stops resolving again: the non-circumvention argument does not rest on it, so a dead URL is never a reason to touch the token.

ADR-0003 was also never put to the test by the release infrastructure. A GitHub Actions runner **is** served: three runs on three distinct Azure IPs, HTTP 200 on both gateway routes the drift check touches, no interstitial and no `Retry-After`. There was no block to route around, and had there been one, ADR-0003 forbids the obvious workaround — a self-hosted runner is not the fallback.

**[ADR-0001](./0001-robots-clean-html-read-literally.md) is untouched.** Nothing here changes what the server reads.

**The licence does not get an ADR, and going public does not reopen it.** The Unlicense was chosen deliberately, knowing § 29(1) UrhG voids the public-domain dedication for a German author and leaves the licence standing on its plain grant, and knowing that **no OSI-approved licence can forbid a fork from stripping the rate limiter, the circuit breaker and the honest User-Agent** — OSD § 6 rules that out, and AGPL § 13 never fires for a local stdio binary. Copyleft would have bought source visibility, never behaviour. A public repository makes forking real, which moves the *probability* of the guard-strip and not one line of the analysis of it: Apache-2.0's NOTICE would still have bought visibility of a fork at best. The reasoning is carried by the README's *Licence and publishing* section, where a reader deciding whether to fork will actually look.

## What a reader will otherwise try to "fix"

**Do not add `dependencies` back.** The three are inlined by `noExternal: [/.*/]`; declaring them cost every `npx` cold start 110 packages and 33 MB for code already in the tarball. The cold-install verification test is what makes their absence safe — it drives a full MCP handshake against an installed tarball and proves the bundle resolves nothing at runtime. **Removing that test re-opens the question**, and the two decisions must move together.

**Do not switch the release to push-triggered.** See the gate above.

**Do not put an npm token in Actions secrets.** Not as a fallback, not to unblock a failing OIDC publish, and not "just for this release". The expiry makes it a chore that fails at release time, and the token path publishes without provenance unless somebody remembers a flag — which is two of the three reasons it was removed, arriving together.

**Do not unpublish `0.0.1`, and do not reuse the number.** The deprecation is the record of how trusted publishing got configured; an unpublish deletes that record and leaves a hole in the version list that says nothing.

**Do not self-sign the MCPB.** `mcpb sign --self-signed` reports success and then fails its own `verify`, because verification checks the chain against the OS trust store. It also writes its key into the installed npm package directory, so the identity dies at the next `npm install`. Unsigned with a warning is the honest state; a real certificate is a purchase and a separate decision.

**Do not add `privacy_policies` to the MCPB manifest.** There is no account, no identity, no telemetry and nothing retained past the process. The only thing that leaves the machine is the caller's search string, going to the site the tool exists to read. Declaring a policy would assert a data relationship that does not exist.

**Do not submit the plugin to `claude-plugins-community`.** One of the two reasons it was out of scope has evaporated — it needed a publicly cloneable source, and there is one now — and the conclusion does not move, because the other reason was always the load-bearing one. Submission vendors the plugin directory into their repository, so every change to the skill or to the pinned server version queues behind their review, and there is no self-hosted channel underneath to ship past it. The marketplace in this repository already installs in one command, on our own clock. A slower second copy of a channel we own is not reach.
