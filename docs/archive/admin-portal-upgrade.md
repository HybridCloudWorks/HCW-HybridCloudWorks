# Admin Portal Upgrade Notes

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Completed:** 2026-05-25

---

## What Changed

### Modified Files

| File                                | Change                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/pages/admin/AdminLayout.jsx`   | Grouped sidebar navigation, live badge counts, Amplify section, **AI Engine nav item**                       |
| `src/pages/admin/DashboardPage.jsx` | Influencer command center with quick actions, pipeline flow, social/recordings sidebar cards                 |
| `src/App.jsx`                       | Added `/admin/social`, `/admin/recordings`, and `/admin/ai-engine` lazy routes                               |
| `functions/lib/ai-model-router.js`  | Added Perplexity, Azure OpenAI, AWS Bedrock (Nova); `callProvider()`; `getCostEstimate()`; `COST_TABLE`      |
| `functions/index.js`                | Added `aiProxy`, `testAiProvider`, `syncMcpTools`, `mcpProxy` Cloud Functions; imported `requireAdminClaims` |
| `platform/firebase/firestore.rules` | Added rules for `ai_providers`, `mcp_servers`, `ai_usage`, `recordings`                                      |
| `functions/.env`                    | Added commented-out stubs for all AI Engine API keys                                                         |

### New Files

| File                                 | Purpose                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `src/pages/admin/SocialHubPage.jsx`  | Publer integration — compose, schedule & manage social posts             |
| `src/pages/admin/RecordingsPage.jsx` | Plaud integration — upload, browse & route transcripts into pipeline     |
| `src/pages/admin/AIEnginePage.jsx`   | AI Engine — 4-tab admin for AI providers, MCP servers, playground, usage |
| `src/lib/aiEngine.js`                | Frontend client library for the AI Engine (Firestore + Function calls)   |

---

## What's New at a Glance

### Sidebar (`AdminLayout.jsx`)

- **Grouped navigation** with section labels: Pipeline → Content Library → Creative → Amplify →
  Platform
- **Live badge counts** on Review Queue and Editor — loaded from `getAdminDashboardSnapshot`
- **Amplify section** shows Social Hub (Publer) and Recordings (Plaud) with integration badges
- Starts **expanded by default** (was collapsed); preference persisted in localStorage

### Dashboard (`DashboardPage.jsx`)

- **"Today's Focus" header** — greeting changes based on queue depth
- **6-button Quick Actions row** — one tap to any stage
- **Pipeline flow** strip with live counts per stage
- **Content Type Totals** with click-through to each section
- **Needs Review list** limited to 8, with "+N more" link
- **Social Hub + Recordings sidebar cards** with direct action buttons
- Clean removal of the old repetitive per-section stat grids

### Social Hub (`/admin/social`) — Publer

Three tabs:

1. **Compose & Schedule** — pick a published article, select platforms (LinkedIn, X, Facebook,
   Instagram), write or AI-generate a caption, set an optional schedule time, post via Publer
2. **Scheduled Queue** — lists upcoming posts pulled from Publer API
3. **Connection Settings** — step-by-step setup instructions

### Recordings (`/admin/recordings`) — Plaud

Three tabs:

1. **Recording Library** — searchable grid of all recordings with expand-to-read and "Create
   Content" routing
2. **Upload Transcript** — paste or upload `.txt`/`.md` transcript files
3. **Plaud Settings** — connection instructions, email-ingest option

---

## Integration Setup

### Publer

```
# .env.local
VITE_PUBLER_API_KEY=your_publer_api_key
VITE_PUBLER_WORKSPACE=your_workspace_id   # optional
```

1. Go to https://app.publer.com/#/settings/access
2. Generate an API key
3. Add it to `.env.local`
4. Restart Vite (`npm run dev`)

**Backend function needed** (optional, for AI caption generation): Add a Cloud Function
`generateSocialCaption` that calls Vertex AI with the article content and returns
`{ caption: string }`. The Social Hub calls this when you click "AI Caption".

### Plaud (MCP — live integration)

Plaud ships a real MCP server at `https://mcp.plaud.ai/mcp` (Streamable HTTP, OAuth). **No manual
export needed** — the Recordings page connects live via the AI Engine's `mcpProxy`.

**Tools available:** `list_files`, `get_file`, `get_note`, `get_transcript`, `get_current_user`

**To connect:**

1. Run `npx -y @plaud-ai/mcp@latest install` (Node ≥ 20 required)
2. Authorize in the browser when prompted
3. Copy the `access_token` from `~/.plaud/tokens-mcp.json`
4. In the admin portal: go to `/admin/recordings` → **Connect** tab → paste the token and click
   **Save & Test**

The token is stored in Firestore (`mcp_servers/plaud.oauthToken`) and never returned to the browser.
The `mcpProxy` Cloud Function reads it server-side and uses it for all Plaud tool calls.

**Fallback:** The Upload tab still supports manual `.txt`/`.md` transcript paste for offline
recordings.

**Backend function needed** (for "Create Content" button in Recordings): Add a Cloud Function
`createContentFromRecording` that:

- Takes `{ recordingId, transcript, title, contentType, provider }`
- Calls Vertex AI to summarize/structure the transcript
- Writes a new doc to the `content` collection with `contentStatus: 'inspected'`
- Returns `{ contentId }`

---

