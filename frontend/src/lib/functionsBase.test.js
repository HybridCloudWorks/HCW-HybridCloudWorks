/**
 * Guards the single API-base resolver.
 *
 * The port shipped with `api.js` and `publicApi.js` each holding their own copy
 * of the resolution logic, both reading the retired `VITE_GCP_FUNCTIONS_URL`.
 * These tests pin the contract that replaced them: one variable, both
 * topologies, and a diagnosable throw instead of a silent same-origin request.
 *
 * `functionsBase.js` reads `import.meta.env` once at module scope, so each case
 * stubs the variable and re-imports the module with a reset registry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadWithBase(value) {
  vi.resetModules();
  if (value === undefined) {
    vi.stubEnv('VITE_AZURE_FUNCTIONS_URL', '');
  } else {
    vi.stubEnv('VITE_AZURE_FUNCTIONS_URL', value);
  }
  return import('./functionsBase.js');
}

describe('getFunctionsBase', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a cross-origin base unchanged', async () => {
    const { getFunctionsBase } = await loadWithBase('https://hcw-functions.azurewebsites.net/api');
    expect(getFunctionsBase()).toBe('https://hcw-functions.azurewebsites.net/api');
  });

  it('returns a same-origin relative base unchanged', async () => {
    const { getFunctionsBase } = await loadWithBase('/api');
    expect(getFunctionsBase()).toBe('/api');
  });

  it('strips trailing slashes so callers can join with a single slash', async () => {
    const { getFunctionsBase } = await loadWithBase('https://host.example/api//');
    expect(getFunctionsBase()).toBe('https://host.example/api');
  });

  it('trims surrounding whitespace', async () => {
    const { getFunctionsBase } = await loadWithBase('  /api  ');
    expect(getFunctionsBase()).toBe('/api');
  });

  it('returns an empty string when unset', async () => {
    const { getFunctionsBase } = await loadWithBase(undefined);
    expect(getFunctionsBase()).toBe('');
  });
});

describe('requireFunctionsBase', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the base when configured', async () => {
    const { requireFunctionsBase } = await loadWithBase('/api');
    expect(requireFunctionsBase('public/content')).toBe('/api');
  });

  it('throws naming the variable and the caller when unset', async () => {
    const { requireFunctionsBase } = await loadWithBase(undefined);
    expect(() => requireFunctionsBase('public/content')).toThrow(/VITE_AZURE_FUNCTIONS_URL/);
    expect(() => requireFunctionsBase('public/content')).toThrow(/public\/content/);
  });

  it('never falls back to a same-origin default', async () => {
    // A silent '' base would produce fetch('/public/content'), which the SPA
    // history fallback answers with index.html — surfacing as a JSON parse
    // error far from the actual misconfiguration.
    const { requireFunctionsBase } = await loadWithBase(undefined);
    expect(() => requireFunctionsBase('cms/content')).toThrow();
  });
});

describe('resolveMediaUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves a stored media path alone when the API is same-origin', async () => {
    const { resolveMediaUrl } = await loadWithBase('/api');
    expect(resolveMediaUrl('/api/public/media/covers/a.png')).toBe(
      '/api/public/media/covers/a.png'
    );
  });

  it('points a stored media path at the API origin when cross-origin', async () => {
    const { resolveMediaUrl } = await loadWithBase('https://hcw-functions.azurewebsites.net/api');
    expect(resolveMediaUrl('/api/public/media/covers/a.png')).toBe(
      'https://hcw-functions.azurewebsites.net/api/public/media/covers/a.png'
    );
  });

  it('leaves absolute URLs from the source system untouched', async () => {
    const { resolveMediaUrl } = await loadWithBase('https://hcw-functions.azurewebsites.net/api');
    const legacy = 'https://firebasestorage.googleapis.com/v0/b/x/o/y.png';
    expect(resolveMediaUrl(legacy)).toBe(legacy);
  });

  it('passes through data URIs and empty values', async () => {
    const { resolveMediaUrl } = await loadWithBase('/api');
    expect(resolveMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(resolveMediaUrl('')).toBe('');
    expect(resolveMediaUrl(undefined)).toBe('');
  });
});

describe('no module reads the API base outside this resolver', () => {
  it('has no remaining VITE_GCP_FUNCTIONS_URL reference in src', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(js|jsx)$/.test(entry)) continue;
        if (full.endsWith('functionsBase.test.js')) continue;
        if (readFileSync(full, 'utf8').includes('VITE_GCP_FUNCTIONS_URL')) {
          offenders.push(full);
        }
      }
    };
    walk(join(process.cwd(), 'src'));

    expect(offenders).toEqual([]);
  });

  it('reads VITE_AZURE_FUNCTIONS_URL only in functionsBase.js', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, sep } = await import('node:path');

    const readers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(js|jsx)$/.test(entry)) continue;
        if (full.endsWith('functionsBase.test.js')) continue;
        if (readFileSync(full, 'utf8').includes('import.meta.env.VITE_AZURE_FUNCTIONS_URL')) {
          // join() yields the platform separator, so normalize to POSIX before
          // comparing — otherwise this asserts \lib\functionsBase.js on Windows and
          // fails there while passing on Linux CI.
          readers.push(full.replace(join(process.cwd(), 'src'), '').split(sep).join('/'));
        }
      }
    };
    walk(join(process.cwd(), 'src'));

    expect(readers).toEqual(['/lib/functionsBase.js']);
  });
});
