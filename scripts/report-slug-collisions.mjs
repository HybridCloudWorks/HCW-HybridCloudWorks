/**
 * Which published articles share a URL, and which of them therefore have none
 * (issue #400).
 *
 * Reads the committed content manifest (frontend/data/content-manifest.json),
 * so this needs no credential and no network: it answers from the checkout.
 * The manifest build already refuses to route a slug twice (#386) — it keeps
 * the first document Cosmos returned under `data` and names every other one in
 * `skipped`. That is the whole finding, but it is spread across a JSON array
 * and a key set, which is why it was only ever visible in a manifest diff.
 * This prints it.
 *
 * An article named here is published and unreachable: no URL resolves to it
 * and it is absent from the sitemap. Which one keeps the URL is decided by the
 * order Cosmos returns rows, so it can change between builds with nobody
 * editing anything — that is exactly what #399's diff showed. The fix is data:
 * give each a different slug in the CMS, or unpublish the duplicates.
 *
 * Publishing cannot add to this list any more — a first publish now writes a
 * slug ending in the document id (functions/src/lib/cms/publish.js,
 * resolveSlug), and a republish moves off a slug another document holds. What
 * is listed here predates that.
 *
 * Usage:  node scripts/report-slug-collisions.mjs
 * The output is the report, in markdown, ready to paste into the issue. Exits
 * non-zero only when the manifest is missing or is not valid JSON, which is a
 * checkout problem rather than a finding.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MANIFEST = join(ROOT, 'frontend', 'data', 'content-manifest.json');

/**
 * The exact sentence buildManifest writes for a duplicate:
 * `${slug}: duplicate slug (item ${item.id}); first occurrence kept`.
 * Anchored on the literal middle so the other `skipped` shapes — `no slug`
 * and `no recognised provider`, both of which also contain a colon — cannot
 * be read as duplicates.
 */
const DUPLICATE = /^(\S+): duplicate slug \(item (\S+)\); first occurrence kept$/;

/** @returns {{slug: string, id: string}[]} */
export function parseDuplicateSkips(skipped = []) {
  const out = [];
  for (const entry of Array.isArray(skipped) ? skipped : []) {
    const match = DUPLICATE.exec(String(entry));
    if (match) out.push({ slug: match[1], id: match[2] });
  }
  return out;
}

const titleOf = (article = {}) => String(article.title || article.Title || '').trim();

/**
 * One row per contested slug: the article that holds the URL, and the ones
 * that do not. `holder` is null when the manifest skipped the winner too —
 * which cannot happen today, but a row that quietly dropped its subject would
 * be worse than one that says it does not know.
 */
export function slugCollisions(manifest = {}) {
  const data = manifest.data || {};
  const routes = Array.isArray(manifest.routes) ? manifest.routes : [];
  const rows = new Map();
  for (const { slug, id } of parseDuplicateSkips(manifest.skipped)) {
    if (!rows.has(slug)) {
      const winner = data[`article:${slug}`];
      rows.set(slug, {
        slug,
        url: routes.find((route) => route.endsWith(`/blog/${slug}`)) || null,
        holder: winner ? { id: winner.id || null, title: titleOf(winner) } : null,
        unreachable: [],
      });
    }
    rows.get(slug).unreachable.push(id);
  }
  return [...rows.values()].sort(
    (a, b) => b.unreachable.length - a.unreachable.length || a.slug.localeCompare(b.slug)
  );
}

/** Markdown, because the destination is a GitHub issue comment. */
export function formatReport(rows, { generatedAt, articles, otherSkips = 0 } = {}) {
  const lines = ['### Slug collisions in the published set', ''];
  const stamp = generatedAt || 'unknown';
  const lost = rows.reduce((total, row) => total + row.unreachable.length, 0);

  if (rows.length === 0) {
    lines.push(
      `Manifest generated ${stamp}: ${articles} published articles, every one on its own URL.`
    );
  } else {
    lines.push(
      `Manifest generated ${stamp}: ${articles} published articles, ${rows.length} URL(s) ` +
        `claimed by more than one, ${lost} article(s) published with no URL at all.`,
      '',
      '| URL | serving | published, unreachable |',
      '| --- | --- | --- |'
    );
    for (const row of rows) {
      const holder = row.holder
        ? `\`${row.holder.id}\`${row.holder.title ? ` — ${row.holder.title}` : ''}`
        : '_not in this manifest_';
      const losers = row.unreachable.map((id) => `\`${id}\``).join(', ');
      lines.push(`| \`${row.url || row.slug}\` | ${holder} | ${losers} |`);
    }
    lines.push(
      '',
      'Which one serves the URL is decided by the order Cosmos returns rows, so it can',
      'change between builds. Give each article a different slug in the CMS, or unpublish',
      'the duplicates; the next manifest build routes all of them.'
    );
  }

  if (otherSkips > 0) {
    lines.push(
      '',
      `${otherSkips} further manifest skip(s) are not slug collisions (no slug, or no ` +
        'recognised provider) and are not listed here.'
    );
  }
  return lines.join('\n');
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const rows = slugCollisions(manifest);
  const skipped = Array.isArray(manifest.skipped) ? manifest.skipped : [];
  console.log(
    formatReport(rows, {
      generatedAt: manifest.generatedAt,
      articles: Object.keys(manifest.data || {}).filter((key) => key.startsWith('article:')).length,
      otherSkips: skipped.length - parseDuplicateSkips(skipped).length,
    })
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
