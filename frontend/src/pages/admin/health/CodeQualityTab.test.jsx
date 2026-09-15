/**
 * What the Code and Security tab renders for each state the hook can be in.
 * The hook's ordering is tested in useCodeQuality.test.jsx; this is the view.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import CodeQualityTab from './CodeQualityTab';
import { CODE_QUALITY } from './codeQuality.fixture';

const state = (overrides) => ({
  requested: true,
  loading: false,
  refreshing: false,
  data: null,
  notConfigured: null,
  error: '',
  refresh: vi.fn(),
  ...overrides,
});

const renderTab = (code) =>
  render(
    <MemoryRouter>
      <CodeQualityTab code={code} />
    </MemoryRouter>
  );

describe('CodeQualityTab', () => {
  it('shows grades, totals, top rules and top files for a successful read', () => {
    renderTab(state({ data: CODE_QUALITY }));

    const grades = within(screen.getByRole('list', { name: 'Qlty grades' }));
    expect(grades.getByText('Maintainability')).toBeTruthy();
    expect(grades.getByText('B')).toBeTruthy();
    expect(grades.getByText('F')).toBeTruthy();
    expect(grades.getByText('64.4%')).toBeTruthy();
    expect(grades.getByText('3%')).toBeTruthy();

    expect(screen.getByText('1353')).toBeTruthy();
    expect(screen.getByText('Unclassified: 1')).toBeTruthy();
    expect(screen.getByText('Security issues')).toBeTruthy();

    const rules = within(screen.getByRole('table', { name: 'Top rules' }));
    const link = rules.getByText('detect-eval').closest('a');
    expect(link.getAttribute('href')).toBe(CODE_QUALITY.issuesUrl);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(rules.getByText('semgrep')).toBeTruthy();

    const files = within(screen.getByRole('table', { name: 'Top files' }));
    expect(files.getByText('functions/src/lib/big.js').closest('a').getAttribute('href')).toBe(
      CODE_QUALITY.issuesUrl
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('warns when the read was truncated', () => {
    renderTab(state({ data: { ...CODE_QUALITY, truncated: 'time' } }));
    expect(screen.getByRole('note').textContent).toMatch(/time budget/);
  });

  it('says Qlty is not configured, with the Keys tab and the project link', () => {
    renderTab(
      state({
        notConfigured: {
          ok: false,
          code: 'INTEGRATION_NOT_CONFIGURED',
          projectUrl: CODE_QUALITY.projectUrl,
        },
      })
    );
    expect(screen.getByText('Qlty is not configured.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Integrations Keys tab' }).getAttribute('href')).toBe(
      '/admin/integrations?tab=keys'
    );
    expect(
      screen.getByRole('link', { name: /Open the project on Qlty/ }).getAttribute('href')
    ).toBe(CODE_QUALITY.projectUrl);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refused read as an error with Try again', () => {
    const code = state({ error: 'Qlty answered 429' });
    renderTab(code);
    expect(screen.getByRole('alert').textContent).toContain('Qlty answered 429');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(code.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows loading, and disables Refresh while a read is in flight', () => {
    renderTab(state({ loading: true }));
    expect(screen.getByText(/Reading Qlty/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh/ }).disabled).toBe(true);
  });
});
