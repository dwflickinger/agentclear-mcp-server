import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import cors from "cors";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AGENTCLEAR_BASE_URL =
  process.env.AGENTCLEAR_BASE_URL || "https://agentclear.dev";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function agentclearFetch(path: string, options: any, apiKey?: string) {
  if (!apiKey && !process.env.AGENTCLEAR_API_KEY) {
    throw new Error(
      "AGENTCLEAR_API_KEY not provided. Please configure your client with the API key."
    );
  }

  const key = apiKey || process.env.AGENTCLEAR_API_KEY;

  const res = await fetch(`${AGENTCLEAR_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "agentclear-mcp-server/0.3.0",
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      `AgentClear API error ${res.status}: ${JSON.stringify(data) || res.statusText}`
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// MCP Server Factory
// ---------------------------------------------------------------------------

export const createServer = () => {
  const server = new McpServer({
    name: "AgentClear — API Marketplace for AI Agents",
    version: "0.3.0",
  });

  server.tool(
    "discover_services",
    {
      query: z.string().describe("Search for paid API services (e.g. 'stock quotes', 'weather data', 'email verification')"),
      limit: z.number().optional().default(5),
    },
    async ({ query, limit }) => {
      const result = await agentclearFetch(
        "/api/discover",
        {
          method: "POST",
          body: JSON.stringify({ query, limit }),
        },
        process.env.AGENTCLEAR_API_KEY
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "call_service",
    {
      service_id: z.string().describe("Service ID returned from discover_services"),
      payload: z.any().describe("JSON request payload for the API service"),
    },
    async ({ service_id, payload }) => {
      const result = await agentclearFetch(
        `/api/proxy/${encodeURIComponent(service_id)}`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        process.env.AGENTCLEAR_API_KEY
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "check_balance",
    {},
    async () => {
      const result = await agentclearFetch(
        "/api/wallet/balance",
        { method: "GET" },
        process.env.AGENTCLEAR_API_KEY
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // -----------------------------------------------------------------------
  // Prompts — drive engagement on Smithery
  // -----------------------------------------------------------------------

  server.prompt(
    "find-api",
    {
      use_case: z.string().describe("What you need an API for (e.g. 'stock prices', 'send email', 'verify phone number')"),
    },
    ({ use_case }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I need an API for: ${use_case}\n\nUse the discover_services tool to find the best matching APIs on AgentClear. For each result, show the name, what it does, and the price per call. Then recommend which one to use and show an example call_service invocation.`,
          },
        },
      ],
    })
  );

  server.prompt(
    "explore-marketplace",
    {},
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Show me what's available on the AgentClear API marketplace. Use discover_services to search for popular categories:\n1. Financial data (stocks, crypto)\n2. Communication (email, SMS)\n3. Security (URL scanning, WHOIS)\n4. Business intelligence\n5. AI/ML services\n\nFor each category, show the top result with name, description, and price. Then check my balance with check_balance.`,
          },
        },
      ],
    })
  );

  server.prompt(
    "quick-api-call",
    {
      query: z.string().describe("What data or action you need"),
    },
    ({ query }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I need: ${query}\n\nFirst use discover_services to find the right API, then immediately call it with call_service. Show me the results. If it costs money, tell me the price before calling.`,
          },
        },
      ],
    })
  );

  return server;
};

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// Server info
app.get("/", (_req, res) => {
  res.json({
    name: "AgentClear MCP Server",
    version: "0.3.0",
    description: "Discover and call 60+ paid APIs through AgentClear",
    transports: {
      streamable_http: "/mcp",
      sse_legacy: "/sse",
    },
    docs: "https://agentclear.dev",
  });
});

// Static Server Card — overrides Smithery's AI-generated metadata
app.get("/.well-known/mcp/server-card.json", (_req, res) => {
  res.json({
    serverInfo: {
      name: "AgentClear — API Marketplace for AI Agents",
      version: "0.3.0",
    },
    description:
      "Access 60+ paid API services through a single API key with sub-cent micropayments. Discover financial data, weather, email tools, document parsing, and more — all metered per-call with no subscriptions.",
    authentication: {
      required: false,
    },
    tools: [
      {
        name: "discover_services",
        description:
          "Search the AgentClear marketplace for paid API services by keyword (e.g. 'stock quotes', 'weather', 'email verification')",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language search query" },
            limit: { type: "number", description: "Max results (default 5)" },
          },
          required: ["query"],
        },
      },
      {
        name: "call_service",
        description:
          "Execute a metered API call through the AgentClear proxy. Costs sub-cent per call, charged to your AgentClear wallet.",
        inputSchema: {
          type: "object",
          properties: {
            service_id: { type: "string", description: "Service ID from discover_services" },
            payload: { type: "object", description: "JSON request payload" },
          },
          required: ["service_id", "payload"],
        },
      },
      {
        name: "check_balance",
        description: "Check your AgentClear wallet balance",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    resources: [],
    prompts: [
      {
        name: "find-api",
        description: "Find the perfect API for any use case — stocks, email, security, and more",
        arguments: [{ name: "use_case", description: "What you need an API for", required: true }],
      },
      {
        name: "explore-marketplace",
        description: "Browse the full AgentClear marketplace by category",
        arguments: [],
      },
      {
        name: "quick-api-call",
        description: "Find and call an API in one shot — just describe what you need",
        arguments: [{ name: "query", description: "What data or action you need", required: true }],
      },
    ],
  });
});

// =========================================================================
// TRANSPORT 1: Streamable HTTP (MCP spec current — required by Smithery)
// =========================================================================

const streamableSessions = new Map<string, StreamableHTTPServerTransport>();

// POST /mcp — handles initialize + all subsequent JSON-RPC requests
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && streamableSessions.has(sessionId)) {
      // Existing session
      transport = streamableSessions.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session — create transport + MCP server
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.log(`[streamable] session initialized: ${sid}`);
          streamableSessions.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          console.log(`[streamable] session closed: ${sid}`);
          streamableSessions.delete(sid);
        }
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[streamable] error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET /mcp — SSE stream for server-initiated messages (notifications)
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !streamableSessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = streamableSessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// DELETE /mcp — session termination
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !streamableSessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = streamableSessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// =========================================================================
// TRANSPORT 2: Legacy SSE (backward compat for existing Claude Desktop users)
// =========================================================================

const sseSessions = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  console.log("[sse] new connection");
  const server = createServer();
  const transport = new SSEServerTransport("/messages", res);

  console.log("[sse] session:", transport.sessionId);
  sseSessions.set(transport.sessionId, transport);

  res.on("close", () => {
    console.log(`[sse] closed: ${transport.sessionId}`);
    sseSessions.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseSessions.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session not found");
  }
});

// =========================================================================
// Start
// =========================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgentClear MCP Server v0.3.0 listening on port ${PORT}`);
  console.log(`  Streamable HTTP: POST/GET/DELETE /mcp`);
  console.log(`  Legacy SSE:      GET /sse + POST /messages`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  for (const [sid, t] of streamableSessions) {
    try { await t.close(); } catch {}
    streamableSessions.delete(sid);
  }
  process.exit(0);
});
