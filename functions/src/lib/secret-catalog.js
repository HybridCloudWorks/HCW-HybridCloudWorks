/**
 * What the API-keys page may seed, in the sections it presents.
 *
 * ## Why a list in code when `06-seed-secret.ps1` reads `infra/main.tf`
 *
 * That script runs on an operator's desktop with the repository checked out.
 * The Function App does not have `infra/main.tf` at run time, so the catalogue
 * has to travel in the bundle. A list in code can drift from Terraform, and
 * drift here is the specific failure REVIEW.md §4.5 describes: app settings are
 * `UPPER_SNAKE_CASE`, vault secrets are `UPPER-KEBAB-CASE` because Key Vault
 * forbids underscores, and a mismatch resolves to nothing. The app deploys
 * clean and a missing credential presents as missing *data*, days later, in a
 * feature nobody was looking at.
 *
 * So `secret-catalog.test.js` reads `infra/main.tf` and asserts this table is
 * exactly the set of `@Microsoft.KeyVault(SecretUri=…secrets/NAME)` references
 * it declares, with the setting names paired as Terraform pairs them. Add a
 * reference without adding it here — or spell either name wrong — and CI fails
 * on a checkout with no Azure credentials and no Terraform binary. The page can
 * therefore never offer a secret the application cannot read.
 *
 * ## Why the page cannot invent a new name
 *
 * A secret with no `@Microsoft.KeyVault(…)` app setting pointing at it is
 * unreachable by application code — no setting, no environment variable,
 * nothing to read. Seeding one would put a live credential in the vault that
 * nothing consumes and nobody owns, which is how orphaned credentials happen.
 * Adding a *new* kind of key stays a code change, because the code has to learn
 * to read it in the same change.
 */

/**
 * Presentation sections, in display order.
 *
 * Grouped by what the reader is trying to do, not by vendor: someone fixing a
 * dead social post wants every social credential together, whichever companies
 * they belong to.
 */
export const SECRET_SECTIONS = Object.freeze([
  {
    id: 'ai',
    title: 'AI & generation',
    blurb:
      'The AI router picks a provider by key presence, in preference order. ' +
      'Removing a key here silently changes which model writes your content.',
  },
  {
    id: 'social',
    title: 'Social & audience',
    blurb: 'Publishing, broadcast and list credentials. Each path no-ops when its key is absent.',
  },
  {
    id: 'intel',
    title: 'Intelligence & research',
    blurb: 'Read-only lookups used by the inspector, link enrichment and episode research.',
  },
  {
    id: 'cloud',
    title: 'Cloud pricing (public catalogues)',
    blurb:
      'Read the three clouds’ PUBLIC price lists for the comparison tools. ' +
      'None of these bills this estate — that runs on Azure and is not charged through anything here.',
  },
  {
    id: 'platform',
    title: 'Site platform',
    blurb:
      'Shared secrets the site itself derives from. Rotating one of these changes live behaviour ' +
      'immediately: CLIENT-IP-SALT resets every rate-limit counter, and PREVIEW-SIGNING-SECRET ' +
      'invalidates every staging link already sent.',
  },
]);

/**
 * Every seedable secret.
 *
 * `setting` is the app-setting name (what `process.env` holds); `secret` is the
 * Key Vault secret name (what gets written). Both are asserted against
 * `infra/main.tf`. `probe` names the AI-router provider whose verdict can turn
 * this light red.
 *
 * `null` is the honest default and most entries have it. A non-null probe is a
 * PROMISE that something reports this credential's health, and the page prints
 * "no liveness check for this one" beside a green light that has none. Today
 * the only reporter is `ai/router.js`, which distinguishes a rejected key
 * (401/403) from a bad request — so only its three providers may carry a probe,
 * and `secret-catalog.test.js` holds that. Wiring a new reporter and setting a
 * probe is one change, not two.
 */
