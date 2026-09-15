/**
 * Reading the Code and Security summary, and the report section built from
 * it. Missing metrics are tolerated; the section appears only for a
 * successful read.
 */
import { describe, it, expect } from 'vitest';

import {
  categoryRows,
  codeQualityReportLines,
  formatPercent,
  readTiles,
  safeHref,
  truncatedNote,
  withCodeQuality,
} from './codeQuality';
import { CODE_QUALITY } from './codeQuality.fixture';

describe('readTiles', () => {
  it('reads each tile by key and leaves a missing one empty', () => {
    expect(readTiles(CODE_QUALITY.metrics)).toEqual([
      { label: 'Maintainability', grade: 'B', percent: null },
      { label: 'Security', grade: 'F', percent: null },
      { label: 'Coverage', grade: null, percent: '64.4%' },
      { label: 'Duplication', grade: null, percent: '3%' },
      { label: 'Technical debt', grade: null, percent: null },
    ]);
  });

  it('survives no metrics at all', () => {
    expect(readTiles(undefined).every((tile) => !tile.grade && !tile.percent)).toBe(true);
  });
});

describe('the small readers', () => {
  it('formats only real numbers as percentages', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatPercent('7')).toBe('7%');
    expect(formatPercent('n/a')).toBeNull();
    expect(formatPercent(null)).toBeNull();
  });

  it('lets only https links through', () => {
    expect(safeHref('https://qlty.sh/x')).toBe('https://qlty.sh/x');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it('orders categories largest first', () => {
    expect(categoryRows(CODE_QUALITY.byCategory).map((row) => row.name)).toEqual([
      'structure',
      'lint',
      'security',
    ]);
    expect(categoryRows(null)).toEqual([]);
  });

  it('warns for either kind of truncation and not for a complete read', () => {
    expect(truncatedNote('pages')).toMatch(/floor/);
    expect(truncatedNote('time')).toMatch(/floor/);
    expect(truncatedNote(false)).toBeNull();
  });
});

describe('the report section', () => {
  it('says it was not loaded when there is no successful read', () => {
    expect(codeQualityReportLines(null)).toEqual([
      'Code and Security: not loaded in this session.',
    ]);
    expect(codeQualityReportLines({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' })).toHaveLength(
      1
    );
  });

  it('summarises grades, totals, security and the top five rules', () => {
    const text = codeQualityReportLines(CODE_QUALITY).join('\n');
    expect(text).toContain('### Code and Security — Qlty');
    expect(text).toContain('- As of: 2026-09-14T10:00:00.000Z');
    expect(text).toContain(
      '- Grades: Maintainability B, Security F, Coverage 64.4%, Duplication 3%, Technical debt n/a'
    );
    expect(text).toContain(
      '- Open issues: 1353 (high 12, medium 340, low 900, note 100, fmt 0, unclassified 1)'
    );
    expect(text).toContain('- Security issues: 48 (high 10, medium 30, low 8, note 0, fmt 0)');
    expect(text).toContain('  - semgrep:detect-eval (high) — 20');
    expect(text).toContain('  - trivy:CVE-1 (high) — 5');
    expect(text).not.toContain('E501');
  });

  it('puts a grade and its coverage percentage side by side when both exist', () => {
    const metrics = [...CODE_QUALITY.metrics, { key: 'COV', valueType: 'grade', value: 'C' }];
    const text = codeQualityReportLines({ ...CODE_QUALITY, metrics, truncated: 'pages' }).join(
      '\n'
    );
    expect(text).toContain('Coverage C (64.4%)');
    expect(text).toContain('- Note: ');
  });

  it('appends to the diagnostics report', () => {
    expect(withCodeQuality('## Admin diagnostics', null)).toBe(
      '## Admin diagnostics\n\nCode and Security: not loaded in this session.'
    );
  });
});
