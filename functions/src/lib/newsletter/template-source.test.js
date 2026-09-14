/**
 * The template cache: five minutes per id, emptied when a different template
 * is selected, bounded, and never holding a failure. The fetch rules are
 * exercised through the handlers in admin-handlers.test.js.
 */
import { describe, it, expect, vi } from 'vitest';
import { TEMPLATE_CACHE_TTL_MS, createTemplateCache, loadTemplateHtml } from './template-source.js';

const reply = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data) });

describe('createTemplateCache', () => {
  it('holds an entry for five minutes', () => {
    let clock = 1000;
    const cache = createTemplateCache({ now: () => clock });
    cache.set('a', '<html>a</html>');
    clock += TEMPLATE_CACHE_TTL_MS - 1;
    expect(cache.get('a')).toBe('<html>a</html>');
    clock += 1;
    expect(cache.get('a')).toBeNull();
  });

  it('empties when a different template is selected, and not when the same one is', () => {
    const cache = createTemplateCache();
    cache.select('a');
    cache.set('a', 'A');
    cache.select('a');
    expect(cache.get('a')).toBe('A');
    cache.select('b');
    expect(cache.get('a')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('holds at most ten templates', () => {
    const cache = createTemplateCache();
    for (let i = 0; i < 12; i += 1) cache.set(`t${i}`, String(i));
    expect(cache.size).toBe(10);
    expect(cache.get('t0')).toBeNull();
    expect(cache.get('t11')).toBe('11');
  });
});

describe('loadTemplateHtml', () => {
  it('caches a published template and asks Resend again only after the cache drops it', async () => {
    const fetch = vi.fn(async () => reply(200, { id: 'tpl', status: ' Published ', html: '<p>{{{NEWSLETTER_BODY}}}</p>' }));
    const cache = createTemplateCache();
    const first = await loadTemplateHtml({ templateId: 'tpl', apiKey: 'k', fetch, cache });
    const second = await loadTemplateHtml({ templateId: 'tpl', apiKey: 'k', fetch, cache });
    expect(first).toEqual({ html: '<p>{{{NEWSLETTER_BODY}}}</p>' });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    cache.select('other');
    await loadTemplateHtml({ templateId: 'tpl', apiKey: 'k', fetch, cache });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('answers a problem, never a throw, and caches none of them', async () => {
    const cache = createTemplateCache();
    const cases = [
      [async () => reply(200, { status: 'published', html: '' }), 'TEMPLATE_NOT_HTML'],
      [async () => reply(429, { name: 'rate_limit_exceeded' }), 'TEMPLATE_FETCH_FAILED'],
      [async () => { throw new Error('boom'); }, 'TEMPLATE_FETCH_FAILED'],
    ];
    for (const [impl, code] of cases) {
      const result = await loadTemplateHtml({ templateId: 'tpl', apiKey: 'k', fetch: vi.fn(impl), cache });
      expect(result.problem?.code, code).toBe(code);
    }
    expect(cache.size).toBe(0);
    const fetch = vi.fn();
    expect((await loadTemplateHtml({ templateId: 'tpl', apiKey: '', fetch, cache })).problem.code).toBe('RESEND_NOT_CONFIGURED');
    expect(fetch).not.toHaveBeenCalled();
  });
});
