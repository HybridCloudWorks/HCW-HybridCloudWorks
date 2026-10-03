/**
 * The AI cover reads the Image Prompts library (ADR 0033). Before this the
 * change-feed trigger composed every cover from the hardcoded Lego prompt no
 * matter what the admin had assigned, and the lineage fields on every
 * generated row were written empty. These pin the order of precedence
 * (override → library → built-in), the composition (primary prompt, hero
 * slot template, style rules, keyword matrix), and the lineage each row
 * carries.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  aiCoverBlobPath,
  compactStamp,
  createAiCoverGenerator,
  generatedImageRecordFields,
  resolveCoverPrompt,
} from './ai-cover.js';

const NOW = new Date('2026-10-03T09:30:15.000Z');
const now = () => NOW;

function memStore(containers = {}) {
  const data = Object.fromEntries(
    Object.entries(containers).map(([k, v]) => [k, new Map(v.map((d) => [d.id, d]))])
  );
  const get = (c) => (data[c] ||= new Map());
  return {
    data,
    readDoc: vi.fn(async (c, id) => get(c).get(id) || null),
    upsertDoc: vi.fn(async (c, doc) => {
      get(c).set(doc.id, doc);
      return doc;
    }),
    patchDoc: vi.fn(async (c, id, u) => {
      const next = { ...(get(c).get(id) || { id }), ...u };
      get(c).set(id, next);
      return next;
    }),
    replaceDocIfMatch: vi.fn(async (c, doc) => {
      const next = { ...doc, _etag: `${doc._etag || 'e'}+` };
      get(c).set(doc.id, next);
      return next;
    }),
    deleteDoc: vi.fn(async (c, id) => get(c).delete(id)),
    queryDocs: vi.fn(async (c) => [...get(c).values()]),
  };
}

const SET = {
  id: 'Azure Chibi',
  name: 'Azure Chibi',
  primaryPrompt: 'Chibi engineers building Azure services',
  styleRules: 'Soft gradients, isometric camera',
  negativePrompt: 'photorealism, text',
  aspectRatio: '1:1',
  version: 3,
};
const PROMPT = {
  id: 'Hero',
  name: 'Hero',
  setName: 'Azure Chibi',
  additionalParameters: 'one character in focus',
  slotTemplates: { hero: 'Wide establishing shot of the data centre' },
};
const CONTENT = {
  id: 'c1',
  Title: 'Scaling AKS with KEDA',
  summary: 'Event-driven autoscaling for Kubernetes on Azure.',
  'Cloud Provider': 'Azure',
  type: 'blog',
  altCoverImageTrigger: true,
  _etag: 'e',
};

describe('compactStamp / aiCoverBlobPath', () => {
  it('stamps the path with digits only, so regeneration never overwrites', () => {
    expect(compactStamp(NOW.toISOString())).toBe('20261003093015');
    expect(aiCoverBlobPath('c1', 'hero', NOW.toISOString())).toBe('c1-ai-hero-20261003093015.png');
  });
});

describe('resolveCoverPrompt', () => {
  it('uses the page-assigned set, with the hero slot template, style rules and keyword matrix', async () => {
    const store = memStore({
      image_prompt_sets: [SET],
      image_prompt_sets_prompts: [PROMPT],
      image_prompt_pages: [{ id: 'azure_blog', pagePath: '/azure/blog', setName: 'Azure Chibi', promptName: 'Hero' }],
      prompt_keyword_synonyms: [{ id: 'k8s', canonical: 'Kubernetes', patterns: ['aks', 'kubernetes'] }],
      prompt_keyword_augmentations: [
        { id: 'keda', label: 'KEDA', patterns: ['keda'], directive: 'Show a gauge needle swinging upward.' },
      ],
    });
    const resolved = await resolveCoverPrompt({ store }, CONTENT);
    expect(resolved.source).toBe('library');
    expect(resolved.aspectRatio).toBe('1:1');
    expect(resolved.prompt).toContain('Chibi engineers building Azure services');
    expect(resolved.prompt).toContain('Variation: one character in focus');
    expect(resolved.prompt).toContain('Slot composition: Wide establishing shot');
    expect(resolved.prompt).toContain('Subject: Scaling AKS with KEDA.');
    expect(resolved.prompt).toContain('Key concepts: Kubernetes.');
    expect(resolved.prompt).toContain('Show a gauge needle swinging upward.');
    expect(resolved.prompt).toContain('Style rules: Soft gradients');
    expect(resolved.prompt).toContain('Avoid: photorealism, text');
    expect(resolved.prompt).not.toContain('Lego');
    expect(resolved.lineage).toMatchObject({
      promptSetId: 'Azure Chibi',
      promptSet: 'Azure Chibi',
      promptName: 'Hero',
      promptTemplateVersion: 'Azure Chibi@v3',
      promptSource: 'page',
    });
  });

  it("prefers the document's own lineage over the page, and the override over both", async () => {
    const other = { ...SET, id: 'AWS Lego', name: 'AWS Lego', primaryPrompt: 'Lego builders on AWS' };
    const store = memStore({
      image_prompt_sets: [SET, other],
      image_prompt_pages: [{ id: 'azure_blog', pagePath: '/azure/blog', setName: 'Azure Chibi' }],
    });
    const own = await resolveCoverPrompt({ store }, { ...CONTENT, imagePromptSet: 'AWS Lego' });
    expect(own.lineage.promptSet).toBe('AWS Lego');
    expect(own.lineage.promptSource).toBe('content');

    const override = await resolveCoverPrompt(
      { store },
      { ...CONTENT, altCoverImagePrompt: 'Exactly this, verbatim' }
    );
    expect(override).toMatchObject({ prompt: 'Exactly this, verbatim', source: 'override' });
  });

  it('falls back to the built-in prompt when no set applies or the set is archived', async () => {
    const none = await resolveCoverPrompt({ store: memStore() }, CONTENT);
    expect(none.source).toBe('builtin');
    expect(none.prompt).toMatch(/Lego minifigure/);
    expect(none.lineage.promptTemplateVersion).toBe('builtin-lego-v1');

    const archived = memStore({
      image_prompt_sets: [{ ...SET, archivedAt: '2026-09-01T00:00:00Z' }],
      image_prompt_pages: [{ id: 'azure_blog', pagePath: '/azure/blog', setName: 'Azure Chibi' }],
    });
    expect((await resolveCoverPrompt({ store: archived }, CONTENT)).source).toBe('builtin');
  });

  it('falls back to the built-in prompt when the library read throws: a cover is still owed', async () => {
    const store = memStore();
    store.readDoc = vi.fn(async () => {
      throw new Error('cosmos down');
    });
    const resolved = await resolveCoverPrompt({ store, log: { warn: vi.fn() } }, CONTENT);
    expect(resolved.source).toBe('builtin');
    expect(resolved.prompt).toMatch(/Lego minifigure/);
  });
});

describe('generatedImageRecordFields', () => {
  it('records the delete ref, bytes, dimensions, format, model and lineage', () => {
    // A 1×1 PNG header: signature, IHDR length+type, width 1, height 1.
    const png = Buffer.concat([
      Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
      Buffer.from('00000001', 'hex'),
      Buffer.from('00000001', 'hex'),
      Buffer.alloc(8),
    ]);
    const fields = generatedImageRecordFields({
      buffer: png,
      contentType: 'image/png',
      blobPath: 'x-ai-hero-1.png',
      replicate: { provider: 'replicate', model: 'google/imagen-4-fast' },
      lineage: { promptSet: 'S', prompt: 'p' },
    });
    expect(fields).toMatchObject({
      storagePath: 'covers/x-ai-hero-1.png',
      bytes: png.length,
      width: 1,
      height: 1,
      format: 'png',
      imageProvider: 'replicate',
      imageModel: 'google/imagen-4-fast',
      promptSet: 'S',
      prompt: 'p',
    });
  });
});

describe('createAiCoverGenerator with a library set', () => {
  it('generates from the set, stamps the path, and writes lineage on the row and the doc', async () => {
    const store = memStore({
      content: [CONTENT],
      image_prompt_sets: [SET],
      image_prompt_sets_prompts: [PROMPT],
      image_prompt_pages: [{ id: 'azure_blog', pagePath: '/azure/blog', setName: 'Azure Chibi', promptName: 'Hero' }],
    });
    const storage = { uploadBlob: vi.fn(async () => 'u') };
    const replicate = { provider: 'replicate', model: 'm1', generate: vi.fn(async () => 'https://img/x.png') };
    const gen = createAiCoverGenerator({
      store,
      storage,
      replicate,
      fetchImage: vi.fn(async () => ({ buffer: Buffer.from('png'), contentType: 'image/png' })),
      now,
      uuid: () => 'g1',
    });
    const result = await gen.run('c1', 'ev1');
    expect(result).toMatchObject({ ran: true, promptSource: 'library' });
    expect(replicate.generate.mock.calls[0][0]).toMatch(/Chibi engineers[\s\S]*Image slot: hero/);
    expect(replicate.generate.mock.calls[0][1]).toEqual({ aspectRatio: '1:1' });
    expect(storage.uploadBlob.mock.calls[0][1]).toBe('c1-ai-hero-20261003093015.png');

    const row = store.data.generated_content_images.get('g1');
    expect(row).toMatchObject({
      promptSet: 'Azure Chibi',
      promptName: 'Hero',
      promptTemplateVersion: 'Azure Chibi@v3',
      imageModel: 'm1',
      storagePath: 'covers/c1-ai-hero-20261003093015.png',
      approvalStatus: 'approved',
    });
    expect(row.prompt).toContain('Image slot: hero');

    const doc = store.data.content.get('c1');
    expect(doc).toMatchObject({
      imagePromptSet: 'Azure Chibi',
      imagePromptName: 'Hero',
      promptTemplateVersion: 'Azure Chibi@v3',
      altCoverImagePromptSource: 'library',
      altCoverImage: '/api/public/media/covers/c1-ai-hero-20261003093015.png',
    });
  });
});
