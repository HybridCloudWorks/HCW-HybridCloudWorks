/**
 * The weekly issue: what the sections collect, what the builder stores, and
 * what the renderer puts in front of a reader.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  absoluteUrl,
  articlesSection,
  certificationNewsSection,
  collectSections,
  episodesSection,
  plainText,
} from './sections.js';
import {
  INTRO_INSTRUCTION,
  SUBJECT_INSTRUCTION,
  createIssueBuilder,
  draftIntro,
  stripMarkdown,
  suggestSubjects,
} from './issue.js';
import { UNSUBSCRIBE_PLACEHOLDER, renderIssue } from './render.js';

const NOW = new Date('2026-09-14T12:00:00Z');
const SINCE = new Date('2026-09-07T12:00:00Z');

/** A store that answers each container's query from fixed rows and records writes. */
function makeStore(rowsByContainer = {}, docs = {}) {
  const written = new Map(Object.entries(docs));
  return {
    written,
    queryDocs: vi.fn(async (container) => rowsByContainer[container] ?? []),
    readDoc: vi.fn(async (container, id) => written.get(`${container}/${id}`) ?? null),
    upsertDoc: vi.fn(async (container, doc) => {
      written.set(`${container}/${doc.id}`, doc);
      return doc;
    }),
  };
}

const article = {
  Title: 'Landing zones in 2026',
  Summary: '<p>What   changed</p>',
  'Cloud Provider': 'Azure',
  publishedAt: '2026-09-10T00:00:00Z',
  publishedUrl: 'https://hybridcloudworks.com/azure/blog/landing-zones-2026',
};

describe('sections', () => {
  it('links articles to the URL publishing stored, and drops one that has none', async () => {
    const store = makeStore({ content: [article, { Title: 'No URL', publishedAt: '2026-09-11T00:00:00Z' }] });
    const items = await articlesSection.collect({ store, since: SINCE, until: NOW });
    expect(items).toEqual([
      {
        title: 'Landing zones in 2026',
        summary: 'What changed',
        url: 'https://hybridcloudworks.com/azure/blog/landing-zones-2026',
        label: 'Azure',
      },
    ]);
    const [, sql, params] = store.queryDocs.mock.calls[0];
    expect(sql).toMatch(/c\.Live = true/);
    expect(params).toEqual([
      { name: '@since', value: SINCE.toISOString() },
      { name: '@until', value: NOW.toISOString() },
    ]);
  });

  it('labels certification news by kind and exam code, and skips soft-deleted events', async () => {
    const store = makeStore({
      certEvents: [
        { type: 'retirement', certCodes: ['AZ-900'], title: 'AZ-900 retires', link: 'https://learn.microsoft.com/x', pubDate: '2026-09-09T00:00:00Z' },
        { type: 'ga_launch', certCodes: [], title: 'Deleted', link: 'https://learn.microsoft.com/y', softDeletedAt: '2026-09-10' },
      ],
    });
    expect(await certificationNewsSection.collect({ store, since: SINCE, until: NOW })).toEqual([
      { title: 'AZ-900 retires', summary: '', url: 'https://learn.microsoft.com/x', label: 'Retiring · AZ-900' },
    ]);
  });

  it('links a study episode to its certification page where one exists, and a podcast to its episode', async () => {
    const store = makeStore(
      {
        listen_and_learn_episodes: [
          { setId: 'azure_az-104', provider: 'azure', title: 'Networking', summary: 'VNets', approvedAt: '2026-09-12T00:00:00Z', audioUrl: '/api/public/media/x.mp3' },
          { setId: 'gcp_ace', provider: 'gcp', title: 'IAM', approvedAt: '2026-09-12T00:00:00Z', audioUrl: '/api/public/media/y.mp3' },
          { setId: 'azure_az-104', provider: 'azure', title: 'No audio', approvedAt: '2026-09-12T00:00:00Z' },
        ],
        podcasts: [
          { provider: 'main', title: 'Episode 12', description: 'Talk', link: 'https://media.rss.com/show/ep-12', publishedAt: '2026-09-13T00:00:00Z' },
          { provider: 'aws', title: 'Gone', link: 'https://x.example/g', mediaUnavailableAt: '2026-09-13' },
        ],
      },
      { 'listen_and_learn/azure_az-104': { certSlug: 'az-104', certTitle: 'Azure Administrator' } }
    );
    const items = await episodesSection.collect({ store, since: SINCE, until: NOW });
    expect(items.map((i) => [i.title, i.url, i.label])).toEqual([
      ['Episode 12', 'https://media.rss.com/show/ep-12', 'Podcast'],
      ['Networking', 'https://hybridcloudworks.com/azure/education/az-104', 'Study episode · Azure Administrator'],
      ['IAM', 'https://hybridcloudworks.com/gcp/education', 'Study episode'],
    ]);
  });

  it('keeps a failing section from sinking the issue, and reports it', async () => {
    const warn = vi.fn();
    const broken = { id: 'broken', title: 'Broken', collect: async () => { throw new Error('container gone'); } };
    const ok = { id: 'ok', title: 'OK', collect: async () => [{ title: 'A', url: 'https://x.example/a' }] };
    const empty = { id: 'empty', title: 'Empty', collect: async () => [] };
    const result = await collectSections({ store: {}, since: SINCE, until: NOW, sections: [broken, ok, empty], log: { warn } });
    expect(result.sections.map((s) => s.id)).toEqual(['ok']);
    expect(result.problems).toEqual(['broken: container gone']);
    expect(warn).toHaveBeenCalled();
  });

  it('only accepts https or site paths as links, and never passes markup through', () => {
    expect(absoluteUrl('/azure/blog/x')).toBe('https://hybridcloudworks.com/azure/blog/x');
    for (const bad of ['//evil.example/x', 'javascript:alert(1)', 'http://plain.example', '', null]) {
      expect(absoluteUrl(bad), String(bad)).toBeNull();
    }
    expect(plainText('<b>bold</b>   text')).toBe('bold text');
    expect(plainText('x'.repeat(400))).toHaveLength(280);
  });
});

