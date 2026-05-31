# cityparity MCP server

Cost-of-living and quality-of-life comparison tools that AI agents can call. Point an agent at two cities and it returns take-home pay, a full cost breakdown, the equivalent salary you'd need in the target city, and the non-cash deltas people actually move for — vacation, parental leave, universal healthcare.

Hosted at **`https://mcp.cityparity.com/mcp`**. Free, no API key, rate-limited at the edge. Built on the [Model Context Protocol](https://modelcontextprotocol.io/) (spec `2025-06-18`, Streamable HTTP).

- Site: <https://cityparity.com>
- Install docs (every client): <https://cityparity.com/mcp>
- Machine-readable docs: <https://mcp.cityparity.com/llms.txt>
- OpenAPI (REST mirror): <https://mcp.cityparity.com/openapi.json>

## What it covers

About 165 cities across 69 countries. Most calculators stop at salary and rent. cityparity prices the social safety net — childcare subsidies, parental leave, statutory vacation, universal healthcare — so "the lower-salary city actually pays more" stops being a hand-wave and becomes a number.

## Tools

| Tool | What it does |
|------|--------------|
| `compare_cities` | Full scenario comparison between two cities: take-home, cost breakdown, equivalent target salary, lifestyle deltas, quality score. |
| `list_cities` | Discover supported city slugs, grouped by country. |
| `get_city_summary` | One-city profile: tax shape, headline costs, safety-net values. |
| `rank_cities` | Top N cities by composite quality score, with custom weights and region/country filters. |
| `get_safety_net` | Parental leave, universal-healthcare flag, vacation, public holidays for 1–20 cities. |
| `get_inbound_tax_regime` | Inbound-worker regimes: Italy impatriati, Portugal IFICI, Belgium expat, Poland B2B ryczałt, Greece inbound. |

City slugs are kebab-case (`san-francisco`, `hong-kong`). Call `list_cities` first if you're unsure.

## Connect

Most modern clients speak Streamable HTTP and need no install — just point them at the URL.

### Claude Code

```bash
claude mcp add --transport http cityparity https://mcp.cityparity.com/mcp
```

### Claude Desktop / ChatGPT Desktop

```json
{
  "mcpServers": {
    "cityparity": {
      "url": "https://mcp.cityparity.com/mcp"
    }
  }
}
```

Claude Desktop config lives at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). ChatGPT Desktop uses `…/OpenAI/ChatGPT/mcp.json`. Restart the app after editing.

### Cursor

```json
{
  "name": "cityparity",
  "url": "https://mcp.cityparity.com/mcp"
}
```

### Codex CLI

```yaml
mcpServers:
  cityparity:
    url: https://mcp.cityparity.com/mcp
```

### Stdio-only clients (this package)

If your client can't do HTTP MCP yet, the npm package in this repo bridges stdio → HTTP:

```json
{
  "mcpServers": {
    "cityparity": {
      "command": "npx",
      "args": ["-y", "cityparity-mcp"]
    }
  }
}
```

## The bridge (this package)

`cityparity-mcp` is a ~150-line stdio→HTTP forwarder. It reads line-delimited JSON-RPC from stdin, POSTs each line to the MCP endpoint, and writes the responses back to stdout (streaming SSE line by line). That's the whole job — no data, no calc engine, no secrets. Read [`bin/cityparity-mcp.mjs`](bin/cityparity-mcp.mjs) if you want to verify.

```bash
npm install -g cityparity-mcp   # or use npx, as above
```

| Env var | Default | Purpose |
|---------|---------|---------|
| `CITYPARITY_MCP_URL` | `https://mcp.cityparity.com/mcp` | Override the upstream endpoint (local dev) |
| `CITYPARITY_MCP_DEBUG` | unset | Log request/response framing to stderr |

Run the tests (zero dependencies, Node ≥ 20):

```bash
npm test
```

## Methodology

The full methodology — how taxes, costs, childcare subsidies, and safety-net scoring work — is on the [homepage](https://cityparity.com/#methodology). One thing worth flagging: **RSU income is not an input.** Grants are treated as source-only because they usually don't follow you across employers. If you're keeping a US employer remotely, treat the result as directional in that direction.

## Privacy

Queries reach `mcp.cityparity.com` and nothing else. No accounts, no client-side telemetry, nothing personally identifiable logged beyond standard HTTP server logs.

## License

MIT. cityparity's underlying data and calculation engine are not part of this package — this repo is the public MCP surface plus the open-source stdio bridge.

---

Found a bug or want a city added? <https://cityparity.com/contact/>
