/**
 * Docker in the CMS (#775): an article can be classified, voiced, illustrated
 * and given a default cover as Docker, and a Docker page can carry an image
 * prompt set. One file for the server half, so the whole of "Docker end to
 * end" is readable in one place; each surface also keeps its own tests.
 *
 * The two frontend lists that mirror server allowlists are read as text and
 * held to them here, because each says it is "the same list" and nothing
 * checked that it was.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HERO_PROVIDERS, normalizeDefaultHeroes } from './platform-settings.js';
import { PROVIDER_THEMES, buildImagePrompt, pickDefaultHero } from './triggers/ai-cover.js';
import { brandingFor, buildCoverSvg } from './triggers/cover-svg.js';
import { ANALYSIS_SYSTEM_PROMPT } from './content/inspect.js';
import { VERTICAL_VOICE, voiceForProvider } from './content/voice.js';
import { ADMIN_PROMPT_PAGE_ALLOWLIST } from './cms/image-prompts.js';
import { normalizeProviderName } from './cms/content-update-validation.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const frontend = (...parts) => readFileSync(join(REPO, 'frontend', 'src', ...parts), 'utf8');

describe('classification', () => {
  it('offers Docker among the providers an article must be filed under', () => {
    const list = /MUST be exactly one of: ([^.]+)\./.exec(ANALYSIS_SYSTEM_PROMPT);
    expect(list, 'the provider list in the system prompt').not.toBeNull();
    expect(list[1].split(', ')).toContain('Docker');
  });

  it('files containers on another provider under that provider, as providers.js does', () => {
    // `docker` is last in frontend/src/lib/providers.js for the same reason.
    expect(ANALYSIS_SYSTEM_PROMPT).toContain(
      "Docker images on Azure Container Apps are 'Azure', a GitHub Actions workflow that builds an image is 'GitHub'"
    );
  });
});

describe('writing voice', () => {
  it('writes a Docker article as a container practitioner, whatever the casing', () => {
    expect(voiceForProvider('Docker')).toBe(VERTICAL_VOICE.docker);
    expect(voiceForProvider(' docker ')).toBe(VERTICAL_VOICE.docker);
    expect(VERTICAL_VOICE.docker).toMatch(/Dockerfile/);
    expect(VERTICAL_VOICE.docker).not.toBe(VERTICAL_VOICE.multi);
  });
});

describe('cover art', () => {
  it('prompts a Docker cover in Docker blue rather than falling back to Azure', () => {
    expect(PROVIDER_THEMES.Docker).toBeDefined();
    const prompt = buildImagePrompt({ cloudProvider: 'Docker', title: 'Multi-stage builds' });
    expect(prompt).toContain(`in ${PROVIDER_THEMES.Docker.color} color scheme`);
    expect(prompt).toContain(PROVIDER_THEMES.Docker.vibe);
    // Azure is the fallback; its colour words overlap Docker's, its vibe does not.
    expect(prompt).not.toContain(PROVIDER_THEMES.Azure.vibe);
  });

  it('draws the template cover in Docker blue, labelled DOCKER, whatever the casing', () => {
    expect(brandingFor('Docker').label).toBe('DOCKER');
    expect(brandingFor('docker').label).toBe('DOCKER');
    expect(buildCoverSvg('Docker', 'Multi-stage builds', 'Containers')).toContain('#1D63ED');
  });

  it('accepts a Docker default cover and hands it back for a Docker article', () => {
    expect(HERO_PROVIDERS).toContain('Docker');
    const { heroes } = normalizeDefaultHeroes({
      heroes: { docker: '/images/default-heroes/docker.png', Multi: '/images/multi.png' },
    });
    expect(heroes).toEqual({
      Docker: '/images/default-heroes/docker.png',
      Multi: '/images/multi.png',
    });
    expect(pickDefaultHero(heroes, 'Docker')).toBe('/images/default-heroes/docker.png');
  });
});

describe('image prompts', () => {
  const DOCKER_PAGES = [
    '/docker',
    '/docker/news',
    '/docker/blog',
    '/docker/code',
    '/docker/sandboxes',
    '/docker/tools',
    '/docker/education',
  ];

  it('lets a prompt set be assigned to every Docker page that exists, and no other', () => {
    for (const page of DOCKER_PAGES) expect(ADMIN_PROMPT_PAGE_ALLOWLIST.has(page), page).toBe(true);
    const docker = [...ADMIN_PROMPT_PAGE_ALLOWLIST].filter((p) => p.startsWith('/docker'));
    expect(docker.sort()).toEqual([...DOCKER_PAGES].sort());
  });

  it('offers the admin page only paths the server will accept', () => {
    // Since ADR 0033 the page carries no page list of its own: the set editor
    // groups the server's `allowedPages` (GET cms/image-prompts), so what is
    // offered IS the allowlist above, Docker's seven pages included. A page
    // list reappearing in the frontend would be the drift this test guards.
    const page = frontend('pages', 'admin', 'ImagePromptsPage.jsx');
    // The editor is a frame over prompt-set-editor/ (PR #841): the grouping
    // call is in its hook and the page labels in its model.
    const editor = [
      frontend('components', 'admin', 'images', 'prompt-set-editor', 'usePromptSetEditor.js'),
      frontend('components', 'admin', 'images', 'prompt-set-editor', 'promptSetEditorModel.js'),
    ].join('\n');
    expect(page).not.toMatch(/PAGE_GROUPS|provider: 'Docker'/);
    expect(page).toContain('allowedPages={library?.allowedPages');
    expect(editor).toContain('groupPages(allowedPages)');
    // The editor labels Docker's pages by their suffix; every suffix the
    // allowlist uses must have a label, or a page would show as a bare path.
    for (const path of DOCKER_PAGES) {
      const suffix = path.replace('/docker', '').replace(/^\//, '');
      if (suffix) expect(editor, `label for ${path}`).toMatch(new RegExp(`['"]?${suffix}['"]?: '`));
    }
  });
});

describe('the admin copy of the hero list', () => {
  it('is the server’s list, in the same order', () => {
    const source = frontend('components', 'admin', 'platform-settings', 'settingShared.jsx');
    const block = /export const HERO_PROVIDERS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(source);
    expect(block, 'HERO_PROVIDERS in settingShared.jsx').not.toBeNull();
    const admin = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(admin).toEqual([...HERO_PROVIDERS]);
  });
});

describe('the admin provider list', () => {
  // frontend/src/config/admin.js builds the review board's provider picker
  // from CANONICAL_PROVIDERS in frontend/src/lib/providers.js, storing each
  // key with its first letter capitalised. A value the server cannot
  // normalise is a button whose save is refused and a post that can never
  // reach the publish queue, which is what Docker, VMware and Ansible were
  // until 2026-10-03.
  const block = /export const CANONICAL_PROVIDERS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(
    frontend('lib', 'providers.js')
  );
  const providers = block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  const stored = (provider) => provider.charAt(0).toUpperCase() + provider.slice(1);

  it('stores each value the way admin.js writes it', () => {
    expect(frontend('config', 'admin.js')).toContain(
      'provider.charAt(0).toUpperCase() + provider.slice(1)'
    );
  });

  it('offers only providers the server stores as written, and every one it knows', () => {
    expect(block, 'CANONICAL_PROVIDERS in lib/providers.js').not.toBeNull();
    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(normalizeProviderName(provider), provider).toBe(stored(provider));
      expect(normalizeProviderName(stored(provider)), provider).toBe(stored(provider));
    }
    expect(providers).toEqual(expect.arrayContaining(['docker', 'vmware', 'ansible']));
  });
});
