/**
 * AI Engine — browser client library
 *
 * Provides a unified interface for:
 *   • Calling any configured AI provider (via the Azure aiProxy RPC)
 *   • Calling MCP server tools (via the Azure mcpProxy RPC)
 *   • Reading/writing provider and server configs via cms/config/*
 *
 * All calls are authenticated with the current user's Entra access token and
 * terminate at the Azure Functions API.
 *
 * Config reads note: mcp_servers documents carry hasOauthToken (boolean)
 * instead of the token itself — the value is write-only on the API.
 *
 * Usage:
 *   import { aiEngine } from '@/lib/aiEngine';
 *   const { text } = await aiEngine.chat('anthropic', 'claude-sonnet-4-6', 'Hello!');
 *   const result    = await aiEngine.mcpTool('brave-search', 'brave_web_search', { query: 'test' });
 *
 * This file is the one import path; the halves live beside it (PR #841):
 *   aiEngine/seed.js      the default documents and the first-load seed
 *   aiEngine/config.js    config routes, subscriptions, provider and server writes
 *   aiEngine/features.js  feature switches, placement and routing by task
 *   aiEngine/calls.js     the Azure Function calls (aiProxy, mcpProxy, tests)
 *   aiEngine/usage.js     usage records and totals
 */

import {
  DEFAULT_MCP_SERVERS,
  DEFAULT_PROVIDERS,
  PROVIDER_SCHEMA_VERSION,
  SEED_OWNED_PROVIDER_FIELDS,
  providerDisplayPatches,
  providerModelPatches,
  seedAiEngineIfEmpty,
} from './aiEngine/seed';
import {
  addMcpServer,
  removeMcpServer,
  setEnabled,
  setMcpOAuthToken,
  setProviderModel,
  setProviderOrder,
  subscribeMcpServers,
  subscribeProviders,
} from './aiEngine/config';
import {
  getAiFeatures,
  getAiRouting,
  setAiFeature,
  setAiPlacement,
  setAiRoute,
} from './aiEngine/features';
import { chat, mcpTool, syncMcpTools, testProvider } from './aiEngine/calls';
import { aggregateByProvider, aggregateBySource, getUsageRecords } from './aiEngine/usage';

export {
  DEFAULT_MCP_SERVERS,
  DEFAULT_PROVIDERS,
  PROVIDER_SCHEMA_VERSION,
  SEED_OWNED_PROVIDER_FIELDS,
  providerDisplayPatches,
  providerModelPatches,
  seedAiEngineIfEmpty,
  addMcpServer,
  removeMcpServer,
  setEnabled,
  setMcpOAuthToken,
  setProviderModel,
  setProviderOrder,
  subscribeMcpServers,
  subscribeProviders,
  getAiFeatures,
  getAiRouting,
  setAiFeature,
  setAiPlacement,
  setAiRoute,
  chat,
  mcpTool,
  syncMcpTools,
  testProvider,
  aggregateByProvider,
  aggregateBySource,
  getUsageRecords,
};

// Named export bundle for convenience
export const aiEngine = {
  getAiRouting,
  setAiRoute,
  chat,
  testProvider,
  syncMcpTools,
  mcpTool,
  seedAiEngineIfEmpty,
  subscribeProviders,
  subscribeMcpServers,
  setEnabled,
  setProviderModel,
  setProviderOrder,
  getAiFeatures,
  setAiFeature,
  setAiPlacement,
  setMcpOAuthToken,
  addMcpServer,
  removeMcpServer,
  getUsageRecords,
  aggregateByProvider,
  aggregateBySource,
};

export default aiEngine;
