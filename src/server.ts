import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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
      "User-Agent": "agentclear-mcp-server/0.2.0",
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
    version: "0.2.0",
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
// Express App (SSE Transport)
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// MCP Info
app.get("/mcp", (req, res) => {
  res.json({
    name: "AgentClear MCP Server",
    version: "0.2.0",
    description: "Discover and call 60+ paid APIs through AgentClear",
    sse_endpoint: "/sse",
    docs: "https://agentclear.dev",
  });
});

// Session store: Map<sessionId, transport>
const sessions = new Map<string, SSEServerTransport>();

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  
  // Create a new server instance for this connection
  const server = createServer();
  
  const transport = new SSEServerTransport("/messages", res);
  
  // Store session
  sessions.set(transport.sessionId, transport);

  // Clean up when connection closes
  res.on("close", () => {
    console.log(`SSE connection closed: ${transport.sessionId}`);
    sessions.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sessions.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    console.log(`Session not found: ${sessionId}`);
    res.status(404).send("Session not found");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgentClear MCP Server listening on port ${PORT}`);
});
