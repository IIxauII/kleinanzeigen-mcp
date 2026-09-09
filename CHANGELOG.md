# 1.0.0 (2026-09-09)


### Bug Fixes

* a stale clean is a 2, not a 0 ([fa3eb95](https://github.com/IIxauII/kleinanzeigen-mcp/commit/fa3eb9520874dfff9d1d3c1b59422b9af4362d7b))
* close two holes the review found in the fetch core ([6212cf4](https://github.com/IIxauII/kleinanzeigen-mcp/commit/6212cf4f45e31e59189e6c2ea204dc34025c04c4))
* read an empty rate-limit value as unset ([7676ffa](https://github.com/IIxauII/kleinanzeigen-mcp/commit/7676ffa3c062a9a426fb38ea35c3c2f014d3ca76))
* read the row title off the site's unlinked heading ([999ac35](https://github.com/IIxauII/kleinanzeigen-mcp/commit/999ac35f9e8b615a8168a5699a5d32956534d438)), closes [#50](https://github.com/IIxauII/kleinanzeigen-mcp/issues/50)
* rename the npm distribution to kanzeigen-mcp ([0577eba](https://github.com/IIxauII/kleinanzeigen-mcp/commit/0577ebaab3c19bcda11fb803fdd0ac00fdc4c43a)), closes [#61](https://github.com/IIxauII/kleinanzeigen-mcp/issues/61) [#74](https://github.com/IIxauII/kleinanzeigen-mcp/issues/74)
* the review's findings across both axes ([ae2b2cb](https://github.com/IIxauII/kleinanzeigen-mcp/commit/ae2b2cba0cdb2b4c58aa6a90e1c8115c6564bcee))
* the review's findings across both axes ([c2b90ea](https://github.com/IIxauII/kleinanzeigen-mcp/commit/c2b90ea633c464bbbaf1133a6545465624156b8b))
* the review's findings across both axes ([50aa6f7](https://github.com/IIxauII/kleinanzeigen-mcp/commit/50aa6f702219ff104fcd98dc20ca4ef6375241cd))
* the review's findings across both axes ([82e7b8a](https://github.com/IIxauII/kleinanzeigen-mcp/commit/82e7b8a95c4184fa96888de071297b82985afd19))
* the review's findings, and a test that pins the descriptions ([71d5eaf](https://github.com/IIxauII/kleinanzeigen-mcp/commit/71d5eaf9f64ed23e3a0f650b11f8d2b2068c2b97))
* the review's findings, and drift in the glossary ([c379e45](https://github.com/IIxauII/kleinanzeigen-mcp/commit/c379e450418fa1f4600758bf37633e9690d6292d))
* the review's findings, and three parse failures that were silent ([54a4a23](https://github.com/IIxauII/kleinanzeigen-mcp/commit/54a4a2355223c64486b111ab2b729b5a349a85c2))
* the spec review's findings ([fc43f2c](https://github.com/IIxauII/kleinanzeigen-mcp/commit/fc43f2cd18bcdf220b2024993693f1b63d9a8b55))
* the standards review's findings ([fd5a8ea](https://github.com/IIxauII/kleinanzeigen-mcp/commit/fd5a8ea6c5649620fa679d7c53fab109dd142708))


### Features

* build on prepack, drop runtime deps, add LICENSE and metadata ([2f19a63](https://github.com/IIxauII/kleinanzeigen-mcp/commit/2f19a63df1247404b1d0d9848fc2dc2e184c0803)), closes [#56](https://github.com/IIxauII/kleinanzeigen-mcp/issues/56) [#55](https://github.com/IIxauII/kleinanzeigen-mcp/issues/55)
* declare titles and annotations on every tool and the server ([8d2fbf5](https://github.com/IIxauII/kleinanzeigen-mcp/commit/8d2fbf5a33c03f07cee1358efe054eb5eac06822)), closes [#53](https://github.com/IIxauII/kleinanzeigen-mcp/issues/53)
* find_location, over a city dataset with two sources ([54fd752](https://github.com/IIxauII/kleinanzeigen-mcp/commit/54fd75298a833088df425b0ebe9f5460e28a94bf))
* find_shop, the directory's candidates, never auto-selected ([64715d1](https://github.com/IIxauII/kleinanzeigen-mcp/commit/64715d1c67a3f13eb7514397a439d2eaab9e43c9))
* get_listing, one listing in full, with the deleted-ad guard ([a4eed79](https://github.com/IIxauII/kleinanzeigen-mcp/commit/a4eed79b9a3c9665594fd6033ef09d06c3456c4f))
* get_shop, the island and the RPC, with the unknown-slug guard ([baa5ba2](https://github.com/IIxauII/kleinanzeigen-mcp/commit/baa5ba2742c1eead2e1aec0ced8732922b1206ec))
* migrate to the stable MCP SDK (v2) ([39e72e3](https://github.com/IIxauII/kleinanzeigen-mcp/commit/39e72e39a0140b4629d85394ff55c50439951f0b))
* move the drift check out of the binary, and cover both datasets ([382c109](https://github.com/IIxauII/kleinanzeigen-mcp/commit/382c109d1cdd4ba42f28c4ce36c8570be0ad00c3)), closes [#54](https://github.com/IIxauII/kleinanzeigen-mcp/issues/54)
* open the repository, and close the hole the audit found ([e0a2719](https://github.com/IIxauII/kleinanzeigen-mcp/commit/e0a27196a36e6ac20c769520554b51de4b27c610)), closes [#48](https://github.com/IIxauII/kleinanzeigen-mcp/issues/48)
* pack an MCPB bundle from a staging directory ([9d207c2](https://github.com/IIxauII/kleinanzeigen-mcp/commit/9d207c2f7c149a729929740d34c46825a603218e)), closes [#58](https://github.com/IIxauII/kleinanzeigen-mcp/issues/58)
* refuse an argument the filter surface does not have ([91bf8dc](https://github.com/IIxauII/kleinanzeigen-mcp/commit/91bf8dc2698e7b5280e589d5fe7b31c922567290)), closes [#19](https://github.com/IIxauII/kleinanzeigen-mcp/issues/19) [#20](https://github.com/IIxauII/kleinanzeigen-mcp/issues/20)
* scaffold the server and ship find_category ([6aa266e](https://github.com/IIxauII/kleinanzeigen-mcp/commit/6aa266e9b4986f9d7ff7b8b05c663517ee9008de))
* search_listings, one page with the honest counts ([c367066](https://github.com/IIxauII/kleinanzeigen-mcp/commit/c3670661963f6cbba6debaeb2c53b0133e767b3c))
* server.json and the registry version stamp ([5da703b](https://github.com/IIxauII/kleinanzeigen-mcp/commit/5da703b2eab03134bfc0fa5454f2a46939d95edd))
* ship the Claude Code plugin, its marketplace and the skill ([74229db](https://github.com/IIxauII/kleinanzeigen-mcp/commit/74229db71e35d61fc1e37f2a9bc08b703ce5bcb5)), closes [#60](https://github.com/IIxauII/kleinanzeigen-mcp/issues/60)
* the drift check, the README, and the ship-it packaging ([5482fa9](https://github.com/IIxauII/kleinanzeigen-mcp/commit/5482fa979b02279d2541047bb17dd4fa469ceff6))
* the fetch core every network tool sits on ([d100952](https://github.com/IIxauII/kleinanzeigen-mcp/commit/d100952c5d2b05d0402f4a821bf0f5d29bda1b19)), closes [#17](https://github.com/IIxauII/kleinanzeigen-mcp/issues/17)
* the resolvers refuse an argument they do not have ([a5c93b1](https://github.com/IIxauII/kleinanzeigen-mcp/commit/a5c93b1105587b23fdeb9f9a559ba126cfc23013))
