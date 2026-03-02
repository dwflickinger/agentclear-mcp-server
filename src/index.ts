#!/usr/bin/env node

/**
 * AgentClear MCP Server
 *
 * Gives any MCP-compatible LLM (Claude Desktop, etc.) access to 60+ paid API
 * services through a single AgentClear API key with sub-cent micropayments.
 *
 * Tools:
 *   - discover_services: Search the AgentClear service registry
 *   - call_service: Execute an API call through the metered proxy
 *   - check_balance: View current wallet balance
 *
 * @see https://agentclear.dev
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AGENTCLEAR_BASE_URL =
  process.env.AGENTCLEAR_BASE_URL ?? "https://agentclear.dev";
const AGENTCLEAR_API_KEY = process.env.AGENTCLEAR_API_KEY;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceResult {
  id: string;
  name: string;
  description: string;
  price_per_call: string;
  category: string;
  provider: string;
}

interface DiscoverResponse {
  services: ServiceResult[];
  total: number;
  query: string;
}

interface ProxyResponse {
  data: unknown;
  transaction_id: string;
  cost: string;
  service_id: string;
}

interface BalanceResponse {
  balance: string;
  currency: string;
  account_id: string;
}

interface AgentClearError {
  error: string;
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function agentclearFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  if (!AGENTCLEAR_API_KEY) {
    throw new Error(
      "AGENTCLEAR_API_KEY environment variable is not set. " +
        "Get your free API key at https://agentclear.dev/signup"
    );
  }

  const url = `${AGENTCLEAR_BASE_URL}${path}`;
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${AGENTCLEAR_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": "agentclear-mcp-server/0.1.0",
  };

  const fetchOptions: RequestInit = { method, headers };
  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error contacting AgentClear: ${message}`);
  }

  if (!response.ok) {
    let errorBody: string;
    try {
      const parsed = (await response.json()) as AgentClearError;
      errorBody = parsed.message || parsed.error || JSON.stringify(parsed);
    } catch {
      errorBody = await response.text();
    }

    if (response.status === 401) {
      throw new Error(
        "Invalid API key. Check your AGENTCLEAR_API_KEY or generate a new one at https://agentclear.dev/settings"
      );
    }
    if (response.status === 402) {
      throw new Error(
        "Insufficient balance. Add funds at https://agentclear.dev/wallet"
      );
    }
    if (response.status === 404) {
      throw new Error(`Service not found: ${errorBody}`);
    }
    if (response.status === 429) {
      throw new Error(
        "Rate limit exceeded. Please wait a moment and try again."
      );
    }

    throw new Error(
      `AgentClear API error (${response.status}): ${errorBody}`
    );
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatServiceList(services: ServiceResult[]): string {
  if (services.length === 0) {
    return "No matching services found. Try a broader search query.";
  }

  const lines = services.map(
    (s, i) =>
      `${i + 1}. **${s.name}** (${s.id})\n` +
      `   ${s.description}\n` +
      `   Category: ${s.category} | Provider: ${s.provider}\n` +
      `   Price: ${s.price_per_call} per call`
  );

  return lines.join("\n\n");
}

function formatProxyResponse(res: ProxyResponse): string {
  const dataStr =
    typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);

  return (
    `--- Response from ${res.service_id} ---\n` +
    `Transaction: ${res.transaction_id}\n` +
    `Cost: ${res.cost}\n\n` +
    dataStr
  );
}

function formatBalance(res: BalanceResponse): string {
  return (
    `AgentClear Wallet\n` +
    `Balance: ${res.balance} ${res.currency}\n` +
    `Account: ${res.account_id}`
  );
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "agentclear",
  version: "0.1.0",
});

// Tool 1: discover_services ---------------------------------------------------

server.registerTool(
  "discover_services",
  {
    title: "Discover Services",
    description:
      "Search AgentClear's registry of 60+ API services by describing what you need " +
      "in natural language. Returns ranked results with pricing. Use this to find the " +
      "right API before calling it — for example, search for 'weather data', " +
      "'image generation', 'stock prices', or 'email verification'.",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Natural language description of the API capability you need, e.g. 'real-time weather data' or 'translate text between languages'"
        ),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Maximum number of results to return (1–20, default 5)"),
    },
  },
  async ({ query, max_results }) => {
    try {
      const data = await agentclearFetch<DiscoverResponse>(
        "/api/discover",
        {
          method: "POST",
          body: { query, max_results },
        }
      );

      const text =
        `Found ${data.total} service(s) matching "${data.query}":\n\n` +
        formatServiceList(data.services);

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: call_service --------------------------------------------------------

server.registerTool(
  "call_service",
  {
    title: "Call Service",
    description:
      "Call an API service through AgentClear's metered proxy. You'll be charged the " +
      "per-call price from your prepaid balance. Use 'discover_services' first to find " +
      "the service_id. The payload varies by service — discovery results include " +
      "expected input schemas.",
    inputSchema: {
      service_id: z
        .string()
        .describe(
          "The service ID returned by discover_services, e.g. 'openweathermap', 'deepl-translate'"
        ),
      payload: z
        .record(z.unknown())
        .describe(
          "The request payload to send to the upstream API. Structure depends on the service."
        ),
    },
  },
  async ({ service_id, payload }) => {
    try {
      const data = await agentclearFetch<ProxyResponse>(
        `/api/proxy/${encodeURIComponent(service_id)}`,
        {
          method: "POST",
          body: payload,
        }
      );

      return {
        content: [{ type: "text" as const, text: formatProxyResponse(data) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: check_balance -------------------------------------------------------

server.registerTool(
  "check_balance",
  {
    title: "Check Balance",
    description:
      "Check your current AgentClear wallet balance. Use this before making expensive " +
      "calls or when a call fails with a 402 (insufficient funds) error.",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await agentclearFetch<BalanceResponse>(
        "/api/wallet/balance"
      );

      return {
        content: [{ type: "text" as const, text: formatBalance(data) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AgentClear MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting AgentClear MCP server:", err);
  process.exit(1);
});
