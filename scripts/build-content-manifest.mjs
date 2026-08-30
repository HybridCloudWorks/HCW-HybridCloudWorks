/**
 * Build the content manifest the frontend pre-renders article pages from.
 *
 * WHY A MANIFEST AND NOT A FETCH. `scripts/prerender.mjs` renders listing and
 * landing routes but deliberately skips every `/:provider/blog/:slug`, because
 * those pages need their article at render time and the build cannot get it:
 * CI reaches the public API through Cloudflare, which answers a GitHub runner
 * with a managed challenge (#175). Making the build depend on that would make
 * every deploy depend on a permanent bot-protection exception — a trade already
 * rejected on that issue.
 *
 * So the data comes the other way. This runs in a workflow that holds Azure
 * federated credentials, reads Cosmos directly with data-plane RBAC, and writes
 * a plain JSON file into the repository. The frontend build then needs no
 * credentials at all: it reads a file. That is the whole point — the frontend
 * deploy has `contents: read` and a Static Web Apps token, and should keep
 * having exactly that.
 *
 * The manifest is committed rather than passed as an artifact so a build is
 * reproducible from a checkout alone, and so a diff shows what changed about
 * the published set.
 *
 * KEYS MATCH `usePublicData`. Each entry is stored under the key that hook uses
 * for the same query — `article:<slug>` — so seeding is a lookup rather than a
 * translation. See frontend/src/hooks/prerenderData.js.
 *
 * PUBLISHED CONTENT ONLY. Drafts, scheduled and rejected items are excluded by
 * the query, not filtered afterwards: pre-rendering an unpublished article
 * would put it on a public URL at HTTP 200 and in the sitemap.
 *
 * Env:
 *   FUNCTION_ORIGIN   required — the Function App's own hostname, reached
 *                     through a per-run IP window. NOT the Cloudflare host.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
// NOT under public/. Vite copies public/ verbatim into dist, so a manifest
// there would be deployed and served — half a megabyte of article bodies that
// no visitor ever requests, because the browser gets its data from the API.
// This is build input only; scripts/prerender.mjs reads it from disk.
const OUT_PATH = join(ROOT, 'frontend', 'data', 'content-manifest.json');

/** Providers with a `/:provider/blog/:slug` route. Mirrors VALID_PROVIDERS. */
const PROVIDERS = [
  'azure',
  'aws',
  'gcp',
  'github',
  'terraform',
  'finops',
  'vmware',
  'ansible',
];

/**
 * Fetch the published corpus from the Function App's origin (T-718).
 *
 * THIS USED TO QUERY COSMOS DIRECTLY, and that one workload is what held the
 * `0.0.0.0` sentinel open on the Cosmos firewall — the switch admitting any
 * workload in any Azure tenant at the network layer. Moving the query into the
 * app, which runs inside the subnet the firewall already admits, is what let
 * that close. See wiki/0025-cosmos-firewall-datacenter-sentinel.md.
 *
 * THE ORIGIN HOSTNAME, NOT THE CLOUDFLARE ONE. A GitHub runner asking the
 * public host is served Cloudflare's Bot Fight Mode interstitial and a 403
 * (#175, and the reason ADR 0024 exists). The workflow opens a per-run App
 * Service IP allow rule for its own address instead and asks the origin
 * directly — the same window deploy-functions.yml already uses to probe
 * /api/health.
 *
 * No credential of any kind: the route is anonymous, and reaching it is the
 * authorization. That is why the window closes in an always() step.
 */
