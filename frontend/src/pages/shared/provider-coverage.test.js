/**
 * Every provider in VALID_PROVIDERS must have its own metadata on every shared
 * page that keys metadata by provider (#183).
 *
 * WHY THIS EXISTS. VMware and Ansible were added to VALID_PROVIDERS and nothing
 * else was updated. Both shared pages key a lookup table by provider and both
 * fell back to *another provider's identity* when the key was missing:
 *
 *   NEWS_META[provider] || NEWS_META.azure   -> /vmware/news  = "Azure Platform News"
 *   detectProvider() returning 'github'      -> /ansible/audio = "GitHub Podcast"
 *
 * Eight indexable URLs served the wrong company's name and copy at HTTP 200,
 * and pre-rendering was about to bake that into static HTML for crawlers.
 *
 * Nothing failed. Both defaults are valid providers, so every page rendered,
 * every test passed, and the only symptom was a title nobody was reading. That
 * is precisely the shape of bug a coverage assertion catches and a unit test of
 * either page in isolation does not: each page works perfectly for the
 * providers it knows about.
 *
 * The fallbacks are now deliberately generic, so a future gap degrades to
 * something visibly unbranded rather than something confidently wrong — but a
 * fallback is damage control, not coverage. This is the coverage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VALID_PROVIDERS } from '@/context/ProviderContext';

/**
 * Read the table's keys from source rather than importing the component.
 *
 * Both modules are React pages that pull in hooks, contexts and animation
 * helpers; importing them to inspect one constant drags the whole tree into a
 * test that is only asking "which keys are defined". The tables are plain
 * top-level object literals, so the keys are unambiguous in the text.
 */
function tableKeys(relativePath, tableName) {
  const source = readFileSync(join(process.cwd(), 'src', 'pages', 'shared', relativePath), 'utf8');
  const start = source.indexOf(`const ${tableName} = {`);
  expect(start, `${tableName} not found in ${relativePath}`).toBeGreaterThan(-1);

  // Walk to the matching closing brace so a nested object cannot end it early.
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const body = source.slice(start, end);
  // Top-level keys only: two-space indent inside the literal.
  return [...body.matchAll(/^ {2}([a-z][a-z0-9]*):\s*\{/gm)].map((m) => m[1]);
}

/**
 * Providers whose dispatcher branch renders `component`.
 *
 * App.jsx routes `/:provider/<section>` through a dispatcher of the shape
 * `if (provider === 'x') return <SomePage />;`. Reading it here means the test
 * tracks the routing rather than a second list that has to be remembered — the
 * exact failure mode being guarded against.
 */
function providersRoutedTo(dispatcher, component) {
  const source = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8');
  const start = source.indexOf(`function ${dispatcher}(`);
  expect(start, `${dispatcher} not found in App.jsx`).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf('\n}', start));

  return [...body.matchAll(/provider === '([a-z0-9-]+)'\)\s*return\s*<([A-Za-z]+)/g)]
    .filter((match) => match[2] === component)
    .map((match) => match[1]);
}

describe('provider coverage on shared pages', () => {
  it('VALID_PROVIDERS is the list this is checked against', () => {
    // A vacuous pass if the import ever breaks.
    expect(VALID_PROVIDERS.length).toBeGreaterThanOrEqual(8);
    expect(VALID_PROVIDERS).toContain('vmware');
    expect(VALID_PROVIDERS).toContain('ansible');
  });

  it('NewsPage has metadata for every provider', () => {
    const covered = tableKeys('NewsPage.jsx', 'NEWS_META');
    const missing = VALID_PROVIDERS.filter((p) => !covered.includes(p));
    expect(
      missing,
      'providers with no NEWS_META entry — they would render another provider’s news identity'
    ).toEqual([]);
  });

  it('PodcastPage has metadata for every provider routed to it', () => {
    // NOT every provider: azure, aws and gcp have dedicated podcast pages and
    // never reach the shared one. Asserting all of VALID_PROVIDERS here would
    // demand rows nothing reads, so the list is derived from the dispatcher —
    // which is also the thing that changes when a provider is added.
    const routed = providersRoutedTo('ProviderAudioDispatcher', 'SharedPodcastPage');
    expect(routed, 'no providers parsed from the audio dispatcher').not.toEqual([]);

    const covered = tableKeys('PodcastPage.jsx', 'PROVIDER_META');
    const missing = routed.filter((p) => !covered.includes(p));
    expect(
      missing,
      'providers routed to SharedPodcastPage with no PROVIDER_META entry — they would render another provider’s podcast identity'
    ).toEqual([]);
  });

  it('neither page falls back to a real provider', () => {
    // The specific defect: `|| NEWS_META.azure` and `return 'github'`. A
    // fallback that names a real provider is indistinguishable from correct
    // output, which is why this went unnoticed.
    const news = readFileSync(join(process.cwd(), 'src/pages/shared/NewsPage.jsx'), 'utf8');
    const podcast = readFileSync(join(process.cwd(), 'src/pages/shared/PodcastPage.jsx'), 'utf8');

    for (const provider of VALID_PROVIDERS) {
      expect(news, `NewsPage falls back to ${provider}`).not.toContain(`|| NEWS_META.${provider}`);
      expect(podcast, `PodcastPage defaults to ${provider}`).not.toMatch(
        new RegExp(`return '${provider}';\\s*\\n\\s*\\}`)
      );
    }
  });
});
