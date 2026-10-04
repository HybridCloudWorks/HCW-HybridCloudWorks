/**
 * The About page's certification orders, pinned (#842). Each case is a rule
 * the page applied inline before the sorting moved here; the expected order
 * is what that code produced.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyMicrosoft,
  featuredFirst,
  groupByIssuer,
  issuerComparator,
} from './certificationSorting';

const names = (certs) => certs.map((c) => c.name);

describe('classifyMicrosoft', () => {
  it('files Microsoft rows under 365, Azure or Education by prefix or role, else leaves them', () => {
    const ms = (name, code = '') => ({ name, code, issuer: 'Microsoft' });
    expect(classifyMicrosoft(ms('Teams Administrator', 'MS-700')).issuer).toBe('Microsoft 365');
    expect(classifyMicrosoft(ms('Copilot', 'AB-100')).issuer).toBe('Microsoft 365');
    expect(classifyMicrosoft(ms('Azure Administrator', 'AZ-104')).issuer).toBe('Microsoft Azure');
    expect(classifyMicrosoft(ms('Certified Trainer')).issuer).toBe('Microsoft Education');
    expect(classifyMicrosoft(ms('MCP Community Badge')).issuer).toBe('Microsoft');
    expect(classifyMicrosoft({ name: 'AZ-104', issuer: 'AWS' }).issuer).toBe('AWS');
  });
});

describe('featuredFirst', () => {
  it('puts featured rows first, then the global display order', () => {
    const rows = [
      { name: 'c', display_order: 2 },
      { name: 'b', display_order: 1, featured: true },
      { name: 'a', display_order: 1 },
    ];
    expect(names([...rows].sort(featuredFirst))).toEqual(['b', 'a', 'c']);
  });
});

describe('issuerComparator', () => {
  // [what the order is, the issuer, the rows as stored, the names in page order]
  it.each([
    [
      'AWS: Professional, Associate, Specialty, Practitioner; newest first inside a tier',
      'Amazon Web Services',
      [
        { name: 'Cloud Practitioner', issue_date: '2024-01-01' },
        { name: 'Solutions Architect Associate', issue_date: '2023-01-01' },
        { name: 'Solutions Architect Professional', issue_date: '2022-01-01' },
        { name: 'Developer Associate', issue_date: '2024-01-01' },
        { name: 'Security Specialty', issue_date: '2024-01-01' },
      ],
      [
        'Solutions Architect Professional',
        'Developer Associate',
        'Solutions Architect Associate',
        'Security Specialty',
        'Cloud Practitioner',
      ],
    ],
    [
      'Broadcom: Professional first, Double VCP last',
      'VMware',
      [{ name: 'VCP Double' }, { name: 'VCP' }, { name: 'VCAP Professional' }],
      ['VCAP Professional', 'VCP', 'VCP Double'],
    ],
    [
      'FinOps: certified tiers, then FOCUS, then the AI tier by level, then containers',
      'FinOps Foundation',
      [
        { name: 'FinOps for AI Level 3' },
        { name: 'FinOps Certified Practitioner' },
        { name: 'FOCUS Analyst' },
        { name: 'FinOps for AI Level 1' },
        { name: 'FinOps Certified Professional' },
        { name: 'FinOps for Containers' },
      ],
      [
        'FinOps Certified Professional',
        'FinOps Certified Practitioner',
        'FOCUS Analyst',
        'FinOps for AI Level 1',
        'FinOps for AI Level 3',
        'FinOps for Containers',
      ],
    ],
    [
      'Microsoft Azure: AZ, AI, SC, DP, PL prefixes, then Expert, Associate, Fundamentals',
      'Microsoft Azure',
      [
        { name: 'Data Fundamentals', code: 'DP-900' },
        { name: 'Azure Administrator Associate', code: 'AZ-104' },
        { name: 'Security Operations Analyst Associate', code: 'SC-200' },
        { name: 'Azure Solutions Architect Expert', code: 'AZ-305' },
        { name: 'Azure AI Engineer Associate', code: 'AI-102' },
      ],
      [
        'Azure Solutions Architect Expert',
        'Azure Administrator Associate',
        'Azure AI Engineer Associate',
        'Security Operations Analyst Associate',
        'Data Fundamentals',
      ],
    ],
    [
      'Microsoft 365: AB certs before MS certs, tiers inside each',
      'Microsoft 365',
      [
        { name: 'Teams Administrator Associate', code: 'MS-700' },
        { name: 'M365 Fundamentals', code: 'MS-900' },
        { name: 'Copilot Associate', code: 'AB-100' },
      ],
      ['Copilot Associate', 'Teams Administrator Associate', 'M365 Fundamentals'],
    ],
    [
      'Microsoft: the year in the name, newest first',
      'Microsoft',
      [{ name: 'MCP 2019' }, { name: 'MSCA 2024' }, { name: 'Community Badge' }],
      ['MSCA 2024', 'MCP 2019', 'Community Badge'],
    ],
    [
      'any other issuer: display order, then name',
      'HashiCorp',
      [
        { name: 'Vault Associate' },
        { name: 'Terraform Associate', display_order: 1 },
        { name: 'Consul Associate' },
      ],
      ['Terraform Associate', 'Consul Associate', 'Vault Associate'],
    ],
  ])('%s', (_label, issuer, rows, expected) => {
    expect(names([...rows].sort(issuerComparator(issuer)))).toEqual(expected);
  });
});

describe('groupByIssuer', () => {
  it('groups by issuer, Other for none, each group in its own order', () => {
    const grouped = groupByIssuer([
      { name: 'Cloud Practitioner', issuer: 'AWS' },
      { name: 'Solutions Architect Professional', issuer: 'AWS' },
      { name: 'Something' },
    ]);
    expect(Object.keys(grouped).sort()).toEqual(['AWS', 'Other']);
    expect(names(grouped.AWS)).toEqual(['Solutions Architect Professional', 'Cloud Practitioner']);
    expect(groupByIssuer(null)).toEqual({});
  });
});
