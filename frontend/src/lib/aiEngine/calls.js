/**
 * AI Engine — the Azure Function calls: a chat through aiProxy, a provider
 * test, an MCP tool sync and an MCP tool call. Imported through
 * `@/lib/aiEngine`, which re-exports it.
 */
import { postJSON } from '@/lib/api';

/**
 * Send a chat message to a provider via aiProxy.
 * @returns {{ text, promptTokens, completionTokens, estimatedCostUsd, latencyMs }}
 */
export async function chat(
  provider,
  model,
  prompt,
  systemPrompt = '',
  source = 'admin_playground'
) {
  const data = await postJSON('aiProxy', { provider, model, prompt, systemPrompt, source });
  if (!data.ok) throw new Error(data.error || 'aiProxy returned an error');
  return data;
}

/**
 * Test a provider's connectivity via testAiProvider.
 * Writes result server-side; returns { ok, latencyMs, status, error? }
 */
export async function testProvider(providerId) {
  return postJSON('testAiProvider', { providerId });
}

/**
 * Sync tools from an MCP server via syncMcpTools.
 * Writes tool list server-side; returns { ok, tools }
 */
export async function syncMcpTools(serverId) {
  return postJSON('syncMcpTools', { serverId });
}

/**
 * Call an MCP tool via mcpProxy.
 * @returns {{ ok, result: string, raw: any }}
 */
export async function mcpTool(serverId, tool, toolArguments = {}) {
  return postJSON('mcpProxy', { serverId, tool, arguments: toolArguments });
}
