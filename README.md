# 🔓 Give Claude a Wallet — AgentClear MCP Server

**Stop manually installing dozens of MCP servers** for weather, search, finance, and AI APIs. Install one server, get access to **60+ services** through a single API key with sub-cent micropayments. Your Claude can now autonomously discover and pay for any API it needs.

[![npm version](https://img.shields.io/npm/v/agentclear-mcp-server.svg)](https://www.npmjs.com/package/agentclear-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Quick Start

**1. Get your API key** (includes a free $5 grant):

```
https://agentclear.dev/signup
```

**2. Add to your Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "agentclear": {
      "command": "npx",
      "args": ["-y", "agentclear-mcp-server"],
      "env": {
        "AGENTCLEAR_API_KEY": "axk_your_key_here"
      }
    }
  }
}
```

**3. Restart Claude Desktop.** That's it — Claude now has a wallet.

---

## What This Does

AgentClear turns your Claude into a self-service API consumer. Instead of configuring individual MCP servers for every service, Claude discovers what it needs, calls it, and pays with micropayments from your prepaid balance.

### Example Conversation

```
You: "What's the weather in Tokyo right now?"

Claude: *discovers OpenWeatherMap via AgentClear, calls it, returns results*

  The current weather in Tokyo is 18°C with partly cloudy skies,
  humidity at 62%, and winds from the southeast at 12 km/h.

  [Charged: $0.001 from your AgentClear balance]


You: "Find me recent AI research papers about transformers"

Claude: *discovers arXiv API via AgentClear, searches papers*

  Here are the top recent papers on transformers:
  1. "Efficient Attention Mechanisms for Long-Context Models" — Chen et al., 2026
  2. "Sparse Transformer Architectures at Scale" — Patel & Liu, 2026
  ...

  [Charged: $0.001 from your AgentClear balance]


You: "Translate that abstract into Japanese"

Claude: *discovers DeepL via AgentClear, translates text*

  「長文コンテキストモデルのための効率的なアテンションメカニズム」...

  [Charged: $0.002 from your AgentClear balance]
```

---

## Available Services

AgentClear's marketplace includes **60+ services** across these categories:

| Category | Examples |
|---|---|
| **Weather & Geo** | OpenWeatherMap, Geocoding, Timezone |
| **Search & Web** | Brave Search, SerpAPI, Google Trends |
| **AI & ML** | Image generation, Embeddings, OCR, Sentiment analysis |
| **Finance** | Stock quotes, Crypto prices, Currency exchange |
| **Communication** | Email verification, SMS, Push notifications |
| **Data & Research** | arXiv, News API, Wikipedia, Web scraping |
| **Translation** | DeepL, Google Translate, Language detection |
| **Developer Tools** | DNS lookup, IP geolocation, URL shortening |
| **Media** | Image search, Screenshot capture, QR code generation |

New services are added weekly. Use `discover_services` to see what's available.

---

## How It Works

```
┌──────────────┐     stdio      ┌─────────────────────┐     HTTPS     ┌──────────────────┐     HTTPS     ┌──────────────┐
│              │ ──────────────▶ │                     │ ─────────────▶│                  │ ─────────────▶│              │
│ Claude       │                │ AgentClear          │               │ AgentClear       │               │ Upstream     │
│ Desktop      │ ◀────────────── │ MCP Server          │ ◀─────────────│ Proxy            │ ◀─────────────│ API          │
│              │    responses   │ (this package)      │   responses   │ (agentclear.dev) │   responses   │ (e.g. OpenAI)│
└──────────────┘               └─────────────────────┘               └──────────────────┘               └──────────────┘
                                        │                                     │
                                        │ reads                               │ deducts
                                        ▼                                     ▼
                                AGENTCLEAR_API_KEY                    Your prepaid balance
```

1. **Claude** asks the MCP server to discover or call a service
2. **This MCP server** forwards the request to the AgentClear proxy with your API key
3. **AgentClear** authenticates you, routes to the upstream API, meters the call
4. **Response** flows back through the chain; cost is deducted from your balance

---

## MCP Tools

This server exposes three tools to Claude:

### `discover_services`

Search the AgentClear registry by natural language query.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | What you need, e.g. "weather data" |
| `max_results` | number | No | 1–20, defaults to 5 |

### `call_service`

Execute an API call through the AgentClear metered proxy.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `service_id` | string | Yes | Service ID from discovery |
| `payload` | object | Yes | Request payload for the upstream API |

### `check_balance`

Check your current wallet balance. No parameters.

---

## Pricing

| | |
|---|---|
| **Signup** | Free — includes a **$5 grant** to start |
| **Per-call pricing** | Most APIs cost **$0.001–$0.01** per call |
| **No subscriptions** | Pay only for what you use |
| **No markup on cheap APIs** | Some calls are fractions of a cent |

Top up your balance at [agentclear.dev/wallet](https://agentclear.dev/wallet).

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AGENTCLEAR_API_KEY` | Yes | Your API key from [agentclear.dev](https://agentclear.dev) |
| `AGENTCLEAR_BASE_URL` | No | Override the API base URL (default: `https://agentclear.dev`) |

### Claude Desktop Config

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\\Claude\\claude_desktop_config.json`
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentclear": {
      "command": "npx",
      "args": ["-y", "agentclear-mcp-server"],
      "env": {
        "AGENTCLEAR_API_KEY": "axk_your_key_here"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can use this server. Run it directly:

```bash
AGENTCLEAR_API_KEY=axk_your_key npx agentclear-mcp-server
```

Or install globally:

```bash
npm install -g agentclear-mcp-server
AGENTCLEAR_API_KEY=axk_your_key agentclear-mcp-server
```

---

## Development

```bash
git clone https://github.com/agentclear/agentclear-mcp-server.git
cd agentclear-mcp-server
npm install
npm run build
```

Test locally:

```bash
AGENTCLEAR_API_KEY=axk_test npm start
```

---

## Error Handling

The server handles common error cases gracefully:

| HTTP Status | Meaning | Server Response |
|---|---|---|
| 401 | Invalid API key | Prompts to check or regenerate key |
| 402 | Insufficient balance | Prompts to add funds |
| 404 | Service not found | Suggests using `discover_services` first |
| 429 | Rate limited | Asks to wait and retry |

---

## Contributing

Contributions welcome! Please open an issue or pull request on [GitHub](https://github.com/agentclear/agentclear-mcp-server).

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://agentclear.dev">AgentClear</a> — the API marketplace for AI agents.
</p>