export const SECRET_CATALOG = Object.freeze([
  // ── AI & generation ──────────────────────────────────────────────────────
  {
    setting: 'GEMINI_API_KEY',
    secret: 'GEMINI-API-KEY',
    section: 'ai',
    label: 'Google Gemini',
    help: 'First in the router’s preference order, and the voice behind Listen & Learn.',
    probe: 'gemini',
  },
  {
    setting: 'ANTHROPIC_API_KEY',
    secret: 'ANTHROPIC-API-KEY',
    section: 'ai',
    label: 'Anthropic',
    help: 'Second in the router’s preference order.',
    probe: 'anthropic',
  },
  {
    setting: 'OPENAI_API_KEY',
    secret: 'OPENAI-API-KEY',
    section: 'ai',
    label: 'OpenAI',
    help: 'Third in the router’s preference order.',
    probe: 'openai',
  },
  {
    setting: 'PERPLEXITY_API_KEY',
    secret: 'PERPLEXITY-API-KEY',
    section: 'ai',
    label: 'Perplexity',
    help: 'Referenced but not reachable through the AI router today — it implements Gemini, OpenAI and Anthropic only.',
    probe: null,
  },
  {
    setting: 'REPLICATE_API_KEY',
    secret: 'REPLICATE-API-KEY',
    section: 'ai',
    label: 'Replicate',
    help: 'AI cover images. Absent, posts fall back to the default hero for their provider.',
    probe: null,
  },
  {
    setting: 'AZURE_SPEECH_KEY',
    secret: 'AZURE-SPEECH-KEY',
    section: 'ai',
    label: 'Azure AI Speech',
    help: 'Written, tested fallback for the day the preview Gemini TTS models retire.',
    probe: null,
  },

  // ── Social & audience ────────────────────────────────────────────────────
  {
    setting: 'PUBLER_API_KEY',
    secret: 'PUBLER-API-KEY',
    section: 'social',
    label: 'Publer — API key',
    help: 'Social auto-post. Absent, scheduled posts no-op rather than failing.',
    probe: null,
  },
  {
    setting: 'PUBLER_WORKSPACE_ID',
    secret: 'PUBLER-WORKSPACE-ID',
    section: 'social',
    label: 'Publer — workspace id',
    help: 'An identifier rather than a credential, but it travels with its key.',
    probe: null,
  },
  {
    setting: 'KLAVIYO_PRIVATE_KEY',
    secret: 'KLAVIYO-PRIVATE-KEY',
    section: 'social',
    label: 'Klaviyo — private key',
    help: 'Mailing list. Absent, subscribe calls no-op.',
    probe: null,
  },
  {
    setting: 'KLAVIYO_LIST_ID',
    secret: 'KLAVIYO-LIST-ID',
    section: 'social',
    label: 'Klaviyo — list id',
    help: 'An identifier rather than a credential, but it travels with its key.',
    probe: null,
  },
  {
    setting: 'TELEGRAM_BOT_TOKEN',
    secret: 'TELEGRAM-BOT-TOKEN',
    section: 'social',
    label: 'Telegram — bot token',
    help:
      'Approve/reject notifications. Rotating this INVALIDATES the registered webhook — ' +
      're-run scripts/cutover/04-telegram-webhook.ps1 afterwards.',
    probe: null,
  },
  {
    setting: 'TELEGRAM_CHAT_ID',
    secret: 'TELEGRAM-CHAT-ID',
    section: 'social',
    label: 'Telegram — chat id',
    help: 'Where notifications land. An identifier, not a credential.',
    probe: null,
  },

  // ── Intelligence & research ──────────────────────────────────────────────
  {
    setting: 'FIRECRAWL_API_KEY',
    secret: 'FIRECRAWL-API-KEY',
    section: 'intel',
    label: 'Firecrawl',
    help: 'Page fetch and extraction for the inspector.',
    probe: null,
  },
  {
    setting: 'LINKIE_API_KEY',
    secret: 'LINKIE-API-KEY',
    section: 'intel',
    label: 'Linkie',
    help: 'Link enrichment.',
    probe: null,
  },
  {
    setting: 'YOUTUBE_API_KEY',
    secret: 'YOUTUBE-API-KEY',
    section: 'intel',
    label: 'YouTube Data API',
    help: 'Curated “watch next” links. One certification costs ~505 of the default 10,000 daily quota units.',
    probe: null,
  },

  // ── Cloud pricing ────────────────────────────────────────────────────────
  {
    setting: 'AWS_ACCESS_KEY_ID',
    secret: 'AWS-ACCESS-KEY-ID',
    section: 'cloud',
    label: 'AWS — access key id',
    help: 'Price List Query API. Scope the IAM policy to pricing:GetProducts only.',
    probe: null,
  },
  {
    setting: 'AWS_SECRET_ACCESS_KEY',
    secret: 'AWS-SECRET-ACCESS-KEY',
    section: 'cloud',
    label: 'AWS — secret access key',
    help: 'Pairs with the access key id above. Both must be rotated together.',
    probe: null,
  },
  {
    setting: 'GCP_BILLING_API_KEY',
    secret: 'GCP-BILLING-API-KEY',
    section: 'cloud',
    label: 'Google Cloud Billing Catalog',
    help:
      'A restricted API key, which is what Google documents for this API. ' +
      'Absent, the GCP column is missing and AWS and Azure still render.',
    probe: null,
  },

  // ── Site platform ────────────────────────────────────────────────────────
  {
    setting: 'CF_ORIGIN_SECRET',
    secret: 'CF-ORIGIN-SECRET',
    section: 'platform',
    label: 'Cloudflare origin secret',
    help:
      'Proves a request arrived through Cloudflare. Rotating it requires the SAME value to be set ' +
      'on the Cloudflare side — until both match, anonymous submissions are refused in production.',
    probe: null,
  },
  {
    setting: 'CLIENT_IP_SALT',
    secret: 'CLIENT-IP-SALT',
    section: 'platform',
    label: 'Client IP salt',
    help: 'Salts rate-limit keys. Rotating it resets every live counter — which is sometimes the point.',
    probe: null,
  },
  {
    setting: 'PREVIEW_SIGNING_SECRET',
    secret: 'PREVIEW-SIGNING-SECRET',
    section: 'platform',
    label: 'Preview signing secret',
    help: 'Signs staging links. Rotating it invalidates every preview URL already sent.',
    probe: null,
  },
]);

