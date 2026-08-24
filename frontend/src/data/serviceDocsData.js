/**
 * serviceDocsData.js
 *
 * Documentation content for every AI provider and MCP server in the AI Engine.
 * Content is sourced from official documentation pages.
 *
 * Sources:
 *  Plaud MCP   — https://docs.plaud.ai/documentation/plaud_app/mcp
 *  Plaud CLI   — https://docs.plaud.ai/documentation/plaud_app/cli
 *  Anthropic   — https://docs.anthropic.com
 *  OpenAI      — https://platform.openai.com/docs
 *  Vertex AI   — https://cloud.google.com/vertex-ai/generative-ai/docs
 *  Perplexity  — https://docs.perplexity.ai
 *  Azure OAI   — https://learn.microsoft.com/en-us/azure/ai-services/openai
 *  AWS Bedrock — https://docs.aws.amazon.com/bedrock/latest/userguide
 *  Firecrawl   — https://docs.firecrawl.dev
 *  Brave Search— https://api.search.brave.com/app/documentation
 *  Context7    — https://context7.com / https://github.com/upstash/context7
 *
 * Structure per entry:
 *  requirements  — prerequisites before starting
 *  hcwUses       — how HybridCloudWorks uses this service (matrix rows)
 *  sections      — install / use / uninstall / advanced (each has steps)
 *  references    — official source links at the bottom
 *
 * Each `step` in a section:
 *  { heading, body, codes: [{ lang, label, content }] }
 */

// ─── Shared helpers ───────────────────────────────────────────────────────────
const HCW_STATUS = { ACTIVE: 'active', AVAILABLE: 'available', PLANNED: 'planned' };

