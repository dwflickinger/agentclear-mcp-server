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
    name: "agentclear",
    version: "0.3.0",
  });

  server.tool(
    "discover",
    {
      query: z.string().describe("Natural language API search"),
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
    "call",
    {
      service_id: z.string().describe("Service ID from discover"),
      payload: z.any().describe("JSON payload"),
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
