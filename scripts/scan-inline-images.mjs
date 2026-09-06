/**
 * How many published articles still hotlink third-party images (issue #374).
 *
 * Reads the committed content manifest (frontend/data/content-manifest.json),
 * which holds the rendered body of every published article, so this needs no
 * credential and no network: it answers from the checkout. The publish step in
 * functions/src/lib/cms/inline-images.js re-hosts these at publish time; an
 * article listed here was published before that step existed and is re-hosted
 * by republishing it.
 *
 * Usage:  node scripts/scan-inline-images.mjs
 * Exit 0 always; the output is the report.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MANIFEST = join(ROOT, 'frontend', 'data', 'content-manifest.json');

const HTML_IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const MARKDOWN_IMG = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const OWN_HOSTS = new Set(['hybridcloudworks.com', 'www.hybridcloudworks.com']);

/**
 * Every body field joined, because the images are not always in the field
 * the page renders: the audited article of 2026-09-06 held an RSS stub in
 * `Content` and its eleven images in `content`. The publish step rewrites
 * every field, so the scan reads every field.
 */
export function bodyOf(article = {}) {
  return ['blogDraft', 'Content', 'content']
    .map((field) => (typeof article[field] === 'string' ? article[field] : ''))
    .join('\n');
}

/** Distinct third-party image hosts referenced by a body, with their URL counts. */
export function externalImageHosts(body) {
  const hosts = new Map();
  const consider = (raw) => {
    let url;
    try {
      url = new URL(String(raw || '').trim());
    } catch {
      return; // relative, data: or malformed — not a hotlink
    }
    if (!['http:', 'https:'].includes(url.protocol) || OWN_HOSTS.has(url.hostname)) return;
    hosts.set(url.hostname, (hosts.get(url.hostname) || 0) + 1);
  };
  for (const m of String(body).matchAll(HTML_IMG_SRC)) consider(m[1] ?? m[2]);
  for (const m of String(body).matchAll(MARKDOWN_IMG)) consider(m[1]);
  return hosts;
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const articles = Object.entries(manifest.data || {}).filter(([k]) => k.startsWith('article:'));
  const rows = [];
  for (const [key, article] of articles) {
    const hosts = externalImageHosts(bodyOf(article));
    if (hosts.size === 0) continue;
    const total = [...hosts.values()].reduce((a, b) => a + b, 0);
    rows.push({ slug: key.slice('article:'.length), total, hosts: [...hosts.keys()].sort() });
  }
  rows.sort((a, b) => b.total - a.total || a.slug.localeCompare(b.slug));
  console.log(
    `${rows.length} of ${articles.length} published articles hotlink third-party images (manifest generated ${manifest.generatedAt || 'unknown'})`
  );
  for (const row of rows) console.log(`  ${row.total}\t${row.slug}\t${row.hosts.join(', ')}`);
  if (rows.length)
    console.log('Re-host by republishing each article; the publish step rewrites the body.');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