## Other Integration Opportunities (from your Notion environment)

Once you share the full Notion "Environment" database, the following are likely candidates:

| Integration             | Where to add                         | Benefit                                                                                                                                                                |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canva** (unvalidated) | Editor page                          | Canva MCP exists in registry but is not yet connected. Requires plugin install + Canva Pro (~$15/mo for brand kit). Do not build until plugin is installed and tested. |
| **Sessionize**          | Already integrated (Speaking Events) | Extended — pull abstract/bio for social posts                                                                                                                          |
| **Google Analytics**    | Dashboard                            | Add a "Top Performing Content" card with live GA4 data                                                                                                                 |
| **Cloudflare**          | Ops Health                           | Cache purge after publish, real-time traffic                                                                                                                           |
| **Notion**              | Dashboard                            | Show your personal task list / content ideas from Notion                                                                                                               |
| **Spotify/Anchor**      | Recordings → Social                  | Auto-generate podcast show notes from Plaud recording                                                                                                                  |
| **YouTube** ✅          | Social Hub                           | YouTube added to PLATFORMS array — schedule via Publer                                                                                                                 |

---

## Notes for the Browser Extension Issue

The Claude in Chrome/Edge extension wasn't reachable during this session. To access your Notion
Environment table:

1. Open Edge with the Claude extension signed in
2. Open a new conversation and paste the Notion URL
3. Ask Claude to read the integrations table and extend the Social Hub / Recordings pages
   accordingly

---

## AI Engine (`/admin/ai-engine`)

### Architecture decision — MCP Transport (May 2026)

All MCP tool calls proxy through **Firebase Cloud Functions** (`mcpProxy`). This is the recommended
pattern as of 2026:

- API keys never leave the server — no secrets in the browser
- Works with any MCP transport (HTTP, Streamable HTTP, SSE)
- CORS is handled transparently
- Rate limiting and caching can be added at the Function layer

The standard as of May 2026 is **Streamable HTTP** — a single POST endpoint per MCP server accepting
JSON-RPC 2.0 requests. The proxy sends `tools/list` to discover tools and `tools/call` to invoke
them.

### AI Providers

| Provider           | Status                | Key required                                     | Notes                                         |
| ------------------ | --------------------- | ------------------------------------------------ | --------------------------------------------- |
| Claude (Anthropic) | Ready                 | `ANTHROPIC_API_KEY`                              | Set in `functions/.env`                       |
| ChatGPT (OpenAI)   | Ready                 | `OPENAI_API_KEY`                                 | Set in `functions/.env`                       |
| Gemini (Vertex AI) | **Active by default** | None                                             | Uses ADC — already working in Cloud Functions |
| Perplexity Sonar   | Ready                 | `PERPLEXITY_API_KEY`                             | Live web search augmented                     |
| Azure OpenAI       | Ready                 | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | Closest to Microsoft Copilot enterprise       |
| AWS Bedrock (Nova) | Ready                 | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`    | Nova Lite near-free; SigV4 signing built-in   |
| NotebookLM         | Placeholder           | N/A                                              | No public API as of 2026; slot reserved       |

### MCP Servers (pre-configured, all disabled until you add keys)

| Server       | URL                                | Key                 |
| ------------ | ---------------------------------- | ------------------- |
| Firecrawl    | `https://mcp.firecrawl.dev/sse`    | `FIRECRAWL_API_KEY` |
| Brave Search | `https://api.search.brave.com/mcp` | `BRAVE_API_KEY`     |
| Context7     | `https://mcp.context7.com/mcp`     | None                |

### New Firestore collections

| Collection     | Written by                      | Purpose                                     |
| -------------- | ------------------------------- | ------------------------------------------- |
| `ai_providers` | Admin UI (seeded on first load) | Provider configs, status, model preferences |
| `mcp_servers`  | Admin UI                        | MCP server configs, tool manifests, status  |
| `ai_usage`     | `aiProxy` Cloud Function        | Token counts + estimated cost per call      |
| `recordings`   | Admin UI (Plaud integration)    | Plaud transcript library                    |

### New Cloud Functions

| Function         | Auth               | Purpose                                            |
| ---------------- | ------------------ | -------------------------------------------------- |
| `aiProxy`        | adminRole ≥ viewer | Routes AI chat requests to any configured provider |
| `testAiProvider` | adminRole ≥ viewer | Sends test ping, updates status in Firestore       |
| `syncMcpTools`   | adminRole ≥ viewer | Fetches tool list from an MCP server               |
| `mcpProxy`       | adminRole ≥ viewer | Proxies MCP tool calls server-side                 |

### Cost table (approximate, May 2026)

| Provider / Model       | Input ($/1M tokens) | Output ($/1M tokens) |
| ---------------------- | ------------------- | -------------------- |
| claude-opus-4-6        | $15.00              | $75.00               |
| claude-sonnet-4-6      | $3.00               | $15.00               |
| claude-haiku-4-5       | $0.80               | $4.00                |
| gpt-4o                 | $5.00               | $15.00               |
| gpt-4o-mini            | $0.15               | $0.60                |
| gemini-2.5-flash       | $0.30               | $2.50                |
| sonar-pro (Perplexity) | $3.00               | $15.00               |
| nova-lite (AWS)        | $0.06               | $0.24                |
| nova-micro (AWS)       | $0.035              | $0.14                |