/** Secrets that may be generated rather than pasted, and why only these. */
export const GENERATABLE_SECRETS = Object.freeze([
  // Both are values this estate INVENTS. Everything else is issued by an
  // upstream service, where a generated value is guaranteed wrong — and worse
  // than absent, because absent is a gray light and wrong is a green one.
  'PREVIEW-SIGNING-SECRET',
  'CLIENT-IP-SALT',
]);

const BY_SECRET = new Map(SECRET_CATALOG.map((entry) => [entry.secret, entry]));
const BY_SETTING = new Map(SECRET_CATALOG.map((entry) => [entry.setting, entry.secret]));

/**
 * App-setting name → Key Vault secret name.
 *
 * Through the catalogue, never by replacing underscores with hyphens. That
 * translation is right for every name here today and would still be the wrong
 * way to do it: the day a pair does not follow the pattern, a string transform
 * produces a plausible name for a secret that does not exist, and the caller
 * records a verdict against nothing. Returns null for an unknown setting.
 */
export function settingToSecret(setting) {
  return BY_SETTING.get(String(setting ?? '')) ?? null;
}

/** The catalogue entry for a vault secret name, or undefined. */
export function findBySecretName(name) {
  return BY_SECRET.get(String(name ?? ''));
}

/** Is this a secret the page is allowed to write? */
export function isSeedableSecret(name) {
  return BY_SECRET.has(String(name ?? ''));
}

/** May this secret be generated instead of pasted? */
export function isGeneratable(name) {
  return GENERATABLE_SECRETS.includes(String(name ?? ''));
}
