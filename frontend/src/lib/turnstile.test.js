/**
 * Loading Cloudflare Turnstile (lib/turnstile.js). What must hold: one script
 * tag, from the one URL the CSP allows, however many times it is asked for;
 * the API it defines is what resolves; a failed load can be tried again; and
 * the site key is the build's, trimmed, '' when the build had none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAB_TURNSTILE_ACTION,
  TURNSTILE_SCRIPT_URL,
  loadTurnstile,
  resetTurnstileLoader,
  turnstileSiteKey,
} from './turnstile';

/** A document and window that record the script tags appended to them. */
function page() {
  const scripts = [];
  const window = {};
  const document = {
    createElement: vi.fn(() => ({})),
    head: { appendChild: vi.fn((script) => scripts.push(script)) },
  };
  return { window, document, scripts };
}

afterEach(() => resetTurnstileLoader());

describe('loadTurnstile', () => {
  it('appends one script from the explicit-render URL and resolves to the API it defines', async () => {
    const { window, document, scripts } = page();
    const first = loadTurnstile({ window, document });
    const second = loadTurnstile({ window, document });
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    );
    expect(scripts[0].src).toBe(TURNSTILE_SCRIPT_URL);
    expect(scripts[0].async).toBe(true);
    const api = { render: vi.fn() };
    window.turnstile = api;
    scripts[0].onload();
    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it('uses the API already on the page without another script', async () => {
    const { window, document, scripts } = page();
    window.turnstile = { render: vi.fn() };
    await expect(loadTurnstile({ window, document })).resolves.toBe(window.turnstile);
    expect(scripts).toHaveLength(0);
  });

  it('rejects when the script fails, and a later call tries again', async () => {
    const { window, document, scripts } = page();
    const failed = loadTurnstile({ window, document });
    scripts[0].onerror();
    await expect(failed).rejects.toThrow('Turnstile could not be loaded');
    loadTurnstile({ window, document });
    expect(scripts).toHaveLength(2);
  });

  it('rejects when the script loads but defines no API', async () => {
    const { window, document, scripts } = page();
    const loading = loadTurnstile({ window, document });
    scripts[0].onload();
    await expect(loading).rejects.toThrow('Turnstile loaded without its API');
  });
});

describe('the site key and the action', () => {
  it('reads the build’s site key, trimmed, and nothing when it is absent', () => {
    expect(turnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: '  0x4AAAAAAA-test  ' })).toBe(
      '0x4AAAAAAA-test'
    );
    expect(turnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: '' })).toBe('');
    expect(turnstileSiteKey({})).toBe('');
  });

  it('names an action Cloudflare accepts', () => {
    // Up to 32 letters, digits, _ and -. The server requires this exact value back.
    expect(LAB_TURNSTILE_ACTION).toBe('lab-validate');
    expect(LAB_TURNSTILE_ACTION).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});
