# Maintenance

For a maintainer standing in a clone. Nothing here applies to an installed user — the shipped binary takes no arguments and cannot check itself ([SPEC](../SPEC.md) §8.3, §9.17).

> **Status.** This is the specified procedure, settled on the packaging map. **The drift check is on disk** — `scripts/check-drift.ts`, 19 requests, the exit codes as tabled — and so are **the PR checks and the monthly cron**, at `.github/workflows/pr-checks.yml` and `.github/workflows/dataset-drift.yml`. What is still specification rather than disk is **the release**: everything from *Releasing* onwards, including the release gate, lands through the release-automation ticket.

## The drift check

The two bundled datasets are build-time snapshots. When the site's taxonomy or its location tree moves, the snapshots stop matching — *Dataset drift*, in `CONTEXT.md`'s terms. The check is the only thing that notices.

```bash
npm run check:drift             # → node scripts/check-drift.ts
npm run check:drift -- --json   # …and the same per-dataset report on stdout, as JSON
```

`--json` changes nothing else: the human report still goes to stderr and the exit code is unchanged. It exists because the cron decides from the report, and the alternative — a workflow matching on prose — would make the wording of a log line load-bearing.

**19 requests**, serialised at 1500 ms, about 28 seconds:

| leg | requests | catches |
| --- | --- | --- |
| `sitemap_categories.xml` | 1 | category ids added or removed |
| `sitemap_cities.xml` | 1 | location ids added or removed |
| `/s-katalog-orte.html` root + 16 states | 17 | the above, **plus renames** |

The katalog walk is not optional and the cheap id-only variant was refused: the cities sitemap carries ids and no names, so without it a renamed locality is invisible. It is cheap in requests and not in bytes — one state page is 583 KB, the root 137 KB, so a full run is multi-megabyte. Fine monthly; do not put it on a per-PR job.

It does **not** route through the server's rate limiter. `KLEINANZEIGEN_MCP_RATE_LIMIT_MS` is an operator's knob for their own machine and must never retune a maintenance job.

### Exit codes

| code | means | cron does | release does |
| --- | --- | --- | --- |
| `0` | both datasets match the site | nothing | proceeds |
| `1` | real drift | opens or updates one tracking issue | **blocks** |
| `2` | the check never reached the site | logs only, no issue, and goes **red** | **blocks** |
| `64` | usage error — the check never ran | fails the run | **blocks** |

`64` is not a fourth outcome. The three above are what a run can *conclude*; `64` says an argument was refused and no run happened, which is why it sits outside the ordering rather than on top of it.

**`2` outranks `1` outranks `0`.** A check that never reached the site has learnt nothing, and an issue claiming drift would be a lie — hence log-only on `2`.

**Read the report, not the exit code.** The stderr report names each dataset's outcome separately, and issue-opening is driven by the report. A dataset at `1` opens an issue even when the other dataset's outage pushed the process exit to `2`; real drift is never swallowed by the other half's failure.

**A green status is not a green check.** A block from the site presents as HTTP 200 with an empty result list ([ADR-0003](./adr/0003-non-circumvention.md)), so every leg counts a parse marker — `<loc>…/c<id>` on the sitemaps, `locationId=` on the katalog pages — and fails a 200 that carries none.

### There is no override

The release gate blocks on `1` and on `2`, and there is no flag, no environment variable and no input that skips it. That is deliberate and it is load-bearing: it is the only reason *the version is the provenance* is true. If no release can ship without establishing dataset currency, the publish date **is** the dataset-current date — which is why neither dataset carries a `generated_at` stamp. Weaken the gate and that claim goes with it.

If the site is unreachable, the release waits. It does not ship stale, and it does not ship unverified.

npm provenance does not make this redundant. The attestation says where the code came from; the gate says the data was checked on the way out. They are different claims and the second one is only true while the gate has no override.

### When the check reports drift

```bash
npm run generate:category-tree     # rewrites data/category-tree.json
npm run generate:cities            # rewrites data/cities.json
npm run check:drift                # confirm 0
npm test
```

Commit by what changed, because `semantic-release` reads it:

| change | commit | bump |
| --- | --- | --- |
| additions / churn | `fix(data): …` | patch |
| a category or locality **renamed or removed** | `feat(data): …` | minor |

The minor on a removal is not bookkeeping: after a removal, an argument that resolved against the previous version stops resolving.

### The monthly cron

