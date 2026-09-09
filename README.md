# kleinanzeigen-mcp

A read-only, robots-clean MCP server over [kleinanzeigen.de](https://www.kleinanzeigen.de), the German classifieds site.

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

---

## Install

Node **22 or newer** is required. Four channels install the same build from the same release — they differ only in who does the fetching, and nothing propagates between them.

| Channel | Who it is for | Line |
| --- | --- | --- |
| **npm / npx** — primary | anyone with an MCP client | `npx -y kanzeigen-mcp` |
| **Claude Code** | one line, no JSON | `claude mcp add kleinanzeigen -- npx -y kanzeigen-mcp` |
| **Claude Desktop** | no JSON editing at all | download the `.mcpb` from a release and open it |
| **Claude Code plugin** | the server **and** the skill together | `/plugin marketplace add IIxauII/kleinanzeigen-mcp` |
| **run-from-clone** | development | [Development](#development) |

### npm / npx — any MCP client

**The package is `kanzeigen-mcp`.**

There is no install step and nothing to build. Point your client at `npx` and let it fetch the package on first run:

```json
{
  "mcpServers": {
    "kleinanzeigen": {
      "command": "npx",
      "args": ["-y", "kanzeigen-mcp"]
    }
  }
}
```

That block goes in your client's config file — `claude_desktop_config.json` for Claude Desktop, `.mcp.json` for Claude Code, the equivalent for anything else. Restart the client afterwards.

To verify by hand, without a client:

```bash
npx -y kanzeigen-mcp
```

### Claude Code

```bash
claude mcp add kleinanzeigen -- npx -y kanzeigen-mcp
```

**Any environment assignment goes before the `--`.** Everything after the `--` is the command Claude Code runs, so a variable placed there becomes an argument to `npx` rather than an environment variable:

```bash
claude mcp add kleinanzeigen -e KLEINANZEIGEN_MCP_RATE_LIMIT_MS=3000 -- npx -y kanzeigen-mcp
```

### Claude Desktop — the MCPB

Download `kanzeigen-mcp-<version>.mcpb` from [the latest release](https://github.com/IIxauII/kleinanzeigen-mcp/releases/latest) and open it. Claude Desktop installs it and offers the one knob below as a form field, so nothing here needs a config file.

Two things are worth knowing before you pick it. The bundle **ships unsigned**, so the install dialog warns — self-signing fails its own verification, and a real certificate is a purchase nobody has made. And the format has **no update mechanism**: an installed `.mcpb` is as current as the day it was downloaded, and nothing will ever prompt you.

### Claude Code plugin — the server and the skill

```
/plugin marketplace add IIxauII/kleinanzeigen-mcp
/plugin install kanzeigen@kanzeigen
```

---

## Configuration

**`KLEINANZEIGEN_MCP_RATE_LIMIT_MS`** — the minimum gap between requests, in milliseconds.

- **Unset means 1500 ms.**

```json
{
  "mcpServers": {
    "kleinanzeigen": {
      "command": "npx",
      "args": ["-y", "kanzeigen-mcp"],
      "env": { "KLEINANZEIGEN_MCP_RATE_LIMIT_MS": "3000" }
    }
  }
}
```

---

## Development

Run from a clone. This is the development path rather than an install channel — it is the only one that yields a tree the drift check and the fixture-capture scripts can run in.

```bash
git clone git@github.com:IIxauII/kleinanzeigen-mcp.git
cd kleinanzeigen-mcp
npm install
npm run build
```

`npm run build` produces a single-file ESM bundle at `dist/index.js` plus two sidecar datasets beside it. Point a client at it by absolute path:

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

```bash
npm test           # the whole suite
npm run typecheck  # tsc --noEmit, which is the real typecheck
npm run build      # tsup, into dist/
```

Parser tests run against committed fixtures: hand-captured out of band by a dev-time script — never by the server — minimised to the DOM the parser actually reads, and redacted. The redaction rule is *everything personal or identifying in the captured markup*, including attributes the parser never reads: a pass aimed only at the fields the parser touches is how partner-ad ids and shop names once survived in tracking attributes. A test pins the rule.

Maintainer procedure — regenerating the two bundled datasets, running the drift check, and cutting a release — lives in [`docs/maintenance.md`](./docs/maintenance.md), because it addresses someone standing in a clone rather than someone who installed this.

Further reading: [`SPEC.md`](./SPEC.md) for the full contract, [`CONTEXT.md`](./CONTEXT.md) for the vocabulary every name in the codebase uses, and [`docs/adr/`](./docs/adr) for the decisions behind the posture.
