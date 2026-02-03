#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import { SshTouchSessionManager } from "./ssh-touch-session.js";
import type { SessionConfig, DaemonCommand } from "./types.js";
import { randomUUID } from "node:crypto";

// Defaults from environment variables
function defaultConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  const envWidth = process.env.REMOTETOUCH_SCREEN_WIDTH;
  const envHeight = process.env.REMOTETOUCH_SCREEN_HEIGHT;
  return {
    host: overrides.host ?? process.env.REMOTETOUCH_SSH_HOST ?? "",
    user: overrides.user ?? process.env.REMOTETOUCH_SSH_USER ?? "pi",
    port: overrides.port ?? Number(process.env.REMOTETOUCH_SSH_PORT ?? "22"),
    sshKey: overrides.sshKey ?? process.env.REMOTETOUCH_SSH_KEY ?? undefined,
    screenWidth: overrides.screenWidth ?? (envWidth ? Number(envWidth) : undefined),
    screenHeight: overrides.screenHeight ?? (envHeight ? Number(envHeight) : undefined),
    useSudo: overrides.useSudo ?? (process.env.REMOTETOUCH_USE_SUDO === "true"),
  };
}

// --- Server factory ---

function createServer(manager: SshTouchSessionManager): McpServer {
  const server = new McpServer({
    name: "mcp-remotetouch",
    version: "0.1.0",
  });

  server.tool(
    "touch_connect",
    "Connect to a remote Linux device via SSH and start the touch daemon. Returns a session ID for subsequent touch commands.",
    {
      host: z.string().optional().describe("SSH host (default: env REMOTETOUCH_SSH_HOST)"),
      user: z.string().optional().describe("SSH user (default: env REMOTETOUCH_SSH_USER or 'pi')"),
      port: z.number().optional().describe("SSH port (default: env REMOTETOUCH_SSH_PORT or 22)"),
      sshKey: z.string().optional().describe("Path to SSH private key"),
      screenWidth: z.number().optional().describe("Screen width in pixels (default: auto-detected from device, or env REMOTETOUCH_SCREEN_WIDTH)"),
      screenHeight: z.number().optional().describe("Screen height in pixels (default: auto-detected from device, or env REMOTETOUCH_SCREEN_HEIGHT)"),
      useSudo: z.boolean().optional().describe("Run daemon with sudo (default: env REMOTETOUCH_USE_SUDO or false)"),
    },
    async (params) => {
      const config = defaultConfig({
        host: params.host,
        user: params.user,
        port: params.port,
        sshKey: params.sshKey,
        screenWidth: params.screenWidth,
        screenHeight: params.screenHeight,
        useSudo: params.useSudo,
      });
      if (!config.host) {
        return {
          content: [{ type: "text", text: "Error: host is required. Set REMOTETOUCH_SSH_HOST or pass host parameter." }],
          isError: true,
        };
      }
      try {
        const sessionId = await manager.connect(config);
        const session = manager.getSession(sessionId)!;
        const w = session.config.screenWidth ?? "unknown";
        const h = session.config.screenHeight ?? "unknown";
        return {
          content: [{ type: "text", text: `Connected. Session ID: ${sessionId}\nHost: ${config.user}@${config.host}:${config.port}\nScreen: ${w}x${h}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "touch_tap",
    "Perform a tap at the given coordinates on the remote touchscreen.",
    {
      sessionId: z.string().describe("Session ID from touch_connect"),
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      duration_ms: z.number().optional().describe("Tap duration in milliseconds (default: 50)"),
    },
    async (params) => {
      const cmd: DaemonCommand = {
        id: `tap-${Date.now()}`,
        type: "tap",
        x: params.x,
        y: params.y,
        duration_ms: params.duration_ms,
      };
      try {
        const resp = await manager.sendCommand(params.sessionId, cmd);
        if (resp.status === "error") {
          return { content: [{ type: "text", text: `Tap failed: ${resp.message}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Tapped at (${params.x}, ${params.y})` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "touch_swipe",
    "Perform a swipe gesture from (x1,y1) to (x2,y2) on the remote touchscreen.",
    {
      sessionId: z.string().describe("Session ID from touch_connect"),
      x1: z.number().describe("Start X coordinate"),
      y1: z.number().describe("Start Y coordinate"),
      x2: z.number().describe("End X coordinate"),
      y2: z.number().describe("End Y coordinate"),
      duration_ms: z.number().optional().describe("Swipe duration in milliseconds (default: 300)"),
      steps: z.number().optional().describe("Number of interpolation steps"),
    },
    async (params) => {
      const cmd: DaemonCommand = {
        id: `swipe-${Date.now()}`,
        type: "swipe",
        x: params.x1,
        y: params.y1,
        x2: params.x2,
        y2: params.y2,
        duration_ms: params.duration_ms,
        steps: params.steps,
      };
      try {
        const resp = await manager.sendCommand(params.sessionId, cmd);
        if (resp.status === "error") {
          return { content: [{ type: "text", text: `Swipe failed: ${resp.message}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Swiped from (${params.x1}, ${params.y1}) to (${params.x2}, ${params.y2})` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "touch_long_press",
    "Perform a long press at the given coordinates on the remote touchscreen.",
    {
      sessionId: z.string().describe("Session ID from touch_connect"),
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      duration_ms: z.number().optional().describe("Press duration in milliseconds (default: 800)"),
    },
    async (params) => {
      const cmd: DaemonCommand = {
        id: `longpress-${Date.now()}`,
        type: "long_press",
        x: params.x,
        y: params.y,
        duration_ms: params.duration_ms,
      };
      try {
        const resp = await manager.sendCommand(params.sessionId, cmd);
        if (resp.status === "error") {
          return { content: [{ type: "text", text: `Long press failed: ${resp.message}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Long pressed at (${params.x}, ${params.y}) for ${params.duration_ms ?? 800}ms` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "touch_double_tap",
    "Perform a double tap at the given coordinates on the remote touchscreen.",
    {
      sessionId: z.string().describe("Session ID from touch_connect"),
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
    },
    async (params) => {
      const cmd: DaemonCommand = {
        id: `doubletap-${Date.now()}`,
        type: "double_tap",
        x: params.x,
        y: params.y,
      };
      try {
        const resp = await manager.sendCommand(params.sessionId, cmd);
        if (resp.status === "error") {
          return { content: [{ type: "text", text: `Double tap failed: ${resp.message}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Double tapped at (${params.x}, ${params.y})` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "touch_disconnect",
    "Disconnect a touch session and clean up the remote daemon.",
    {
      sessionId: z.string().describe("Session ID to disconnect"),
    },
    async (params) => {
      try {
        await manager.disconnect(params.sessionId);
        return { content: [{ type: "text", text: `Session ${params.sessionId} disconnected.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "touch_list_sessions",
    "List all active touch sessions.",
    {},
    async () => {
      const sessions = manager.listSessions();
      if (sessions.length === 0) {
        return { content: [{ type: "text", text: "No active sessions." }] };
      }
      const lines = sessions.map((s) => `${s.id} - ${s.host} (${s.active ? "active" : "inactive"})`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  return server;
}

// --- CLI argument parsing ---

function parseArgs(argv: string[]): { server: boolean; port: number; host: string } {
  let server = false;
  let port = Number(process.env.REMOTETOUCH_PORT ?? "3000");
  let host = "0.0.0.0";

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--server") {
      server = true;
    } else if (argv[i] === "--port" && i + 1 < argv.length) {
      port = Number(argv[++i]);
    } else if (argv[i] === "--host" && i + 1 < argv.length) {
      host = argv[++i];
    }
  }

  return { server, port, host };
}

// --- Stdio mode ---

async function startStdioServer(manager: SshTouchSessionManager) {
  const server = createServer(manager);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await manager.disconnectAll();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await manager.disconnectAll();
    process.exit(0);
  });
}

// --- HTTP streaming mode ---

async function startHttpServer(manager: SshTouchSessionManager, host: string, port: number) {
  const app = createMcpExpressApp({ host });
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req: any, res: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const body = req.body;
    const isInitialize = Array.isArray(body)
      ? body.some((msg: any) => msg.method === "initialize")
      : body?.method === "initialize";

    if (isInitialize) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        },
      });

      const mcpServer = createServer(manager);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
  });

  app.get("/mcp", async (req: any, res: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: any, res: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  const httpServer = app.listen(port, host, () => {
    console.log(`MCP HTTP server listening on http://${host}:${port}/mcp`);
  });

  const shutdown = async () => {
    console.log("\nShutting down...");
    for (const transport of transports.values()) {
      await transport.close();
    }
    transports.clear();
    await manager.disconnectAll();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- Entry point ---

async function main() {
  const args = parseArgs(process.argv);
  const manager = new SshTouchSessionManager();

  if (args.server) {
    await startHttpServer(manager, args.host, args.port);
  } else {
    await startStdioServer(manager);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