`.github/workflows/dataset-drift.yml` runs the same check against the repository's `data/` on the 1st of each month, and on demand via `workflow_dispatch`, so the cron and the release gate share one code path and one meaning of "checked". Users' staleness is inferred rather than measured: **they are stale iff a release is overdue.**

It reads the report, not the exit code. `npm run check:drift -- --json` hands the per-dataset report to `scripts/drift-issue.ts`, which composes the tracking issue — or decides there is none to open — and the workflow then creates it, or edits the existing one. One issue: drift that persists across months is one condition, not one per month.

**The existing one is found by a marker in its body**, `<!-- kleinanzeigen-mcp:dataset-drift -->`, not by its title: the title is the part a maintainer edits while triaging, and a retitled issue must not come back as a second one. Only open issues are searched, so **closing the tracking issue while drift persists starts a fresh one next month** — closing it is a decision that the condition is over, and if it is not, the cron says so again.

**A scheduled workflow stops on its own after 60 days without a commit.** GitHub disables it and emails the maintainer; re-enable it from the Actions tab. On a monthly check in a quiet repository this is the likeliest way the cron goes silent, and a silent cron is not a clean one.

**The run goes red on an outage and stays green on drift.** Drift is signalled by the issue, and a red monthly cron meaning two different things is a status nobody reads. A run with nothing but `unavailable` opens no issue — a check that never reached the site has learnt nothing — and fails instead, which is the whole point of the paragraph below.

Where drift and an outage co-occur the run stays green, because the issue is the signal and it says the picture is partial. That would leave the monitor blind in exactly the mixed case, so **every `2` also raises a `::warning::` annotation**, whether or not it reddens the run.

A GitHub Actions runner is served by the site — verified on three distinct Azure IPs across both gateway routes the check touches, HTTP 200 with no interstitial and no `Retry-After`. What is *not* established is durability: three runs inside three minutes, and Azure ranges are what a future tightening would target. **The cron's own exit status is the monitor for that.** A check that starts failing on the network leg rather than on real drift is the signal that this answer expired. ADR-0003 forbids the obvious workaround — a self-hosted runner is not the fallback, and neither is anything else that routes around a block.

## Releasing

One `workflow_dispatch`, four channels, one version. Full reasoning: [ADR-0005](./adr/0005-four-channels-one-artifact.md); the contract: [SPEC](../SPEC.md) §8.7.

```
workflow_dispatch
  ├─ drift gate — npm run check:drift, blocks on 1 and 2
  ├─ semantic-release → npm + git tag + GitHub release + CHANGELOG.md
  ├─ mcpb pack (staging dir) → attached to the release
  └─ mcp-publisher publish (server.json, version stamped from the release)
```

**It is never triggered by a push to `main`.** With a no-override, network-dependent gate, automatic-on-merge releasing turns `main` red in any month the site is unreachable, and a red `main` nobody can act on is a gate everybody learns to ignore.

The publish step authenticates over **OIDC**, not with a token: the job carries `permissions: id-token: write`, runs npm CLI **≥ 11.5.1**, and gets **provenance by default** — no `--provenance` flag, and no `NPM_TOKEN` anywhere in the workflow or the repository's secrets.

`semantic-release` commits back `package.json`, `package-lock.json`, `src/version.ts`, `manifest.json`, `CHANGELOG.md`, `plugin/.claude-plugin/plugin.json` and `plugin/.mcp.json`. The two plugin files are in that list because `.mcp.json` pins the exact version it ships against, and `manifest.json` because the MCPB manifest carries its own `version` field that nothing derives from `package.json`. It commits straight to `main`, which now carries a ruleset — pull request required, force-push and deletion blocked. **A pull-request-required rule refuses that push**, so the ruleset must name the identity the release job pushes as a bypass actor, scoped to it and to nothing else. If that cannot be scoped tightly enough, drop the pull-request rule rather than the other two: on a single-maintainer repository, force-push and deletion blocking are the halves actually protecting anything.

**Nothing propagates.** The MCP Registry never polls npm, so a release that skips its step leaves the listing advertising the previous version indefinitely. Publishing to npm is not publishing.

### The MCPB step

```bash
npm run build            # assembles build/mcpb/ — the staging directory
npm run pack:mcpb        # → build/kanzeigen-mcp-<version>.mcpb
```

Two things about it are not incidental, and both are pinned by `tests/mcpb.test.ts` rather than left to the procedure.