async function fetchPublished() {
  const origin = process.env.FUNCTION_ORIGIN;
  if (!origin) {
    throw new Error(
      'FUNCTION_ORIGIN is not set. Expected the Function App origin hostname, e.g. ' +
        'https://func-site-prod-cus-01.azurewebsites.net — NOT the Cloudflare host, which ' +
        'answers datacenter clients with a bot interstitial.'
    );
  }

  const url = `${origin.replace(/\/+$/, '')}/api/public/content-manifest`;
  const response = await fetch(url);
  if (!response.ok) {
    // 403 here is the shape to recognise: it means the origin window is shut,
    // so the runner's address is not on the app's allow list.
    throw new Error(
      `${url} answered ${response.status}. A 403 usually means the per-run origin window ` +
        'is closed or has not propagated; anything else is the app itself.'
    );
  }

  const body = await response.json();
  if (!body?.success || !Array.isArray(body.items)) {
    throw new Error(`${url} returned an unexpected body: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.items;
}

/** The provider segment an article's URL lives under. */
function providerOf(item) {
  const raw = String(item.cloudProvider || item['Cloud Provider'] || '')
    .toLowerCase()
    .trim();
  return PROVIDERS.includes(raw) ? raw : null;
}

function slugOf(item) {
  return String(item.slug || item.Slug || '').trim();
}

/**
 * The fields the article page renders. Everything else is dropped.
 *
 * A manifest is build input, not a database dump. The first version stored whole
 * documents and came to 3.0 MB for 24 articles, because a content document
 * carries FIVE near-duplicate renderings of the same body — `contentHtml` alone
 * was 1.97 MB, 65% of the file — plus `analysisPrompt`, the prompt used to
 * generate the article, which no reader ever sees. Projecting to what
 * `BlogDetailTemplate` actually reads removes about three quarters of it.
 *
 * `content-manifest.test.mjs` scans the template for `article.<field>` and fails
 * when one is missing here, so a field added to the page cannot silently render
 * blank in the pre-rendered HTML while working in the browser — which is the
 * worst version of this bug, since only a crawler would see it.
 */
export const ARTICLE_FIELDS = Object.freeze([
  // identity and routing
  'id',
  'slug',
  'Slug',
  'cloudProvider',
  'Cloud Provider',
  // the body, in the shapes the template looks for
  'Content',
  'content',
  'blogDraft',
  'code',
  'codeLanguage',
  'codeSnippet',
  'terraformCode',
  // headings and summary
  'Title',
  'title',
  'Summary',
  'summary',
  'description',
  'excerpt',
  'keyTopics',
  // taxonomy
  'Category',
  'category',
  'Tags',
  'tags',
  'language',
  // attribution and dates
  'Author',
  'siteAuthor',
  'editorAuthor',
  'createdByName',
  'publishedByName',
  'Published At',
  'publishedAt',
  'publishedDate',
  'datePublished',
  'blogPublishedAt',
  'ReadTime',
  'readTime',
  // media
  'imageUrl',
  'heroImageUrl',
  'contentImageUrl',
  'altCoverImage',
  'altCoverImageVariants',
  'aiImageUrls',
  'aiImageVariants',
  // outbound links
  'url',
  'sourceUrl',
  'Source URL',
  'repoUrl',
  'CD Url',
]);

/** Keep only the rendered fields, and only when present. */
function project(item) {
  const out = {};
  for (const field of ARTICLE_FIELDS) {
    if (item[field] !== undefined) out[field] = item[field];
  }
  return out;
}

export function buildManifest(items) {
  const routes = [];
  const data = {};
  const skipped = [];

  for (const item of items) {
    const slug = slugOf(item);
    const provider = providerOf(item);
    if (!slug) {
      skipped.push(`${item.id}: no slug`);
      continue;
    }
    if (!provider) {
      // Without a provider there is no URL to pre-render it at. The article is
      // still served by the SPA; it just has no static file.
      skipped.push(`${slug}: no recognised provider (${item.cloudProvider || 'unset'})`);
      continue;
    }
    routes.push(`/${provider}/blog/${slug}`);
    data[`article:${slug}`] = project(item);
  }

  return { generatedAt: null, routes, data, skipped };
}

async function main() {
  // Published only, and still asserted in the QUERY rather than filtered after
  // — the query just lives in the app now
  // (functions/src/lib/public-content-manifest.js), where it is pinned by an
  // exact-match test for that reason.
  const resources = await fetchPublished();

  const manifest = buildManifest(resources);
  manifest.generatedAt = new Date().toISOString();

  mkdirSync(dirname(OUT_PATH), { recursive: true });

  // Compare ignoring the timestamp, so an unchanged corpus does not produce a
  // commit whose only content is the time it ran.
  const next = JSON.stringify(manifest, null, 2);
  // Read straight through instead of existsSync-then-read. The check-then-use
  // pair is a race the single read does not have, and a file that disappeared
  // between the two calls is the same "no previous manifest" outcome as one
  // that was never there.
  let previous = null;
  try {
    previous = readFileSync(OUT_PATH, 'utf8');
  } catch {
    previous = null;
  }
  if (previous !== null) {
    const strip = (text) => text.replace(/"generatedAt": "[^"]*"/, '"generatedAt": ""');
    if (strip(previous) === strip(next)) {
      console.log(`[content-manifest] unchanged — ${manifest.routes.length} routes`);
      return;
    }
  }

  writeFileSync(OUT_PATH, next);
  console.log(
    `[content-manifest] ${manifest.routes.length} routes, ${resources.length} published items`
  );
  for (const reason of manifest.skipped) console.log(`  skipped ${reason}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly || process.env.FORCE_RUN === '1') {
  main().catch((error) => {
    console.error(`[content-manifest] FAILED: ${error?.message || error}`);
    process.exit(1);
  });
}
