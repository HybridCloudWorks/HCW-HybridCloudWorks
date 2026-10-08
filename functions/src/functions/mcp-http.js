/**
 * Azure HTTP registrations for the AI Engine MCP proxy, tool sync, and the
 * OAuth Connect flow (start, complete, disconnect; lib/ai/mcp-oauth-handlers.js).
 */
import { httpRoute } from "../lib/auth/http-route.js";
import { getDefaultGuard } from "../lib/auth/default-guard.js";
import { readDoc, patchDoc, queryDocs, upsertDoc } from "../lib/cosmos-client.js";
import { createMcpHandlers } from "../lib/ai/mcp.js";
import { createMcpOAuthHandlers } from "../lib/ai/mcp-oauth-handlers.js";

const handlers = () =>
  createMcpHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, patchDoc },
  });

const oauthHandlers = () =>
  createMcpOAuthHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, patchDoc, queryDocs, upsertDoc },
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

httpRoute("mcpOAuthStart", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cms/mcp/{serverId}/oauth/start",
  handler: (request, context) => oauthHandlers().startMcpOAuth(request, context),
});

httpRoute("mcpOAuthComplete", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cms/mcp/oauth/complete",
  handler: (request, context) => oauthHandlers().completeMcpOAuth(request, context),
});

httpRoute("mcpOAuthDisconnect", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cms/mcp/{serverId}/oauth/disconnect",
  handler: (request, context) => oauthHandlers().disconnectMcpOAuth(request, context),
});