**The staging directory is the packaging rule.** `mcpb pack` honours neither `.gitignore` nor `package.json:files`, so `mcpb pack .` at the repo root would ship `src/`, `data/`, `scripts/` and the fixtures. `scripts/stage-mcpb.ts` holds the allowlist — six files, nothing else — and the build assembles it. A `.mcpbignore` would be a denylist that fails open, which is the shape of the packaging bug this project already had once.

**The artefact ships unsigned**, and `npm run pack:mcpb` is the whole of the step: there is no `mcpb sign`. `--self-signed` reports success and then fails its own `mcpb verify`, because verification checks the chain against the OS trust store, and it writes its key into `node_modules`, so the identity dies at the next install. The repository is public, so the *"Not signed"* warning is now shown to strangers rather than to the owner — the decision stands ([ADR-0005](./adr/0005-four-channels-one-artifact.md)), and buying a certificate is still nobody's decision.

Upload it to the release **before** the `mcp-publisher` step: the registry does a redirect-refusing `HEAD` on the asset URL, and a `packages[]` entry pointing at an asset that is not there yet fails.

### The MCP Registry step

`server.json` at the repository root is the submission, and it is committed **unstamped**: the version and the MCPB hash in it belong to a release, not to the working tree.

```bash
npm run stamp:server-json    # version ×3, the asset URL's tag, and the asset's real SHA-256
mcp-publisher validate       # brew install mcp-publisher
mcp-publisher login github   # device-code OAuth; `login github-oidc` in CI, no secret
mcp-publisher publish
```

The stamp is a script rather than the reference workflow's one line of `jq` because **three** values move per release, not one: `version` in three places, the release-asset URL that carries the `v<tag>`, and `fileSha256`. It reads the packed `.mcpb` from `build/` and **refuses to run if it is not there**, so the step cannot publish a hash of nothing.

**The hash is the one mistake nothing downstream catches.** The registry never verifies it — clients do — so a wrong hash publishes cleanly and then fails every install. That is why the committed placeholder is sixty-four zeros rather than a plausible value, and why `tests/registry.test.ts` fails if a real-looking hash is ever committed.

**`validate` cannot catch a forgotten stamp.** Sixty-four zeros is schema-valid, so `mcp-publisher validate` passes on the unstamped file exactly as it does on the stamped one. The release must *run* the stamp; validation is not the guard, and the workflow is the only place that can be.

`mcp-publisher login github-oidc` is the CI half of the login and needs `id-token: write`. That permission is **not** this step's alone any more — the npm publish in the same dispatch authenticates the same way — so it belongs at job level rather than being treated as a registry-specific quirk.

The asset URL the stamp builds carries `v<version>`, which is `semantic-release`'s default `tagFormat`. A release config that changes it points the registry at a tag that does not exist — and the failure is the registry's `HEAD`, not a test.

Ownership is proven by `mcp-publisher login github` (which grants `io.github.<login>/*`) plus `mcpName` in the **already published** npm version — the registry reads it out of `registry.npmjs.org/<pkg>/<version>`, so the npm publish has to have landed first. `repository.url` is documentation, not proof; nothing checks it against the authenticated identity.

**If the first publish 403s, it is the casing.** `io.github.IIxauII/kleinanzeigen` is inferred from the registry's source rather than documented, and `mcpName` is immutable in npm metadata — a correction costs a version bump (SPEC §8.7).

`mcp-publisher status --status <active|deprecated|deleted>` handles lifecycle afterwards; `deleted` hides the listing and preserves it.

**The registry is in preview.** A data reset means re-publishing from scratch, and the schema is dated — `server.json` pins `2025-12-11` rather than anything called latest, so the rules only move when someone moves them.

### Before the first release, once

1. **`vitest.config.ts` and the v2 SDK migration have landed.** Migrate first, publish once — there are no installed users yet, and MCPB has no update mechanism.
2. **`"license": "Unlicense"` and `"mcpName": "io.github.IIxauII/kleinanzeigen"` are in `package.json`.** npm version metadata is immutable: neither can be added or re-cased afterwards. `mcpName`'s casing is inferred from the registry's source rather than documented — the first publish attempt is where a 403 confirms it.

   **And `"name"` is `kanzeigen-mcp`, not `kleinanzeigen-mcp`.** The unclipped name is somebody else's package on npm (SPEC §8.3), so publishing under it 403s. Do not "fix" it back on the grounds that it matches the repository — the repository, the User-Agent and `serverInfo.name` keep the full name deliberately, and only the package is clipped.
