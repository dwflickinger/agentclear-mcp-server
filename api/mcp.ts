import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE = process.env.AGENTCLEAR_BASE_URL || "https://agentclear.dev";
const KEY = process.env.AGENTCLEAR_API_KEY || "";

async function ac(path: string, opts: any = {}) {
  if (!KEY) throw new Error("AGENTCLEAR_API_KEY not set on server");
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...opts.headers,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "agentclear-mcp/0.2.0",
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`AgentClear ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------
function createServer() {
  const s = new McpServer({ name: "agentclear", version: "0.2.0" });

  s.tool(
    "discover",
    {
      query: z.string().describe("Natural language API search"),
      limit: z.number().optional().default(5),
    },
    async ({ query, limit }) => {
      const r = await ac("/api/discover", {
        method: "POST",
        body: JSON.stringify({ query, limit }),
      });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    }
  );

  s.tool(
    "call",
    {
      service_id: z.string().describe("Service ID from discover"),
      payload: z.any().describe("JSON payload"),
    },
    async ({ service_id, payload }) => {
      const r = await ac(`/api/proxy/${encodeURIComponent(service_id)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    }
  );

  s.tool("check_balance", {}, async () => {
    const r = await ac("/api/wallet/balance");
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  });

  return s;
}

// ---------------------------------------------------------------------------
// In-memory session store (stateless per cold start, but OK for Smithery)
// ---------------------------------------------------------------------------
const sessions = new Map<string, SSEServerTransport>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url!, `https://${req.headers.host}`);

  // SSE endpoint: GET /api/mcp?sse=1
  if (req.method === "GET" && url.searchParams.has("sse")) {
    const server = createServer();
    const transport = new SSEServerTransport(`/api/mcp`, res as any);
    sessions.set(transport.sessionId, transport);
    await server.connect(transport);
    return; // SSE keeps connection open
  }

  // Message endpoint: POST /api/mcp?sessionId=xxx
  if (req.method === "POST") {
    const sessionId = url.searchParams.get("sessionId");
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) return res.status(404).json({ error: "Session not found" });
    await transport.handlePostMessage(req as any, res as any);
    return;
  }

  // Info page
  res.status(200).json({
    name: "AgentClear MCP Server",
    version: "0.2.0",
    description: "Discover and call 60+ paid APIs through AgentClear",
    sse_endpoint: "/api/mcp?sse=1",
    docs: "https://agentclear.dev",
  });
}