describe('createIssueBuilder', () => {
  const drafter = (overrides = {}) => ({
    generateDraft: vi.fn(async () => ({ title: '## Landing zones, again', postContent: '**This week** we looked at [zones](https://x).', ...overrides })),
  });

  it('stores a draft with the sections, an AI subject and a plain-text intro', async () => {
    const store = makeStore({ content: [article] });
    const d = drafter();
    const result = await createIssueBuilder({ store, drafter: d, now: () => NOW }).build({});

    expect(result).toMatchObject({ success: true, issueId: 'issue-2026-09-14', itemCount: 1, sections: ['articles'] });
    const doc = store.written.get('newsletters/issue-2026-09-14');
    expect(doc).toMatchObject({
      kind: 'weekly_issue',
      status: 'draft',
      subject: 'Landing zones, again',
      intro: 'This week we looked at zones.',
      customNote: '',
      periodStart: SINCE.toISOString(),
      periodEnd: NOW.toISOString(),
    });
    const call = d.generateDraft.mock.calls[0][0];
    expect(call.customInstructionPrompt).toBe(INTRO_INSTRUCTION);
    expect(call.markdown).toContain('Landing zones in 2026');
  });

  it('builds nothing, and asks no model, when the week had nothing new', async () => {
    const store = makeStore();
    const d = drafter();
    const result = await createIssueBuilder({ store, drafter: d, now: () => NOW }).build({ days: 7 });
    expect(result).toMatchObject({ success: false, itemCount: 0 });
    expect(d.generateDraft).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('still builds the issue when the AI is off, with a dated subject and no intro', async () => {
    const store = makeStore({ content: [article] });
    const d = { generateDraft: vi.fn(async () => { throw new Error('forgeDrafting is disabled'); }) };
    const result = await createIssueBuilder({ store, drafter: d, now: () => NOW, log: { warn: vi.fn() } }).build({});
    expect(result.success).toBe(true);
    const doc = store.written.get('newsletters/issue-2026-09-14');
    expect(doc.subject).toBe('HybridCloudWorks Weekly: Sep 7 – Sep 14');
    expect(doc.intro).toBe('');
    expect(doc.introError).toMatch(/disabled/);
  });

  it('refreshes a same-day draft but keeps the owner’s note', async () => {
    const store = makeStore({ content: [article] }, {
      'newsletters/issue-2026-09-14': { id: 'issue-2026-09-14', status: 'draft', customNote: 'Conference next week!', createdAt: '2026-09-14T08:00:00Z' },
    });
    await createIssueBuilder({ store, drafter: drafter(), now: () => NOW }).build({});
    expect(store.written.get('newsletters/issue-2026-09-14')).toMatchObject({
      customNote: 'Conference next week!',
      createdAt: '2026-09-14T08:00:00Z',
    });
  });

  it('never rebuilds over an issue saved to Drafts', async () => {
    const store = makeStore({ content: [article] }, {
      'newsletters/issue-2026-09-14': { id: 'issue-2026-09-14', status: 'draft', savedAt: '2026-09-14T09:00:00Z' },
    });
    const result = await createIssueBuilder({ store, drafter: drafter(), now: () => NOW }).build({});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/saved in Drafts/);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('lands the issue in Drafts when asked to keep it, still as a draft', async () => {
    const store = makeStore({ content: [article] });
    const result = await createIssueBuilder({ store, drafter: drafter(), now: () => NOW }).build({
      days: 7,
      keep: true,
      keptBy: 'auto-build',
    });
    expect(result).toMatchObject({
      success: true,
      kept: true,
      issueId: 'issue-2026-09-14',
      subject: 'Landing zones, again',
      itemCount: 1,
      introError: null,
    });
    expect(store.written.get('newsletters/issue-2026-09-14')).toMatchObject({
      status: 'draft',
      savedAt: NOW.toISOString(),
      savedBy: 'auto-build',
    });
  });

  it('does not mark a build as saved unless asked to keep it', async () => {
    const store = makeStore({ content: [article] });
    const result = await createIssueBuilder({ store, drafter: drafter(), now: () => NOW }).build({});
    expect(result.kept).toBe(false);
    const doc = store.written.get('newsletters/issue-2026-09-14');
    expect(doc).not.toHaveProperty('savedAt');
    expect(doc).not.toHaveProperty('savedBy');
  });

  it('keeping still refuses to overwrite a kept or approved issue, and says why', async () => {
    const kept = makeStore({ content: [article] }, {
      'newsletters/issue-2026-09-14': { id: 'issue-2026-09-14', status: 'draft', savedAt: '2026-09-14T09:00:00Z', subject: 'Mine' },
    });
    const keptResult = await createIssueBuilder({ store: kept, drafter: drafter(), now: () => NOW }).build({ keep: true, keptBy: 'auto-build' });
    expect(keptResult).toMatchObject({ success: false, reason: 'kept' });
    expect(kept.upsertDoc).not.toHaveBeenCalled();
    expect(kept.written.get('newsletters/issue-2026-09-14').subject).toBe('Mine');

    const sent = makeStore({ content: [article] }, { 'newsletters/issue-2026-09-14': { id: 'issue-2026-09-14', status: 'sent' } });
    const sentResult = await createIssueBuilder({ store: sent, drafter: drafter(), now: () => NOW }).build({ keep: true });
    expect(sentResult).toMatchObject({ success: false, reason: 'locked', status: 'sent' });
    expect(sent.upsertDoc).not.toHaveBeenCalled();

    const empty = makeStore();
    expect(await createIssueBuilder({ store: empty, drafter: drafter(), now: () => NOW }).build({ keep: true })).toMatchObject({
      success: false,
      reason: 'empty',
    });
  });

  it('builds a deleted issue again from scratch', async () => {
    const store = makeStore({ content: [article] }, {
      'newsletters/issue-2026-09-14': {
        id: 'issue-2026-09-14',
        status: 'deleted',
        customNote: 'Old note',
        createdAt: '2026-09-14T08:00:00Z',
      },
    });
    const result = await createIssueBuilder({ store, drafter: drafter(), now: () => NOW }).build({});
    expect(result.success).toBe(true);
    const doc = store.written.get('newsletters/issue-2026-09-14');
    expect(doc).toMatchObject({ status: 'draft', customNote: '', createdAt: NOW.toISOString() });
  });

  it('never rebuilds an issue that has been approved', async () => {
    for (const status of ['sending', 'scheduled', 'sent']) {
      const store = makeStore({ content: [article] }, { 'newsletters/issue-2026-09-14': { id: 'issue-2026-09-14', status } });
      const result = await createIssueBuilder({ store, drafter: drafter(), now: () => NOW }).build({});
      expect(result.success, status).toBe(false);
      expect(store.upsertDoc, status).not.toHaveBeenCalled();
    }
  });

  it('strips markdown a model still emits', () => {
    expect(stripMarkdown('# Title\n- one\n- **two**\n1. three `code` _it_ [link](https://x)')).toBe(
      'Title\none\ntwo\nthree code it link'
    );
  });
});

describe('renderIssue', () => {
  const issue = {
    id: 'issue-2026-09-14',
    subject: 'Landing <zones> & more',
    periodStart: SINCE.toISOString(),
    periodEnd: NOW.toISOString(),
    intro: 'We covered a lot.\n\nSecond paragraph.',
    customNote: 'See you at <Ignite>.',
    sections: [
      { id: 'articles', title: 'New on HybridCloudWorks', items: [{ title: 'A "quoted" <title>', summary: 's', url: 'https://hybridcloudworks.com/a?x=1&y=2', label: 'Azure' }] },
    ],
  };

  it('escapes every stored value, so nothing in an issue becomes markup', () => {
    const { html } = renderIssue(issue, { postalAddress: '1 Main <St>' });
    expect(html).not.toContain('<zones>');
    expect(html).not.toContain('<Ignite>');
    expect(html).not.toContain('<title>A');
    expect(html).toContain('Landing &lt;zones&gt; &amp; more');
    expect(html).toContain('A &quot;quoted&quot; &lt;title&gt;');
    expect(html).toContain('href="https://hybridcloudworks.com/a?x=1&amp;y=2"');
    expect(html).toContain('1 Main &lt;St&gt;');
  });

  it('carries the postal address and Resend’s per-recipient unsubscribe link, in both parts', () => {
    const { html, text, subject } = renderIssue(issue, { postalAddress: 'PO Box 1\nAustin, TX' });
    expect(subject).toBe(issue.subject);
    expect(html).toContain(`href="${UNSUBSCRIBE_PLACEHOLDER}"`);
    expect(html).toContain('PO Box 1<br>Austin, TX');
    expect(text).toContain(`Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`);
    expect(text).toContain('PO Box 1\nAustin, TX');
    expect(text).toContain('https://hybridcloudworks.com/a?x=1&y=2');
  });

  it('re-checks every link at render, dropping unsafe items and emptied sections', () => {
    const unsafe = {
      ...issue,
      sections: [
        {
          id: 'articles',
          title: 'New on HybridCloudWorks',
          items: [
            { title: 'Script', url: 'javascript:alert(1)' },
            { title: 'Data', url: 'data:text/html,<b>x</b>' },
            { title: 'Plain http', url: 'http://example.com/x' },
            { title: 'Site path', url: '/azure/blog/ok' },
          ],
        },
        { id: 'gone', title: 'Only bad links', items: [{ title: 'Bad', url: 'vbscript:x' }] },
      ],
    };
    const { html, text } = renderIssue(unsafe, { postalAddress: 'x' });
    for (const bad of ['javascript:', 'data:text', 'http://example.com', 'vbscript:', 'Only bad links']) {
      expect(html, bad).not.toContain(bad);
      expect(text, bad).not.toContain(bad);
    }
    expect(html).toContain('href="https://hybridcloudworks.com/azure/blog/ok"');
  });

  it('dates the week it covers', () => {
    expect(renderIssue(issue, { postalAddress: 'x' }).html).toContain('HybridCloudWorks Weekly · Sep 7 – Sep 14');
  });

  it('puts the preheader first in the body as a hidden, escaped block followed by filler', () => {
    const { html, text } = renderIssue({ ...issue, preheader: 'Zones <b>& more</b>' }, { postalAddress: 'x' });
    const body = html.slice(html.indexOf('<body'));
    const firstDiv = body.indexOf('<div style="display:none');
    expect(firstDiv).toBeGreaterThan(-1);
    expect(firstDiv).toBeLessThan(body.indexOf('<table'));
    expect(body).toContain('>Zones &lt;b&gt;&amp; more&lt;/b&gt;</div>');
    expect(body).not.toContain('<b>');
    expect(body).toContain('&zwnj;&nbsp;');
    // Preview text is for the inbox list; the plain-text part does not repeat it.
    expect(text).not.toContain('Zones');
  });

  it('emits no preheader block when there is none', () => {
    for (const preheader of [undefined, '', '   ']) {
      expect(renderIssue({ ...issue, preheader }, { postalAddress: 'x' }).html, String(preheader)).not.toContain('display:none');
    }
  });

  it('renders a test send with an inert unsubscribe link and a note saying why', () => {
    const { html, text } = renderIssue(issue, { postalAddress: 'x', testSend: true });
    expect(html).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(text).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(html).toContain('href="#"');
    expect(html).toContain('unsubscribe link is inactive');
    expect(text).toContain('Unsubscribe: #');
    expect(renderIssue(issue, { postalAddress: 'x' }).html).not.toContain('unsubscribe link is inactive');
  });
});

describe('draftIntro and suggestSubjects', () => {
  const sections = [{ id: 'articles', title: 'New', items: [{ title: 'Zones', url: 'https://hybridcloudworks.com/z', summary: 'What changed' }] }];

  it('drafts the intro from the sections with the intro instruction, the same call the builder makes', async () => {
    const drafter = { generateDraft: vi.fn(async () => ({ title: '## Zones', postContent: '**We** wrote.' })) };
    expect(await draftIntro({ drafter, sections, subject: 'Fallback' })).toEqual({ subject: 'Zones', intro: 'We wrote.' });
    expect(drafter.generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ customInstructionPrompt: INTRO_INSTRUCTION, markdown: '## New\n- Zones — What changed', scrapedTitle: 'Fallback' })
    );
    const untitled = { generateDraft: vi.fn(async () => ({ postContent: 'x' })) };
    expect((await draftIntro({ drafter: untitled, sections, subject: 'Fallback' })).subject).toBe('Fallback');
  });

  it('suggests subjects through the drafter, and throws rather than return too few', async () => {
    const drafter = { generateDraft: vi.fn(async () => ({ title: 'One', keyTopics: ['Two', 'Three'] })) };
    expect(await suggestSubjects({ drafter, sections, subject: 's' })).toEqual(['One', 'Two', 'Three']);
    expect(drafter.generateDraft.mock.calls[0][0].customInstructionPrompt).toBe(SUBJECT_INSTRUCTION);
    const few = { generateDraft: vi.fn(async () => ({ title: 'One', keyTopics: 'not a list' })) };
    await expect(suggestSubjects({ drafter: few, sections, subject: 's' })).rejects.toThrow(/at least 3/);
  });
});
