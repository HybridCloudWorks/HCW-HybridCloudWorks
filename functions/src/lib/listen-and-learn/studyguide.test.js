/**
 * Study-guide parsing.
 *
 * This is the most fragile module in the feature: it reads someone else's HTML
 * and everything downstream keys off what it returns. The assertions that
 * matter are the refusals — a half-parsed guide would publish confident,
 * contentless episodes, and an empty parse must be an error rather than an
 * empty list.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  StudyGuideError,
  SUPPORTED_PROVIDERS,
  fetchStudyGuide,
  parseStudyGuide,
  searchTerms,
  slugify,
  weightLabel,
} from './studyguide.js';

const learnPage = (body) => `<html><body><h1>Study guide for Exam AZ-104</h1>${body}</body></html>`;

const SKILLS = `
  <h2>Skills measured as of April 17, 2026</h2>
  <h3>Skills at a glance</h3>
  <ul><li>Manage Azure identities and governance (20–25%)</li><li>Configure and manage storage (15–20%)</li></ul>
  <h3>Manage Azure identities and governance (20–25%)</h3>
  <h4>Manage Microsoft Entra users and groups</h4>
  <ul><li>Create users and groups</li><li>Manage licenses in Microsoft Entra ID</li></ul>
  <h4>Manage access to Azure resources</h4>
  <ul><li>Assign built-in Azure roles</li></ul>
  <h3>Configure and manage storage (15–20%)</h3>
  <h4>Configure access to storage</h4>
  <ul><li>Configure Azure Storage firewalls</li></ul>
  <h2>Study resources</h2>
  <ul><li>Microsoft Learn training</li></ul>
`;

const parseLearn = (body) =>
  parseStudyGuide(learnPage(body), {
    provider: 'microsoft',
    examCode: 'az-104',
    sourceUrl: 'https://learn.microsoft.com/az-104',
  });

describe('helpers', () => {
  it('slugifies a heading into a stable document id', () => {
    expect(slugify('Manage Azure identities and governance')).toBe(
      'manage-azure-identities-and-governance'
    );
    expect(slugify('  Design & build  ')).toBe('design-build');
  });

  it('formats a weight range, a single percentage, and none at all', () => {
    expect(weightLabel(20, 25)).toBe('20–25%');
    expect(weightLabel(15, null)).toBe('15%');
    expect(weightLabel(15, 15)).toBe('15%');
    expect(weightLabel(null, null)).toBe('');
  });

  it('searches on sub-headings before the area name', () => {
    // "Manage Microsoft Entra users and groups" finds teaching content;
    // the area name mostly finds exam-cram overviews.
    expect(searchTerms({ name: 'Area', subheadings: ['Sub A', 'Sub B'] })).toEqual([
      'Sub A',
      'Sub B',
      'Area',
    ]);
  });

  it('declares the providers it can actually parse', () => {
    expect([...SUPPORTED_PROVIDERS].sort()).toEqual(['aws', 'microsoft']);
  });
});

describe('Microsoft Learn', () => {
  it('extracts weighted areas with their sub-headings and objectives', () => {
    const guide = parseLearn(SKILLS);

    expect(guide.examCode).toBe('AZ-104');
    expect(guide.areas.map((a) => a.name)).toEqual([
      'Manage Azure identities and governance',
      'Configure and manage storage',
    ]);

    const [identities] = guide.areas;
    expect(identities.slug).toBe('manage-azure-identities-and-governance');
    expect(identities.weightLow).toBe(20);
    expect(identities.weightHigh).toBe(25);
    expect(identities.weightLabel).toBe('20–25%');
    expect(identities.subheadings).toEqual([
      'Manage Microsoft Entra users and groups',
      'Manage access to Azure resources',
    ]);
    expect(identities.objectives).toEqual([
      'Create users and groups',
      'Manage licenses in Microsoft Entra ID',
      'Assign built-in Azure roles',
    ]);
  });

  it('attaches objectives to the sub-heading they sit under', () => {
    // The script prompt requires coverage section by section; a flat list
    // invites the model to summarise the theme and skip the specifics.
    const [identities] = parseLearn(SKILLS).areas;
    expect(identities.sections).toEqual([
      {
        title: 'Manage Microsoft Entra users and groups',
        objectives: ['Create users and groups', 'Manage licenses in Microsoft Entra ID'],
      },
      { title: 'Manage access to Azure resources', objectives: ['Assign built-in Azure roles'] },
    ]);
  });

  it('skips the "Skills at a glance" summary, which repeats every area', () => {
    // Parsing it would duplicate every area and double every weighting.
    const guide = parseLearn(SKILLS);
    expect(guide.areas).toHaveLength(2);
  });

  it('stops at the section that ends the skills region', () => {
    // "Microsoft Learn training" sits under Study resources and is not an
    // objective of the last area.
    const guide = parseLearn(SKILLS);
    expect(guide.areas.at(-1).objectives).toEqual(['Configure Azure Storage firewalls']);
  });

  it('does not absorb bullets under a non-weighted heading', () => {
    const guide = parseLearn(`
      <h3>Manage identities (20–25%)</h3>
      <h4>Users</h4><ul><li>Create users</li></ul>
      <h3>Audience profile</h3>
      <ul><li>You should be familiar with PowerShell</li></ul>
    `);
    expect(guide.areas).toHaveLength(1);
    expect(guide.areas[0].objectives).toEqual(['Create users']);
  });

  it('dedupes a bullet repeated between the objectives and the change log', () => {
    const guide = parseLearn(`
      <h3>Manage identities (20%)</h3>
      <h4>Users</h4><ul><li>Create users</li><li>Create users</li></ul>
    `);
    expect(guide.areas[0].objectives).toEqual(['Create users']);
  });

  it('ignores navigation and tables, which are links rather than objectives', () => {
    const guide = parseLearn(`
      <h3>Manage identities (20%)</h3>
      <h4>Users</h4>
      <nav><ul><li>Skip to content</li></ul></nav>
      <table><tr><td><ul><li>Some table row</li></ul></td></tr></table>
      <ul><li>Create users</li></ul>
    `);
    expect(guide.areas[0].objectives).toEqual(['Create users']);
  });

  it('accepts a plain hyphen and a single percentage', () => {
    const guide = parseLearn(`
      <h3>Manage identities (20-25%)</h3><h4>A</h4><ul><li>x</li></ul>
      <h3>Monitor resources (15%)</h3><h4>B</h4><ul><li>y</li></ul>
    `);
    expect(guide.areas.map((a) => a.weightLabel)).toEqual(['20–25%', '15%']);
  });

  it('throws rather than returning a guide with no areas', async () => {
    // An empty parse is the failure that would publish five contentless
    // episodes, so it must never look like success.
    expect(() => parseLearn('<h2>Something else</h2><p>No skills here</p>')).toThrow(
      StudyGuideError
    );
    expect(() => parseLearn('')).toThrow(/layout may have changed/);
  });
});

describe('AWS', () => {
  const INDEX = `<html><body><h1>AWS Certified Solutions Architect</h1>
    <a href="/domain-1.html">Content Domain 1: Design Secure Architectures (30% of scored content)</a>
    <a href="/domain-2.html">Content Domain 2: Design Resilient Architectures (26% of scored content)</a>
    <a href="/domain-1.html">Content Domain 1: Design Secure Architectures (30% of scored content)</a>
  </body></html>`;

  const DOMAIN = `<html><body>
    <h3>Topics</h3><ul><li>Task 1.1: Design secure access</li></ul>
    <h3>Task 1.1: Design secure access</h3>
    <ul><li>Apply AWS security best practices</li><li>Design a flexible authorization model</li></ul>
    <h3>Task Statement 1.2: Design secure workloads</h3>
    <ul><li>Apply encryption at rest</li></ul>
  </body></html>`;

  const fetchAws = (pages = {}) =>
    fetchStudyGuide({
      provider: 'aws',
      examCode: 'saa-c03',
      sourceUrl: 'https://docs.aws.amazon.com/saa-c03/index.html',
      fetchPage: vi.fn(async (url) =>
        url.endsWith('index.html') ? INDEX : (pages[url] ?? DOMAIN)
      ),
    });

  it('reads weighted domains from the index and dedupes repeated links', async () => {
    const guide = await fetchAws();
    expect(guide.areas.map((a) => a.name)).toEqual([
      'Design Secure Architectures',
      'Design Resilient Architectures',
    ]);
    expect(guide.areas[0].weightLabel).toBe('30%');
  });

  it('follows each domain sub-page for its task statements', async () => {
    const guide = await fetchAws();
    const [secure] = guide.areas;

    // Both spellings of a task heading are recognised; matching only one
    // silently produced domains with zero objectives.
    expect(secure.subheadings).toEqual([
      'Task 1.1: Design secure access',
      'Task Statement 1.2: Design secure workloads',
    ]);
    expect(secure.objectives).toEqual([
      'Apply AWS security best practices',
      'Design a flexible authorization model',
      'Apply encryption at rest',
    ]);
  });

  it('drops the per-domain docs link, which the site has no use for', async () => {
    const guide = await fetchAws();
    expect(guide.areas[0]).not.toHaveProperty('url');
  });

  it('keeps a domain whose sub-page will not load, name and weighting intact', async () => {
    const guide = await fetchStudyGuide({
      provider: 'aws',
      examCode: 'saa-c03',
      sourceUrl: 'https://docs.aws.amazon.com/saa-c03/index.html',
      fetchPage: vi.fn(async (url) => {
        if (url.endsWith('index.html')) return INDEX;
        throw new Error('502');
      }),
    });

    expect(guide.areas).toHaveLength(2);
    expect(guide.areas[0].objectives).toEqual([]);
    expect(guide.areas[0].weightLabel).toBe('30%');
  });

  it('throws when the index lists no weighted domains', async () => {
    await expect(
      fetchStudyGuide({
        provider: 'aws',
        examCode: 'saa-c03',
        sourceUrl: 'https://docs.aws.amazon.com/x',
        fetchPage: async () => '<html><body><a href="/x">Overview</a></body></html>',
      })
    ).rejects.toThrow(/No weighted content domains/);
  });
});

describe('fetchStudyGuide', () => {
  it('refuses a provider with no adapter, naming the ones there are', async () => {
    await expect(
      fetchStudyGuide({
        provider: 'oracle',
        examCode: 'x',
        sourceUrl: 'https://x',
        fetchPage: async () => '<html></html>',
      })
    ).rejects.toThrow(/No study-guide parser for provider "oracle". Supported: aws, microsoft./);
  });

  it('refuses a missing URL before fetching anything', async () => {
    const fetchPage = vi.fn();
    await expect(
      fetchStudyGuide({ provider: 'microsoft', examCode: 'AZ-104', sourceUrl: '', fetchPage })
    ).rejects.toThrow(/No study guide URL for AZ-104/);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('passes the fetched page through the provider adapter', async () => {
    const guide = await fetchStudyGuide({
      provider: 'microsoft',
      examCode: 'az-104',
      sourceUrl: 'https://learn.microsoft.com/az-104',
      fetchPage: async () => learnPage(SKILLS),
    });
    expect(guide.areas).toHaveLength(2);
    expect(guide.sourceUrl).toBe('https://learn.microsoft.com/az-104');
  });
});
