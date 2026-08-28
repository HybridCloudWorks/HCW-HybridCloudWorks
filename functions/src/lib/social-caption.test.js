import { describe, it, expect, vi } from 'vitest';
import {
  buildCaptionPrompt,
  generateCaptionText,
  createSocialCaptionHandlers,
  CAPTION_MAX_CHARS,
} from './social-caption.js';

const guardAs = (role) => ({
  requireRole: vi.fn(async () =>
    role ? { user: { oid: 'u1' }, role, error: null } : { error: { status: 403, body: '{}' } }
  ),
});
const request = (body) => ({ json: async () => body, headers: { get: () => null } });
const context = { error: vi.fn() };

describe('caption core', () => {
  it('prompt carries the rules, the platforms, and never asks for a URL', () => {
    const prompt = buildCaptionPrompt({
      title: 'Cut EBS cost',
      summary: 'gp2 to gp3 with zero downtime',
      platforms: ['linkedin', 'twitter'],
    });
    expect(prompt).toContain('linkedin, twitter');
    expect(prompt).toContain('Cut EBS cost');
    expect(prompt).toContain('Do NOT include any URL');
    expect(prompt).toContain('At most two hashtags');
  });

  it('declares the socialCaption feature on the model call and caps the output', async () => {
    const ai = { generateTextResponse: vi.fn(async () => `  ${'x'.repeat(2000)}  `) };
    const caption = await generateCaptionText({ ai }, { title: 'T', summary: 'S' });
    expect(ai.generateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'socialCaption', purpose: 'general' })
    );
    expect(caption).toHaveLength(CAPTION_MAX_CHARS);
  });
});

describe('generateSocialCaption handler', () => {
  const ai = { generateTextResponse: vi.fn(async () => 'A sharp caption.') };
  const store = {
    readDoc: vi.fn(async () => ({ Title: 'Doc title', Summary: 'Doc summary' })),
  };

  it('requires the editor role', async () => {
    const h = createSocialCaptionHandlers({ guard: guardAs(null), store, ai });
    const res = await h.generateSocialCaption(request({ title: 'T' }), context);
    expect(res.status).toBe(403);
  });

  it('generates from a supplied title/summary', async () => {
    const h = createSocialCaptionHandlers({ guard: guardAs('editor'), store, ai });
    const res = await h.generateSocialCaption(
      request({ title: 'T', summary: 'S', platforms: ['linkedin'] }),
      context
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, caption: 'A sharp caption.' });
    expect(store.readDoc).not.toHaveBeenCalled();
  });

  it('resolves title/summary from a contentId when not supplied', async () => {
    const h = createSocialCaptionHandlers({ guard: guardAs('editor'), store, ai });
    const res = await h.generateSocialCaption(request({ contentId: 'doc-1' }), context);
    expect(res.status).toBe(200);
    expect(store.readDoc).toHaveBeenCalledWith('content', 'doc-1', 'doc-1');
  });

  it('400s when nothing resolvable is sent', async () => {
    const bare = {
      readDoc: vi.fn(async () => null),
    };
    const h = createSocialCaptionHandlers({ guard: guardAs('editor'), store: bare, ai });
    const res = await h.generateSocialCaption(request({ contentId: 'ghost' }), context);
    expect(res.status).toBe(400);
  });

  it('500s with the message when the model call throws, never throwing itself', async () => {
    const broken = { generateTextResponse: vi.fn(async () => Promise.reject(new Error('quota'))) };
    const h = createSocialCaptionHandlers({ guard: guardAs('editor'), store, ai: broken });
    const res = await h.generateSocialCaption(request({ title: 'T' }), context);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).message).toBe('quota');
  });
});