3. **`.github/workflows/` exist** for PR checks and the dispatched release. PR checks and the drift cron have landed; the dispatched release has not.
4. **Trusted publishing is configured — which takes a placeholder publish first.** It is a per-package setting on npmjs.com and the settings page needs the package to exist, so the first artifact on npm cannot be the one CI publishes. In this order, from your own machine:

   ```bash
   npm publish                        # a stub 0.0.1 — license and mcpName already correct, they freeze here too
   # then: npmjs.com/package/kanzeigen-mcp/access
   #       → Trusted publisher → this repository + the release workflow
   npm deprecate kanzeigen-mcp@0.0.1 "bootstrap placeholder for trusted publishing — install the latest version"
   ```

   npm publishes whatever version `package.json` carries, so that publish means setting `package.json` and `src/version.ts` to `0.0.1`, publishing, and **reverting both without committing** — `semantic-release` owns the version from the dispatch onwards, and `v0.1.0` in step 5 must still be a tag that was never published.

   Nobody installs the placeholder: `npx -y kanzeigen-mcp` resolves `latest`, which is `0.2.0` from the moment the dispatch lands. **Do not unpublish it** — the deprecation is the record of how publishing got configured, and an unpublish leaves a hole in the version list that explains nothing.

   **No npm token goes into Actions secrets, then or ever.** A granular token was the previous answer, from when a private repository made provenance impossible; granular write tokens now expire (7 days by default, 90 at the outside), which turns a credential used a few times a year into a rotation chore that fails while a release is being cut. Expect the first dispatch to need a workaround anyway: `@semantic-release/npm`'s OIDC path has [`#1069`](https://github.com/semantic-release/npm/issues/1069) and [`#1023`](https://github.com/semantic-release/npm/issues/1023) open against it. The bootstrap above already takes the first publish out of CI's hands, which is the sharper half of that exposure.
5. **`git tag v0.1.0` on `main`.** With zero tags `semantic-release` reads *no previous release* and emits `1.0.0` — a stability promise this project cannot back. `v0.1.0` is simply true and was never published.
6. **Dispatch.** The first version on npm is `0.2.0`, because the v2 migration is a `feat:`.

### What the public repository turned on

The repository was private until shortly before the first release, and four things were switched off for as long as it was. All four work now, and none of them needed a workflow change — recorded here because half of the older notes in this repo were written against the other state:

- **npm provenance**, through trusted publishing, on every published version.
- **`repository`, `homepage`, `bugs` and the User-Agent's `+https://…` URL resolve.** They were never changed while they 404'd; see ADR-0005 for why the identify half of the User-Agent is the half the argument rests on either way.
- **The `.mcpb` attached to every release is downloadable.** It was built and attached throughout regardless — it costs one step and keeps the artefact provably in step with the npm tarball from the first release.
- **The plugin marketplace resolves for anyone**, not just its owner. `npx` already satisfied "installable in one command"; the plugin was, and stays, an extra channel.

Visibility also makes rulesets available — GitHub Free offers them on public repositories and not on private ones — hence the one on `main` above. Required status checks join it once the PR checks exist; a ruleset requiring a check nothing produces blocks every merge.

### MCPB, four traps

All four are the same trap wearing different clothes — something that was supposed to be in the zip, or beside the bundle, is not.

1. **Never `mcpb pack .` at the repository root.** It honours neither `.gitignore` nor `package.json:files` and will ship `src/`, `data/`, `scripts/` and the fixtures. Pack from a staging directory holding exactly `manifest.json`, `package.json`, `README.md`, `dist/index.js`, `dist/cities.json`, `dist/category-tree.json`. A staging directory is an allowlist; `.mcpbignore` is a denylist that fails open.
2. **`user_config.rate_limit_ms` must declare `default: 1500`.** Without it the host substitutes the literal `${user_config.rate_limit_ms}` into the environment and the server refuses to start — from the user's side, a clean install that silently dies. (A user who *clears* the field sends `""`, which the server reads as unset.)
3. **Ship unsigned.** `mcpb sign --self-signed` reports success and then fails its own `verify`, because verification checks the chain against the OS trust store. It also writes its key into the installed npm package directory, so the identity dies at the next `npm install`.
4. **The version lives in two files.** `manifest.json` and `package.json` both carry it; a stale manifest ships silently.

The registry does a redirect-refusing `HEAD` on the MCPB release-asset URL, so **the asset must be uploaded before the registry step runs**, and `fileSha256` is required. The registry never verifies that hash — clients do — so a wrong hash publishes cleanly and then fails every install.
