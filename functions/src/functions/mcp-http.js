/** Azure HTTP registrations for the AI Engine MCP proxy and tool sync. */
import { httpRoute } from "../lib/auth/http-route.js";
import { getDefaultGuard } from "../lib/auth/default-guard.js";
import { readDoc, patchDoc } from "../lib/cosmos-client.js";
import { createMcpHandlers } from "../lib/ai/mcp.js";

const handlers = () =>
  createMcpHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, patchDoc },
  });

httpRoute("mcpProxy", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "mcpProxy",
  handler: (request, context) => handlers().mcpProxy(request, context),
});

httpRoute("syncMcpTools", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "syncMcpTools",
  handler: (request, context) => handlers().syncMcpTools(request, context),
});