// ═════════════════════════════════════════════════════════════════════════════
export const SERVICE_DOCS = {
  // ── Claude (Anthropic) ───────────────────────────────────────────────────
  anthropic: {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    type: 'ai_provider',
    tagline: 'State-of-the-art AI by Anthropic — Opus, Sonnet, Haiku.',
    requirements: [
      {
        label: 'Anthropic account',
        detail: 'console.anthropic.com — free to create',
        required: true,
      },
      { label: 'API Key', detail: 'Generated in the Console → API Keys', required: true },
      {
        label: 'Billing enabled',
        detail: 'A payment method is required for API access',
        required: true,
      },
      {
        label: 'Node.js ≥ 18',
        detail: 'Only needed if using the Node SDK directly',
        required: false,
      },
    ],
    hcwUses: [
      {
        feature: 'ContentForge Pipeline',
        usage:
          'Draft generation, content analysis, and structured JSON extraction when CONTENTFORGE_AI_PROVIDER=anthropic',
        files: ['functions/lib/ai-model-router.js'],
        status: HCW_STATUS.AVAILABLE,
      },
      {
        feature: 'AI Engine Playground',
        usage: 'Interactive testing of all Claude models',
        files: ['src/pages/admin/AIEnginePage.jsx', 'functions/index.js (aiProxy)'],
        status: HCW_STATUS.AVAILABLE,
      },
      {
        feature: 'Social Caption Generation',
        usage:
          'AI-generated social media captions via generateSocialCaption (backend function, to be implemented)',
        files: ['src/pages/admin/SocialHubPage.jsx'],
        status: HCW_STATUS.PLANNED,
      },
    ],
    sections: {
      install: {
        title: 'Install & Configure',
        steps: [
          {
            heading: '1. Create an Anthropic account',
            body: 'Sign up at console.anthropic.com. Billing must be enabled before any API calls will succeed — add a payment method under Billing → Payment methods.',
            codes: [],
          },
          {
            heading: '2. Generate an API key',
            body: 'In the Anthropic Console go to API Keys → Create Key. Give it a descriptive name (e.g. "HCW Production"). Copy the key — it is only shown once.',
            codes: [],
          },
          {
            heading: '3. Add the key to your Functions environment',
            body: 'Add the key to functions/.env. Never commit this file to git — it is already in .gitignore.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env',
                content: 'ANTHROPIC_API_KEY=sk-ant-api03-...',
              },
            ],
          },
          {
            heading: '4. (Optional) Make Anthropic the default ContentForge provider',
            body: 'The project defaults to Vertex AI. To switch, change the provider env var and restart your Functions emulator.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env',
                content:
                  'CONTENTFORGE_AI_PROVIDER=anthropic\nCONTENTFORGE_ANTHROPIC_DRAFT_MODEL=claude-sonnet-4-6\nCONTENTFORGE_ANTHROPIC_ANALYSIS_MODEL=claude-sonnet-4-6',
              },
            ],
          },
          {
            heading: '5. Enable in AI Engine',
            body: 'Go to /admin/ai-engine → AI Services → Claude (Anthropic) → toggle On → click Test. A green "Connected" badge confirms the key works.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Available models',
            body: 'Choose based on your cost/quality trade-off. Sonnet is the recommended default for most HCW tasks.',
            codes: [
              {
                lang: 'text',
                label: 'Model reference',
                content:
                  'claude-opus-4-6          — Most capable. Best for complex analysis. ~$15/1M in, $75/1M out\n' +
                  'claude-sonnet-4-6        — Balanced speed/quality. Recommended default. ~$3/1M in, $15/1M out\n' +
                  'claude-haiku-4-5-20251001— Fastest and cheapest. Good for short tasks. ~$0.80/1M in, $4/1M out',
              },
            ],
          },
          {
            heading: 'Via the AI Engine Playground',
            body: 'Navigate to /admin/ai-engine → Playground → select "Claude (Anthropic)" and your model. Write a system prompt and user message, then click Send. Token counts and estimated cost are shown after each response.',
            codes: [],
          },
          {
            heading: 'Direct API call (for custom Functions)',
            body: 'Use the existing callProvider() helper from ai-model-router.js inside any Cloud Function.',
            codes: [
              {
                lang: 'js',
                label: 'functions/index.js (example)',
                content:
                  "const { callProvider } = require('./lib/ai-model-router');\n\n" +
                  'const result = await callProvider({\n' +
                  "  provider: 'anthropic',\n" +
                  "  model: 'claude-sonnet-4-6',\n" +
                  "  prompt: 'Summarize this article in 3 bullet points.',\n" +
                  "  systemPrompt: 'You are a helpful content editor.',\n" +
                  '});\n\n' +
                  'console.log(result.text);',
              },
            ],
          },
          {
            heading: 'Prompt caching (automatic)',
            body: 'The callAnthropic() implementation in ai-model-router.js automatically applies Anthropic prompt caching to large system prompts using the ephemeral cache_control type. Cached tokens cost 10% of the normal input price.',
            codes: [],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Disable in AI Engine',
            body: 'Go to /admin/ai-engine → AI Services → Claude (Anthropic) → toggle Off. This prevents the provider from being used in the Playground.',
            codes: [],
          },
          {
            heading: 'Remove the API key',
            body: 'Delete the ANTHROPIC_API_KEY line from functions/.env and redeploy Functions.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env — remove this line',
                content: '# ANTHROPIC_API_KEY=sk-ant-...',
              },
            ],
          },
          {
            heading: 'Revoke the key in Console',
            body: 'For security, also revoke the key in the Anthropic Console → API Keys → Delete.',
            codes: [],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Extended context (200K tokens)',
            body: 'All Claude 3+ models support 200K token context windows. The current callAnthropic() implementation sets max_tokens: 4096 for output — increase this for longer completions.',
            codes: [
              {
                lang: 'js',
                label: 'functions/lib/ai-model-router.js — adjust max_tokens',
                content: "max_tokens: 8192,  // increase up to model's output limit",
              },
            ],
          },
          {
            heading: 'Streaming responses',
            body: "The current implementation uses non-streaming mode. For real-time output in the UI, implement streaming using the Anthropic SDK's stream() method.",
            codes: [
              {
                lang: 'js',
                label: 'Streaming example (SDK)',
                content:
                  "import Anthropic from '@anthropic-ai/sdk';\n\n" +
                  'const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });\n\n' +
                  'const stream = client.messages.stream({\n' +
                  "  model: 'claude-sonnet-4-6',\n" +
                  '  max_tokens: 1024,\n' +
                  "  messages: [{ role: 'user', content: 'Hello' }],\n" +
                  '});\n\n' +
                  'for await (const chunk of stream) {\n' +
                  "  process.stdout.write(chunk.delta?.text ?? '');\n" +
                  '}',
              },
            ],
          },
          {
            heading: 'Rate limits',
            body: 'Anthropic rate limits are per API key and scale with your usage tier. Tier 1 (new accounts) starts at 50,000 TPM (tokens per minute). The ai-model-router.js withRetry() function handles 429 rate-limit errors automatically with exponential backoff.',
            codes: [],
          },
        ],
      },
    },
    references: [
      { label: 'Anthropic API Documentation', url: 'https://docs.anthropic.com' },
      {
        label: 'Claude Models Overview',
        url: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
      },
      { label: 'Anthropic Console', url: 'https://console.anthropic.com' },
      {
        label: 'Prompt Caching Guide',
        url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching',
      },
    ],
  },

  // ── Google Vertex AI (Gemini) ────────────────────────────────────────────
  vertex: {
    id: 'vertex',
    name: 'Gemini (Google Vertex AI)',
    type: 'ai_provider',
    tagline: "Google's Gemini models — the active default provider for HCW.",
    requirements: [
      {
        label: 'Google Cloud account',
        detail: 'cloud.google.com — $300 free credit for new accounts',
        required: true,
      },
      {
        label: 'GCP Project with billing',
        detail: 'Project hybridcloudworks-61e8d already configured',
        required: true,
      },
      {
        label: 'Vertex AI API enabled',
        detail: 'Already enabled for this project',
        required: true,
      },
      {
        label: 'ADC (Application Default Credentials)',
        detail: 'Automatic in Cloud Functions; for local dev: run gcloud auth',
        required: true,
      },
    ],
    hcwUses: [
      {
        feature: 'ContentForge Pipeline',
        usage:
          'PRIMARY provider — all draft, analysis, and multimodal operations by default (CONTENTFORGE_AI_PROVIDER=vertex)',
        files: ['functions/lib/ai-model-router.js'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'Cover Image Generation',
        usage: 'Imagen 4 (google/imagen-4-fast) generates article cover images via Replicate',
        files: ['functions/index.js'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'AI Engine Playground',
        usage: 'Immediately available — no key setup needed',
        files: ['functions/index.js (aiProxy)'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'createContentFromRecording',
        usage: 'Summarizes Plaud transcripts into content drafts (planned)',
        files: ['functions/index.js (to be implemented)'],
        status: HCW_STATUS.PLANNED,
      },
    ],
    sections: {
      install: {
        title: 'Install & Configure',
        steps: [
          {
            heading: 'Already active — no setup required for Cloud Functions',
            body: 'Vertex AI is the current default. In Firebase Cloud Functions, Application Default Credentials (ADC) are automatically available — no API key or credentials file needed. The @google-cloud/vertexai SDK is already in functions/package.json.',
            codes: [],
          },
          {
            heading: 'Local development setup',
            body: 'For running Cloud Functions locally with the emulator, authenticate with your Google Cloud account.',
            codes: [
              {
                lang: 'bash',
                label: 'Terminal',
                content:
                  'gcloud auth application-default login\ngcloud config set project hybridcloudworks-61e8d',
              },
            ],
          },
          {
            heading: 'Verify the active model configuration',
            body: 'The current model assignments in functions/.env control which Gemini model handles each task type.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env — current settings',
                content:
                  'CONTENTFORGE_AI_PROVIDER=vertex\n' +
                  'CONTENTFORGE_VERTEX_LOCATION=us-central1\n' +
                  'CONTENTFORGE_VERTEX_DRAFT_MODEL=gemini-2.5-flash-lite\n' +
                  'CONTENTFORGE_VERTEX_ANALYSIS_MODEL=gemini-2.5-flash\n' +
                  'CONTENTFORGE_VERTEX_MULTIMODAL_MODEL=gemini-2.5-flash',
              },
            ],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Available models',
            body: 'Gemini 2.5 Flash is the recommended balance of speed and capability. Flash-Lite is cheapest for simple tasks.',
            codes: [
              {
                lang: 'text',
                label: 'Model reference',
                content:
                  'gemini-2.5-pro        — Most capable. Best for complex reasoning. ~$3.50/1M in, $10.50/1M out\n' +
                  'gemini-2.5-flash      — Balanced default. ~$0.30/1M in, $2.50/1M out\n' +
                  'gemini-2.5-flash-lite — Fastest, cheapest. ~$0.10/1M in, $0.40/1M out',
              },
            ],
          },
          {
            heading: 'Change the model for a specific task type',
            body: 'Update the relevant env var in functions/.env and redeploy. Changes take effect on the next function invocation.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env',
                content:
                  '# Upgrade drafts to the Pro model for higher quality\nCONTENTFORGE_VERTEX_DRAFT_MODEL=gemini-2.5-pro',
              },
            ],
          },
          {
            heading: 'Via the AI Engine Playground',
            body: 'Vertex AI is available immediately in the Playground — no additional setup. Select "Gemini (Google Vertex AI)" and choose your model.',
            codes: [],
          },
        ],
      },
      uninstall: {
        title: 'Switch Away',
        steps: [
          {
            heading: 'Change the default provider',
            body: 'Vertex AI cannot be uninstalled (it uses ADC, not a revocable key). To stop using it, switch CONTENTFORGE_AI_PROVIDER to another provider.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env',
                content: 'CONTENTFORGE_AI_PROVIDER=anthropic  # or openai',
              },
            ],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Multimodal input (images in prompts)',
            body: 'The callVertex() function already supports multimodal input via the parts parameter. Pass base64-encoded images alongside text to analyze visual content.',
            codes: [
              {
                lang: 'js',
                label: 'Multimodal call via generateJsonResponse()',
                content:
                  'const result = await generateJsonResponse({\n' +
                  "  prompt: 'Describe what you see and extract any text.',\n" +
                  '  parts: [\n' +
                  "    { text: 'Analyze this image:' },\n" +
                  "    { inlineData: { mimeType: 'image/jpeg', data: base64String } },\n" +
                  '  ],\n' +
                  "  purpose: 'multimodal',\n" +
                  '});',
              },
            ],
          },
          {
            heading: 'Grounding with Google Search',
            body: 'Gemini can be grounded to Google Search results for up-to-date information. This is a Vertex AI feature — add the grounding config to the generateContent() call.',
            codes: [
              {
                lang: 'js',
                label: 'Grounding config',
                content:
                  'const generativeModel = vertexAI.getGenerativeModel({\n' +
                  "  model: 'gemini-2.5-flash',\n" +
                  '  tools: [{ googleSearch: {} }],\n' +
                  '});',
              },
            ],
          },
          {
            heading: 'Safety settings',
            body: 'Adjust safety thresholds if the model blocks legitimate content. Use with caution in production.',
            codes: [
              {
                lang: 'js',
                label: 'Safety settings example',
                content:
                  'const generativeModel = vertexAI.getGenerativeModel({\n' +
                  "  model: 'gemini-2.5-flash',\n" +
                  '  safetySettings: [{\n' +
                  "    category: 'HARM_CATEGORY_DANGEROUS_CONTENT',\n" +
                  "    threshold: 'BLOCK_ONLY_HIGH',\n" +
                  '  }],\n' +
                  '});',
              },
            ],
          },
        ],
      },
    },
    references: [
      {
        label: 'Vertex AI Generative AI Docs',
        url: 'https://cloud.google.com/vertex-ai/generative-ai/docs',
      },
      {
        label: 'Gemini Model Reference',
        url: 'https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini',
      },
      {
        label: 'Application Default Credentials',
        url: 'https://cloud.google.com/docs/authentication/application-default-credentials',
      },
      { label: 'Google Cloud Console', url: 'https://console.cloud.google.com' },
    ],
  },

  // ── Perplexity ───────────────────────────────────────────────────────────
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity (Sonar)',
    type: 'ai_provider',
    tagline: 'Search-augmented AI with real-time web access and citations.',
    requirements: [
      { label: 'Perplexity account', detail: 'perplexity.ai — free to create', required: true },
      { label: 'API Key', detail: 'perplexity.ai/settings/api', required: true },
      { label: 'Billing', detail: 'Pay-as-you-go; $5 minimum deposit', required: true },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage: 'Research queries with live web citations — ideal for fact-checking article claims',
        files: ['functions/index.js (aiProxy)'],
        status: HCW_STATUS.AVAILABLE,
      },
      {
        feature: 'Content Research',
        usage: 'Could be used to auto-research topics before drafting — not yet wired in pipeline',
        files: [],
        status: HCW_STATUS.PLANNED,
      },
    ],
    sections: {
      install: {
        title: 'Install & Configure',
        steps: [
          {
            heading: '1. Create account and generate an API key',
            body: 'Sign up at perplexity.ai, then go to Settings → API → Generate Key.',
            codes: [],
          },
          {
            heading: '2. Add the key to functions/.env',
            body: 'Perplexity uses an OpenAI-compatible REST API — no SDK needed. The callPerplexity() function in ai-model-router.js handles all calls.',
            codes: [
              { lang: 'bash', label: 'functions/.env', content: 'PERPLEXITY_API_KEY=pplx-...' },
            ],
          },
          {
            heading: '3. Enable in AI Engine',
            body: 'Go to /admin/ai-engine → AI Services → Perplexity → toggle On → Test.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Models',
            body: 'sonar-pro is the recommended model — it performs web searches and returns cited responses. sonar is cheaper for lighter tasks.',
            codes: [
              {
                lang: 'text',
                label: 'Model reference',
                content:
                  'sonar-pro  — Web search + synthesis. Citations included. ~$3/1M in, $15/1M out\n' +
                  'sonar      — Lighter web search. ~$1/1M in, $1/1M out',
              },
            ],
          },
          {
            heading: 'Via the AI Engine Playground',
            body: 'Select "Perplexity (Sonar)" and sonar-pro. Responses include inline citation numbers — ask follow-up questions about the sources.',
            codes: [],
          },
          {
            heading: 'API call structure',
            body: 'Perplexity uses the same request format as OpenAI. The endpoint is different.',
            codes: [
              {
                lang: 'js',
                label: 'REST call (already in ai-model-router.js)',
                content:
                  'await axios.post(\n' +
                  "  'https://api.perplexity.ai/chat/completions',\n" +
                  '  {\n' +
                  "    model: 'sonar-pro',\n" +
                  '    messages: [\n' +
                  "      { role: 'system', content: 'Be precise.' },\n" +
                  "      { role: 'user', content: 'What are the latest AWS re:Invent announcements?' },\n" +
                  '    ],\n' +
                  '  },\n' +
                  '  { headers: { Authorization: `Bearer ${apiKey}` } }\n' +
                  ');',
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Remove key and disable',
            body: 'Toggle off in AI Engine, remove PERPLEXITY_API_KEY from functions/.env, and revoke the key at perplexity.ai/settings/api.',
            codes: [],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Search filters',
            body: 'Perplexity supports domain filtering and recency filtering. Add these to the request payload.',
            codes: [
              {
                lang: 'js',
                label: 'Search filter options',
                content:
                  '{\n' +
                  "  model: 'sonar-pro',\n" +
                  '  messages: [...],\n' +
                  "  search_domain_filter: ['aws.amazon.com', 'docs.microsoft.com'],\n" +
                  "  search_recency_filter: 'week',  // 'month' | 'week' | 'day' | 'hour'\n" +
                  '  return_citations: true,\n' +
                  '}',
              },
            ],
          },
        ],
      },
    },
    references: [
      { label: 'Perplexity API Documentation', url: 'https://docs.perplexity.ai' },
      { label: 'Perplexity API Settings', url: 'https://www.perplexity.ai/settings/api' },
    ],
  },

  // ── Azure OpenAI ─────────────────────────────────────────────────────────
  azure: {
    id: 'azure',
    name: 'Microsoft Azure OpenAI',
    type: 'ai_provider',
    tagline: 'GPT-4o via Azure — enterprise-grade with data residency and compliance.',
    requirements: [
      {
        label: 'Azure subscription',
        detail: 'azure.microsoft.com — free trial gives $200 credit',
        required: true,
      },
      {
        label: 'Azure OpenAI resource',
        detail: 'Created in Azure Portal → AI Services → Azure OpenAI',
        required: true,
      },
      {
        label: 'Model deployment',
        detail: 'Deploy gpt-4o in Azure OpenAI Studio → Deployments',
        required: true,
      },
      {
        label: 'API Key + Endpoint URL',
        detail: 'Both found in your Azure OpenAI resource → Keys and Endpoint',
        required: true,
      },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage:
          'GPT-4o via enterprise Azure endpoint — for testing Microsoft Copilot-equivalent capabilities',
        files: ['functions/index.js (aiProxy)'],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Install & Configure',
        steps: [
          {
            heading: '1. Create an Azure OpenAI resource',
            body: 'In the Azure Portal, go to Create a resource → AI + Machine Learning → Azure OpenAI. Select a region (East US or Sweden Central recommended for latest models). The resource creation takes a few minutes.',
            codes: [],
          },
          {
            heading: '2. Deploy a model',
            body: 'In Azure OpenAI Studio (oai.azure.com), go to Deployments → Create new deployment. Select gpt-4o and give it a deployment name (e.g. "gpt-4o-prod"). Note the deployment name — it is used in API calls.',
            codes: [],
          },
          {
            heading: '3. Get your endpoint and key',
            body: 'In the Azure Portal, open your Azure OpenAI resource → Keys and Endpoint. Copy Key 1 and the Endpoint URL.',
            codes: [],
          },
          {
            heading: '4. Add to functions/.env',
            body: 'Set all three variables. The AZURE_OPENAI_DEPLOYMENT value must exactly match the deployment name you created in step 2.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env',
                content:
                  'AZURE_OPENAI_API_KEY=your_azure_key_here\n' +
                  'AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com\n' +
                  'AZURE_OPENAI_DEPLOYMENT=gpt-4o-prod',
              },
            ],
          },
          {
            heading: '5. Enable in AI Engine',
            body: 'Go to /admin/ai-engine → AI Services → Microsoft Azure OpenAI → toggle On → Test.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'API version',
            body: 'Azure OpenAI API versions are date-pinned. The current HCW implementation uses api-version=2024-02-01, which supports gpt-4o. Always pin to a stable version in production.',
            codes: [
              {
                lang: 'text',
                label: 'Endpoint format',
                content:
                  'https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-01',
              },
            ],
          },
          {
            heading: 'Via the AI Engine Playground',
            body: 'Select "Microsoft Azure OpenAI" — the model shown will be your configured deployment. The interface is identical to the OpenAI playground.',
            codes: [],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Remove env vars and disable',
            body: 'Toggle off in AI Engine, remove the three AZURE_OPENAI_* vars from functions/.env, and optionally delete the Azure OpenAI resource in the Azure Portal to stop any charges.',
            codes: [],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Content filtering policies',
            body: 'Azure applies content safety filters by default. Configure custom policies in Azure OpenAI Studio → Content filters if the defaults are too restrictive for technical content.',
            codes: [],
          },
          {
            heading: 'Managed identity (recommended for production)',
            body: 'Instead of an API key, use Azure Managed Identity to authenticate — no credentials in env vars.',
            codes: [
              {
                lang: 'js',
                label: 'Managed identity header',
                content:
                  "const { DefaultAzureCredential } = require('@azure/identity');\n" +
                  'const credential = new DefaultAzureCredential();\n' +
                  "const token = await credential.getToken('https://cognitiveservices.azure.com/.default');\n" +
                  "headers['Authorization'] = `Bearer ${token.token}`;\n" +
                  "// Remove 'api-key' header when using managed identity",
              },
            ],
          },
        ],
      },
    },
    references: [
      {
        label: 'Azure OpenAI Service Documentation',
        url: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
      },
      { label: 'Azure OpenAI Studio', url: 'https://oai.azure.com' },
      {
        label: 'Supported Models by Region',
        url: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models',
      },
    ],
  },

  // ── AWS Bedrock (Nova) ───────────────────────────────────────────────────
  bedrock: {
    id: 'bedrock',
    name: 'AWS Bedrock (Amazon Nova)',
    type: 'ai_provider',
    tagline: 'Amazon Nova models via Bedrock — extremely cost-effective inference.',
    requirements: [
      { label: 'AWS account', detail: 'aws.amazon.com — free tier available', required: true },
      {
        label: 'Bedrock model access',
        detail: 'Request access in AWS Console → Amazon Bedrock → Model access',
        required: true,
      },
      {
        label: 'IAM user with bedrock permission',
        detail: 'Policy: bedrock:InvokeModel on the Nova model ARNs',
        required: true,
      },
      {
        label: 'Access Key + Secret',
        detail: 'Generated in IAM → Users → Security credentials',
        required: true,
      },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage: 'Very low cost inference for bulk or experimental tasks — Nova Lite is near-free',
        files: ['functions/index.js (aiProxy)'],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Install & Configure',
        steps: [
          {
            heading: '1. Request model access in AWS Console',
            body: 'Amazon Nova models require explicit access requests. In the AWS Console go to Amazon Bedrock → Model access → Manage model access → check Amazon Nova Lite and Nova Pro → Save changes. Access is usually granted within minutes.',
            codes: [],
          },
          {
            heading: '2. Create an IAM user',
            body: 'In IAM → Users → Create user, attach the AmazonBedrockFullAccess policy or a scoped policy. Under Security credentials → Create access key, select "Application running outside AWS". Copy the Access Key ID and Secret.',
            codes: [],
          },
          {
            heading: '3. Create a scoped IAM policy (recommended)',
            body: 'For production, use a minimal policy rather than the full access policy.',
            codes: [
              {
                lang: 'json',
                label: 'IAM Policy (minimal)',
                content: JSON.stringify(
                  {
                    Version: '2012-10-17',
                    Statement: [
                      {
                        Effect: 'Allow',
                        Action: ['bedrock:InvokeModel'],
                        Resource: [
                          'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0',
                          'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0',
                          'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0',
                        ],
                      },
                    ],
                  },
                  null,
                  2
                ),
              },
            ],
          },
          {
            heading: '4. Add credentials to functions/.env',
            body: 'Nova models are available in us-east-1 (and a few other regions). Use us-east-1 unless you have a specific reason.',
            codes: [
              {
                lang: 'bash',
                label: 'functions/.env',
                content:
                  'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n' +
                  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n' +
                  'AWS_REGION=us-east-1',
              },
            ],
          },
          {
            heading: '5. Enable in AI Engine',
            body: 'Go to /admin/ai-engine → AI Services → AWS Bedrock (Nova) → toggle On → Test.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Available Nova models',
            body: 'All three Nova tiers are available. Nova Micro has no image understanding; Nova Lite and Pro support multimodal input.',
            codes: [
              {
                lang: 'text',
                label: 'Model reference',
                content:
                  'amazon.nova-micro-v1:0  — Text only. Cheapest. ~$0.035/1M in, $0.14/1M out\n' +
                  'amazon.nova-lite-v1:0   — Text + image. Fast. ~$0.06/1M in, $0.24/1M out\n' +
                  'amazon.nova-pro-v1:0    — Most capable Nova. ~$0.80/1M in, $3.20/1M out',
              },
            ],
          },
          {
            heading: 'No SDK required',
            body: "The SigV4 signing algorithm is implemented directly in ai-model-router.js using Node.js's built-in crypto module. No @aws-sdk packages are needed.",
            codes: [],
          },
          {
            heading: 'Nova message format',
            body: 'Nova uses a slightly different request body than OpenAI. The implementation in callAWSNova() handles this automatically.',
            codes: [
              {
                lang: 'json',
                label: 'Nova request body format',
                content: JSON.stringify(
                  {
                    messages: [{ role: 'user', content: [{ text: 'Hello!' }] }],
                    system: [{ text: 'You are a helpful assistant.' }],
                    inferenceConfig: { max_new_tokens: 2048, temperature: 0.2 },
                  },
                  null,
                  2
                ),
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Remove credentials and disable',
            body: 'Toggle off in AI Engine, remove AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION from functions/.env. In the AWS Console, deactivate or delete the IAM access key.',
            codes: [],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Cross-region inference profiles',
            body: 'For higher throughput, use a cross-region inference profile instead of a direct model ID. This routes requests across multiple regions automatically.',
            codes: [
              {
                lang: 'bash',
                label: 'Cross-region profile ARN format',
                content:
                  'us.amazon.nova-lite-v1:0  # routes across US regions\neu.amazon.nova-lite-v1:0  # routes across EU regions',
              },
            ],
          },
          {
            heading: 'Bedrock Guardrails',
            body: 'Apply safety guardrails to all Nova calls via the GuardrailIdentifier and GuardrailVersion headers. Create guardrails in the Bedrock console.',
            codes: [],
          },
        ],
      },
    },
    references: [
      {
        label: 'Amazon Bedrock User Guide',
        url: 'https://docs.aws.amazon.com/bedrock/latest/userguide/',
      },
      {
        label: 'Amazon Nova Model IDs',
        url: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html',
      },
      {
        label: 'Bedrock InvokeModel API',
        url: 'https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html',
      },
    ],
  },

  // ── NotebookLM ───────────────────────────────────────────────────────────
  notebooklm: {
    id: 'notebooklm',
    name: 'NotebookLM (Google)',
    type: 'ai_provider',
    tagline: "Google's research assistant — no public API available yet.",
    requirements: [
      { label: 'Google account', detail: 'notebooklm.google.com', required: true },
      { label: 'Public API', detail: 'NOT YET AVAILABLE as of May 2026', required: true },
    ],
    hcwUses: [
      {
        feature: 'AI Engine',
        usage: 'Reserved slot — integration will be added when Google releases a public API',
        files: [],
        status: HCW_STATUS.PLANNED,
      },
    ],
    sections: {
      install: {
        title: 'Status',
        steps: [
          {
            heading: 'No public API',
            body: 'As of May 2026, Google NotebookLM does not provide a public REST API or MCP server. The product is web-only at notebooklm.google.com. This slot is reserved in the AI Engine for when Google opens programmatic access.',
            codes: [],
          },
          {
            heading: 'Workaround — manual use',
            body: 'You can manually use NotebookLM by uploading HCW content (exported articles, transcripts) via the web interface. To connect it to HCW programmatically, check this page when a public API is announced.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Not yet available',
            body: 'No API integration possible until Google releases developer access.',
            codes: [],
          },
        ],
      },
      uninstall: { title: 'N/A', steps: [] },
      advanced: { title: 'N/A', steps: [] },
    },
    references: [
      { label: 'NotebookLM', url: 'https://notebooklm.google.com' },
      {
        label: 'NotebookLM Blog (stay updated)',
        url: 'https://blog.google/technology/ai/notebooklm-google-ai/',
      },
    ],
  },

  // ── Plaud MCP ────────────────────────────────────────────────────────────
  plaud: {
    id: 'plaud',
    name: 'Plaud (Voice Recordings)',
    type: 'mcp_server',
    tagline: 'Connect your Plaud recordings live — transcripts, AI notes, and search via MCP.',
    requirements: [
      { label: 'Plaud account', detail: 'plaud.ai — required for recordings', required: true },
      { label: 'Node.js ≥ 20', detail: 'For the MCP installer CLI', required: true },
      {
        label: 'OAuth token',
        detail: 'Generated via the MCP installer or Claude Web',
        required: true,
      },
    ],
    hcwUses: [
      {
        feature: 'Recordings Page — Library tab',
        usage:
          'Live list of all recordings via list_files; load transcripts on demand via get_transcript',
        files: ['src/pages/admin/RecordingsPage.jsx'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'Recordings Page — Connect tab',
        usage: 'OAuth token setup and connection test',
        files: ['src/pages/admin/RecordingsPage.jsx'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'ContentForge Pipeline',
        usage: 'Route a recording transcript into a content draft via createContentFromRecording',
        files: ['src/pages/admin/RecordingsPage.jsx', 'functions/index.js'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'AI Engine Playground',
        usage:
          'Call Plaud tools (list_files, get_transcript, get_note) directly from the Playground',
        files: ['src/pages/admin/AIEnginePage.jsx'],
        status: HCW_STATUS.ACTIVE,
      },
    ],
    sections: {
      install: {
        title: 'Install & Connect',
        steps: [
          {
            heading: 'Option A — CLI installer (recommended)',
            body: 'Run the Plaud MCP installer. It auto-detects local AI clients (Claude Desktop, Cursor, VS Code), writes their MCP config, and opens your browser for OAuth authorization.',
            codes: [
              {
                lang: 'bash',
                label: 'Terminal (Node.js ≥ 20 required)',
                content: 'npx -y @plaud-ai/mcp@latest install',
              },
            ],
          },
          {
            heading: 'Option B — Claude Web connector',
            body: 'In Claude Web (claude.ai), go to Settings → Connectors → Add custom connector and fill in the form.',
            codes: [
              {
                lang: 'text',
                label: 'Claude Web connector settings',
                content:
                  'Name:                Plaud\nRemote MCP server URL: https://mcp.plaud.ai/mcp',
              },
            ],
          },
          {
            heading: 'Copy your OAuth access token',
            body: 'After the CLI install, your token is stored at ~/.plaud/tokens-mcp.json. Open the file and copy the access_token value.',
            codes: [
              {
                lang: 'bash',
                label: 'Terminal — view the token file',
                content: 'cat ~/.plaud/tokens-mcp.json',
              },
            ],
          },
          {
            heading: 'Paste the token in HCW',
            body: 'Go to /admin/recordings → Connect tab → paste the token → Save & Test. The token is stored server-side in Cosmos DB and used by the Azure mcpProxy Function. It never returns to the browser after saving.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Available MCP tools',
            body: 'These tools are called by HCW via the Azure mcpProxy Function at https://mcp.plaud.ai/mcp.',
            codes: [
              {
                lang: 'text',
                label: 'Tool reference',
                content:
                  'list_files       — List recordings. Params: query, date_from (YYYY-MM-DD), date_to, page, page_size\n' +
                  'get_file         — Full recording details + 24h presigned audio URL. Params: id\n' +
                  'get_note         — AI summary, action items, key topics (Markdown). Params: id\n' +
                  'get_transcript   — Full transcript with timestamps and speaker labels. Params: id\n' +
                  'get_current_user — Your account details. No params.',
              },
            ],
          },
          {
            heading: 'Recordings page — Library tab',
            body: 'Once connected, navigate to /admin/recordings → Library tab. Your recordings appear immediately. Search by keyword or date range, expand any card to read the transcript, or click "Create Content" to route a transcript through the ContentForge pipeline.',
            codes: [],
          },
          {
            heading: 'Via the AI Engine Playground',
            body: 'Go to /admin/ai-engine → Playground → MCP Tool mode → select Plaud → list_files. Pass arguments as JSON.',
            codes: [
              {
                lang: 'json',
                label: 'list_files arguments example',
                content: JSON.stringify(
                  { query: 'standup', date_from: '2026-05-01', date_to: '2026-05-31' },
                  null,
                  2
                ),
              },
            ],
          },
          {
            heading: 'Plaud CLI (standalone terminal access)',
            body: 'You can also browse your recordings from the terminal without the HCW admin UI.',
            codes: [
              {
                lang: 'bash',
                label: 'Plaud CLI quick reference',
                content:
                  'npm install -g @plaud-ai/cli\n\n' +
                  'plaud login               # authorize via browser\n' +
                  'plaud files               # list recent recordings\n' +
                  'plaud search "Q2 review"  # search by keyword\n' +
                  'plaud transcript <id>     # read full transcript\n' +
                  'plaud summary <id>        # read AI summary\n' +
                  'plaud transcript <id> -o out.txt  # save to file',
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Remove OAuth token from HCW',
            body: 'In /admin/ai-engine → MCP Servers → Plaud → toggle Off. To delete the stored token, clear the oauthToken field from the mcp_servers/plaud document in Cosmos DB.',
            codes: [],
          },
          {
            heading: 'Remove local CLI and token files',
            body: 'If you installed the CLI or MCP package, clean up with these commands.',
            codes: [
              {
                lang: 'bash',
                label: 'Full local cleanup',
                content:
                  '# Uninstall MCP package\nnpm uninstall -g @plaud-ai/mcp\n\n' +
                  '# Uninstall CLI package\nnpm uninstall -g @plaud-ai/cli\n\n' +
                  '# Remove local token files\nrm -rf ~/.plaud',
              },
            ],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Token refresh',
            body: 'Plaud OAuth tokens expire. If the Library tab stops loading or you see 401 errors, re-run the installer (or re-authorize via Claude Web) and paste the new token in the Connect tab.',
            codes: [
              {
                lang: 'bash',
                label: 'Refresh MCP token',
                content:
                  'npx -y @plaud-ai/mcp@latest install\n# Re-authorize in browser, then copy the new access_token from ~/.plaud/tokens-mcp.json',
              },
            ],
          },
          {
            heading: 'Pagination for large libraries',
            body: 'list_files defaults to 20 recordings per page. Use page and page_size to navigate large libraries. Keyword search scans the 500 most recent recordings client-side.',
            codes: [
              {
                lang: 'json',
                label: 'Paginated list_files call',
                content: '{ "page": 2, "page_size": 50 }',
              },
            ],
          },
          {
            heading: 'Audio download',
            body: 'get_file returns a presigned_url for the audio file, valid for 24 hours. Use this to download recordings for external processing.',
            codes: [
              {
                lang: 'js',
                label: 'Download audio via presigned URL',
                content:
                  "const res = await aiEngine.mcpTool('plaud', 'get_file', { id: recordingId });\n" +
                  'const file = JSON.parse(res.result);\n' +
                  'const audioUrl = file.presigned_url;  // valid 24 hours\n' +
                  '// Use in an <audio> element or download with fetch()',
              },
            ],
          },
          {
            heading: 'Skills (pre-built prompt workflows)',
            body: 'The Plaud MCP includes built-in skills that trigger on natural language phrases inside AI clients like Claude Desktop.',
            codes: [
              {
                lang: 'text',
                label: 'Available skills',
                content:
                  'plaud-browse   → "list my recordings", "show recent files"\n' +
                  'plaud-find     → "find the Weekly Sync", "the meeting from Monday"\n' +
                  'plaud-read     → "show the transcript", "summarize this recording"\n' +
                  'plaud-digest   → "weekly report", "what meetings did I have this week"\n' +
                  'plaud-followup → "draft a follow-up email", "list the action items"\n' +
                  'plaud-export   → "save to Notion", "post to Slack"',
              },
            ],
          },
        ],
      },
    },
    references: [
      {
        label: 'Plaud MCP Documentation',
        url: 'https://docs.plaud.ai/documentation/plaud_app/mcp',
      },
      {
        label: 'Plaud CLI Documentation',
        url: 'https://docs.plaud.ai/documentation/plaud_app/cli',
      },
      { label: 'Plaud Developer Platform', url: 'https://docs.plaud.ai/documentation/index.md' },
      { label: 'Plaud App', url: 'https://plaud.ai' },
    ],
  },

  // ── Firecrawl ─────────────────────────────────────────────────────────────
  firecrawl: {
    id: 'firecrawl',
    name: 'Firecrawl',
    type: 'mcp_server',
    tagline: 'Web scraping and content extraction — already powering HCW content discovery.',
    requirements: [
      {
        label: 'Firecrawl account',
        detail: 'firecrawl.dev — free tier: 500 credits/month',
        required: true,
      },
      { label: 'API Key', detail: 'Dashboard → API Keys', required: true },
    ],
    hcwUses: [
      {
        feature: 'Content Scraping Pipeline',
        usage:
          'Fetches and converts web pages to clean Markdown for ContentForge ingestion using @mendable/firecrawl-js SDK',
        files: ['functions/index.js (scrape functions)'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'Scrape Benchmark',
        usage: 'functions/test-scrape-fallback.js runs batch scraping quality tests',
        files: ['functions/test-scrape-fallback.js'],
        status: HCW_STATUS.ACTIVE,
      },
      {
        feature: 'AI Engine MCP',
        usage: 'Access Firecrawl tools via mcpProxy for Playground-based scraping',
        files: ['src/pages/admin/AIEnginePage.jsx'],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Install & Configure',
        steps: [
          {
            heading: 'Configure the Azure MCP proxy',
            body: 'The MCP proxy reads FIRECRAWL_API_KEY from the Azure Function App settings. In production, store it as an App Setting backed by Key Vault; do not put it in functions/.env or source control.',
            codes: [
              {
                lang: 'text',
                label: 'Azure Function App setting',
                content: 'FIRECRAWL_API_KEY=fc-...',
              },
            ],
          },
          {
            heading: 'Enable via MCP (for Playground access)',
            body: 'To call Firecrawl via the AI Engine MCP Servers tab, ensure the MCP server URL is set and toggle it on.',
            codes: [
              {
                lang: 'text',
                label: 'Firecrawl MCP server settings',
                content:
                  'Name:    Firecrawl\nURL:     https://mcp.firecrawl.dev/sse\nAuth:    FIRECRAWL_API_KEY (env var, already set)',
              },
            ],
          },
          {
            heading: 'If you need a new API key',
            body: 'Get a key at firecrawl.dev → Dashboard → API Keys. Add it to the Azure Function App settings, preferably as a Key Vault reference.',
            codes: [
              {
                lang: 'text',
                label: 'Azure Function App setting',
                content: 'FIRECRAWL_API_KEY=fc-...',
              },
            ],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Scrape a single URL',
            body: 'Returns clean Markdown from any web page, including JavaScript-rendered content.',
            codes: [
              {
                lang: 'js',
                label: 'SDK usage in Cloud Functions',
                content:
                  "const FirecrawlApp = require('@mendable/firecrawl-js').default;\n\n" +
                  'const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });\n' +
                  "const result = await app.scrapeUrl('https://example.com/article', {\n" +
                  "  formats: ['markdown'],\n" +
                  '});\n\nconsole.log(result.markdown);',
              },
            ],
          },
          {
            heading: 'MCP tool via Playground',
            body: 'In /admin/ai-engine → Playground → MCP Tool → Firecrawl, call the scrape tool.',
            codes: [
              {
                lang: 'json',
                label: 'scrape tool arguments',
                content: '{ "url": "https://example.com/article", "formats": ["markdown"] }',
              },
            ],
          },
          {
            heading: 'Crawl an entire site',
            body: 'The crawl tool recursively fetches all pages from a domain — useful for auditing competitor sites.',
            codes: [
              {
                lang: 'js',
                label: 'Crawl a site',
                content:
                  "const crawlResult = await app.crawlUrl('https://example.com', {\n" +
                  '  limit: 50,\n' +
                  "  scrapeOptions: { formats: ['markdown'] },\n" +
                  '});',
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Disable the MCP server',
            body: 'Toggle off in /admin/ai-engine → MCP Servers → Firecrawl. The SDK usage in functions/ is separate and will continue working.',
            codes: [],
          },
          {
            heading: 'Remove the API key',
            body: 'Remove FIRECRAWL_API_KEY from the Azure Function App settings / Key Vault and revoke the key in your Firecrawl dashboard.',
            codes: [],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Structured data extraction',
            body: 'Use the extract mode with a JSON schema to pull structured data from any page — no CSS selectors needed.',
            codes: [
              {
                lang: 'js',
                label: 'LLM-powered extraction',
                content:
                  "const result = await app.scrapeUrl('https://example.com/product', {\n" +
                  "  formats: ['extract'],\n" +
                  '  extract: {\n' +
                  '    schema: {\n' +
                  "      type: 'object',\n" +
                  '      properties: {\n' +
                  "        title: { type: 'string' },\n" +
                  "        price: { type: 'number' },\n" +
                  "        description: { type: 'string' },\n" +
                  '      },\n' +
                  '    },\n' +
                  '  },\n' +
                  '});',
              },
            ],
          },
          {
            heading: 'Credit usage',
            body: 'Scraping one URL costs 1 credit. Crawling costs 1 credit per page. The free tier provides 500 credits/month. Monitor usage in the Firecrawl Dashboard.',
            codes: [],
          },
        ],
      },
    },
    references: [
      { label: 'Firecrawl Documentation', url: 'https://docs.firecrawl.dev' },
      { label: 'Firecrawl Dashboard', url: 'https://firecrawl.dev' },
      {
        label: 'Firecrawl JS SDK on npm',
        url: 'https://www.npmjs.com/package/@mendable/firecrawl-js',
      },
    ],
  },

  // ── Brave Search ─────────────────────────────────────────────────────────
  'brave-search': {
    id: 'brave-search',
    name: 'Brave Search',
    type: 'mcp_server',
    tagline: 'Real-time, privacy-respecting web search — no tracking, independent index.',
    requirements: [
      {
        label: 'Brave Search API account',
        detail: 'api.search.brave.com — free tier: 2,000 req/month',
        required: true,
      },
      { label: 'API Key', detail: 'Dashboard → Applications → Create app', required: true },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage: 'Live web search results for research and fact-checking content',
        files: ['src/pages/admin/AIEnginePage.jsx (mcpProxy)'],
        status: HCW_STATUS.AVAILABLE,
      },
      {
        feature: 'Content Research',
        usage: 'Could be integrated into ContentForge to auto-research topics before AI drafting',
        files: [],
        status: HCW_STATUS.PLANNED,
      },
    ],
    sections: {
      install: {
        title: 'Install & Configure',
        steps: [
          {
            heading: '1. Create a Brave Search API account',
            body: 'Sign up at api.search.brave.com. The free tier gives 2,000 requests/month with no credit card required.',
            codes: [],
          },
          {
            heading: '2. Create an application and get an API key',
            body: 'In the Brave Search API Dashboard go to Applications → Create Application. Select the API plans you need (Web Search is sufficient). Copy the API key.',
            codes: [],
          },
          {
            heading: '3. Add the key to Azure Function App settings',
            body: 'The Azure mcpProxy Function reads this key when calling the Brave Search MCP server. Prefer a Key Vault reference for production.',
            codes: [
              {
                lang: 'text',
                label: 'Azure Function App setting',
                content: 'BRAVE_API_KEY=BSA...',
              },
            ],
          },
          {
            heading: '4. Enable in AI Engine',
            body: 'Go to /admin/ai-engine → MCP Servers → Brave Search → toggle On → Sync Tools.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Web search via Playground',
            body: 'Go to /admin/ai-engine → Playground → MCP Tool → Brave Search → select brave_web_search.',
            codes: [
              {
                lang: 'json',
                label: 'brave_web_search arguments',
                content: '{ "query": "AWS re:Invent 2026 announcements", "count": 10 }',
              },
            ],
          },
          {
            heading: 'Combine with AI — search then summarize',
            body: 'Use the Playground to first call Brave Search, then paste the results into an AI provider call to get a synthesized summary.',
            codes: [],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Disable and remove key',
            body: 'Toggle off in AI Engine → MCP Servers → Brave Search. Remove BRAVE_API_KEY from the Azure Function App settings / Key Vault and revoke the application in the Brave Search API Dashboard.',
            codes: [],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Search parameters',
            body: 'Brave Search supports country targeting, safe search, and freshness filtering.',
            codes: [
              {
                lang: 'json',
                label: 'Advanced search arguments',
                content: JSON.stringify(
                  {
                    query: 'cloud architecture trends',
                    count: 5,
                    country: 'US',
                    search_lang: 'en',
                    freshness: 'pw',
                    safesearch: 'moderate',
                  },
                  null,
                  2
                ),
              },
            ],
          },
        ],
      },
    },
    references: [
      {
        label: 'Brave Search API Documentation',
        url: 'https://api.search.brave.com/app/documentation/web-search/get-started',
      },
      { label: 'Brave Search API Dashboard', url: 'https://api.search.brave.com/app/dashboard' },
    ],
  },

  // ── Context7 ─────────────────────────────────────────────────────────────
  context7: {
    id: 'context7',
    name: 'Context7 (Library Docs)',
    type: 'mcp_server',
    tagline: 'Up-to-date documentation for any npm/PyPI/crates package — free, no API key.',
    requirements: [
      { label: 'No account required', detail: 'Free public MCP server', required: false },
      { label: 'No API key', detail: 'Unauthenticated access', required: false },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage:
          'Look up current docs for any library used in HCW (React, Firebase, Vite, etc.) without leaving the admin UI',
        files: ['src/pages/admin/AIEnginePage.jsx (mcpProxy)'],
        status: HCW_STATUS.AVAILABLE,
      },
      {
        feature: 'Development Assistance',
        usage:
          'Resolve version-specific API questions for packages in functions/package.json or package.json',
        files: [],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Enable (no credentials required)',
        steps: [
          {
            heading: 'Toggle on in AI Engine',
            body: "Go to /admin/ai-engine → MCP Servers → Context7 → toggle On → click Sync Tools. No API key or account is required — it's a free public server.",
            codes: [],
          },
          {
            heading: 'MCP server URL',
            body: 'The server is pre-configured with the correct URL.',
            codes: [
              {
                lang: 'text',
                label: 'MCP server details',
                content:
                  'URL:       https://mcp.context7.com/mcp\nTransport: HTTP (Streamable HTTP)\nAuth:      None',
              },
            ],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Step 1 — Resolve the library ID',
            body: 'First, resolve the exact library ID for the package you want docs for.',
            codes: [
              {
                lang: 'json',
                label: 'resolve-library-id arguments',
                content: '{ "libraryName": "firebase" }',
              },
            ],
          },
          {
            heading: 'Step 2 — Get the docs',
            body: 'Use the resolved library ID (e.g. "/firebase/firebase-js-sdk") to fetch documentation. Optionally specify a version and topic.',
            codes: [
              {
                lang: 'json',
                label: 'get-library-docs arguments',
                content: JSON.stringify(
                  {
                    context7CompatibleLibraryID: '/firebase/firebase-js-sdk',
                    topic: 'firestore',
                    tokens: 5000,
                  },
                  null,
                  2
                ),
              },
            ],
          },
          {
            heading: 'Common HCW library IDs',
            body: 'These are frequently useful when debugging HCW code.',
            codes: [
              {
                lang: 'text',
                label: 'Frequently used library IDs',
                content:
                  'React:              /facebook/react\n' +
                  'Firebase JS SDK:    /firebase/firebase-js-sdk\n' +
                  'React Router:       /remix-run/react-router\n' +
                  'Vite:               /vitejs/vite\n' +
                  'Tailwind CSS:       /tailwindlabs/tailwindcss\n' +
                  'Axios:              /axios/axios',
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disable',
        steps: [
          {
            heading: 'Toggle off',
            body: 'Go to /admin/ai-engine → MCP Servers → Context7 → toggle Off. No credentials to revoke.',
            codes: [],
          },
        ],
      },
      advanced: {
        title: 'Advanced',
        steps: [
          {
            heading: 'Token budget',
            body: 'The tokens parameter controls how many tokens of documentation to return. Increase it for larger, more complete docs. The default is 5,000.',
            codes: [
              {
                lang: 'json',
                label: 'Large docs request',
                content: '{ "context7CompatibleLibraryID": "/vitejs/vite", "tokens": 15000 }',
              },
            ],
          },
          {
            heading: 'Version-specific docs',
            body: 'Use the version parameter to get docs for a specific release — critical when your project pins a non-latest version.',
            codes: [
              {
                lang: 'json',
                label: 'Version-pinned request',
                content:
                  '{ "context7CompatibleLibraryID": "/facebook/react", "version": "18.3.0", "topic": "hooks" }',
              },
            ],
          },
        ],
      },
    },
    references: [
      { label: 'Context7 Website', url: 'https://context7.com' },
      { label: 'Context7 GitHub', url: 'https://github.com/upstash/context7' },
    ],
  },

  // ── AWS Knowledge Base ───────────────────────────────────────────────────
  'aws-knowledge-mcp': {
    id: 'aws-knowledge-mcp',
    name: 'AWS Knowledge Base',
    type: 'mcp_server',
    tagline: 'Retrieve AWS documentation, architecture patterns, and knowledge base details.',
    requirements: [
      {
        label: 'Cluster Access',
        detail: 'Runs inside the virtual network/cluster',
        required: true,
      },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage:
          'Query and retrieve official AWS documentation and architecture patterns directly inside the playground',
        files: ['src/pages/admin/AIEnginePage.jsx'],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Status & Connection',
        steps: [
          {
            heading: 'Internal Cluster Service',
            body: 'The AWS Knowledge MCP server is deployed within the internal cluster network and exposes its JSON-RPC endpoint at http://aws-docs-mcp:8000. It requires no additional API keys or installation.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Via the AI Engine Playground',
            body: 'Go to /admin/ai-engine → Playground → MCP Tool → AWS Knowledge Base, select a tool and query.',
            codes: [
              {
                lang: 'json',
                label: 'Arguments example',
                content: '{ "query": "S3 bucket lifecycle rules configuration" }',
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disable',
        steps: [
          {
            heading: 'Toggle Off',
            body: 'Go to /admin/ai-engine → MCP Servers → AWS Knowledge Base → toggle Off.',
            codes: [],
          },
        ],
      },
    },
    references: [
      {
        label: 'AWS Knowledge MCP Server Repository',
        url: 'https://github.com/awslabs/mcp-servers/tree/main/src/aws-knowledge-mcp-server',
      },
    ],
  },

  // ── Microsoft Learn ──────────────────────────────────────────────────────
  'microsoftdocs-mcp': {
    id: 'microsoftdocs-mcp',
    name: 'Microsoft Learn / Docs',
    type: 'mcp_server',
    tagline: 'Retrieve Microsoft documentation, learning modules, and platform resources.',
    requirements: [
      {
        label: 'Cluster Access',
        detail: 'Runs inside the virtual network/cluster',
        required: true,
      },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage: 'Query Microsoft Learn modules and platform references directly from the playground',
        files: ['src/pages/admin/AIEnginePage.jsx'],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Status & Connection',
        steps: [
          {
            heading: 'Internal Cluster Service',
            body: 'The Microsoft Learn MCP server is deployed within the internal cluster network and exposes its JSON-RPC endpoint at http://ms-learn-mcp:8000. It requires no additional API keys or installation.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Via the AI Engine Playground',
            body: 'Go to /admin/ai-engine → Playground → MCP Tool → Microsoft Learn / Docs, select a tool and query.',
            codes: [
              {
                lang: 'json',
                label: 'Arguments example',
                content: '{ "query": "Azure Kubernetes Service ingress Traefik setup" }',
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disable',
        steps: [
          {
            heading: 'Toggle Off',
            body: 'Go to /admin/ai-engine → MCP Servers → Microsoft Learn / Docs → toggle Off.',
            codes: [],
          },
        ],
      },
    },
    references: [
      {
        label: 'Microsoft Docs MCP Server Repository',
        url: 'https://github.com/microsoftdocs/mcp',
      },
    ],
  },

  // ── Draw.io ──────────────────────────────────────────────────────────────
  'drawio-mcp': {
    id: 'drawio-mcp',
    name: 'Draw.io (Diagrams.net)',
    type: 'mcp_server',
    tagline:
      'Generate, edit, and analyze draw.io diagrams programmatically from chat prompt inputs.',
    requirements: [
      {
        label: 'No installation required',
        detail: 'Connects to the public Draw.io app server',
        required: false,
      },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage:
          'Create and update diagrams or generate diagram XML structures directly using MCP tools',
        files: ['src/pages/admin/AIEnginePage.jsx'],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Connection',
        steps: [
          {
            heading: 'Public App Server',
            body: 'The Draw.io MCP server connects directly to the public app bridge at https://mcp.draw.io/mcp. No local setup or installation is required.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Create diagrams via the Playground',
            body: 'Select "Draw.io (Diagrams.net)" from the MCP server dropdown in the Playground and run the creation tools.',
            codes: [
              {
                lang: 'json',
                label: 'Arguments example',
                content:
                  '{\n  "prompt": "Create a flowchart showing a git push triggering a webhook that calls a cloud function"\n}',
              },
            ],
          },
        ],
      },
      uninstall: {
        title: 'Disable',
        steps: [
          {
            heading: 'Toggle Off',
            body: 'Go to /admin/ai-engine → MCP Servers → Draw.io (Diagrams.net) → toggle Off.',
            codes: [],
          },
        ],
      },
    },
    references: [{ label: 'Draw.io MCP Repository', url: 'https://github.com/jgraph/drawio-mcp' }],
  },

  // ── Hostinger ────────────────────────────────────────────────────────────
  'hostinger-mcp': {
    id: 'hostinger-mcp',
    name: 'Hostinger MCP',
    type: 'mcp_server',
    tagline:
      'Administer Hostinger resources (VPS, domains, DNS, and hosting) via the Hostinger API.',
    requirements: [
      { label: 'Hostinger account', detail: 'hPanel → Profile → API', required: true },
      {
        label: 'API Token',
        detail: 'Generated in Hostinger Panel, stored in Notion as VPS_API_TOKEN',
        required: true,
      },
    ],
    hcwUses: [
      {
        feature: 'AI Engine Playground',
        usage:
          'Perform administration actions, query VPS details, and manage DNS zones directly from the playground',
        files: ['src/pages/admin/AIEnginePage.jsx'],
        status: HCW_STATUS.AVAILABLE,
      },
    ],
    sections: {
      install: {
        title: 'Configure & Setup',
        steps: [
          {
            heading: '1. Stored in Notion',
            body: 'The Hostinger API token is securely managed in the Notion Secrets database under the key "VPS_API_TOKEN".',
            codes: [],
          },
          {
            heading: '2. Synchronize secrets',
            body: 'Run the setup script or trigger a secrets sync workflow to import the token from Notion to the Firebase functions environment.',
            codes: [
              { lang: 'bash', label: 'Terminal', content: 'node setup-api-keys-from-notion.js' },
            ],
          },
          {
            heading: '3. Enable in AI Engine',
            body: 'Go to /admin/ai-engine → MCP Servers → Hostinger MCP → toggle On → click Sync Tools.',
            codes: [],
          },
        ],
      },
      use: {
        title: 'Use',
        steps: [
          {
            heading: 'Query VPS info',
            body: 'Call VPS list tools to monitor VPS resource usage and list domains.',
            codes: [{ lang: 'json', label: 'Arguments example', content: '{}' }],
          },
        ],
      },
      uninstall: {
        title: 'Disconnect',
        steps: [
          {
            heading: 'Disable and clean secrets',
            body: 'Toggle Off in the AI Engine and optionally remove the VPS_API_TOKEN from the Cloud Functions secrets configurations.',
            codes: [],
          },
        ],
      },
    },
    references: [{ label: 'Hostinger API Repository', url: 'https://github.com/hostinger/api/' }],
  },
};

export default SERVICE_DOCS;
