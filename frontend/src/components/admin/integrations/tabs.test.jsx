/**
 * Where old Integrations addresses land (#570). `/admin/connections` and
 * `/admin/api-keys` are redirects in App.jsx built from LEGACY_ROUTES; this
 * renders those same routes in a real router and reads where it ended up.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router';

import { LEGACY_ROUTES, MOVED_TABS, TABS, resolveTab, tabHref } from './tabs';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin">
          <Route path="integrations" element={<Where />} />
          {LEGACY_ROUTES.map(({ path: from, to }) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('old addresses', () => {
  it('sends /admin/api-keys to the Keys tab', () => {
    renderAt('/admin/api-keys');
    expect(screen.getByTestId('where').textContent).toBe('/admin/integrations?tab=keys');
  });

  it('sends /admin/connections to the Overview tab, where every service’s status is', () => {
    renderAt('/admin/connections');
    expect(screen.getByTestId('where').textContent).toBe('/admin/integrations?tab=overview');
  });

  it('points every redirect at a tab that exists', () => {
    const ids = TABS.map((tab) => tab.id);
    for (const { to } of LEGACY_ROUTES) {
      const tab = new URL(to, 'https://example.test').searchParams.get('tab');
      expect(ids).toContain(tab);
    }
  });
});

describe('resolveTab', () => {
  it('keeps a real tab, follows a moved one, and falls back to Overview', () => {
    expect(resolveTab('identity')).toBe('identity');
    expect(resolveTab('api-keys')).toBe('keys');
    expect(resolveTab('nonsense')).toBe('overview');
    expect(resolveTab(null)).toBe('overview');
  });

  it('never moves a tab id to a tab that does not exist', () => {
    const ids = new Set(TABS.map((tab) => tab.id));
    for (const target of Object.values(MOVED_TABS)) expect(ids.has(target)).toBe(true);
  });

  it('builds a link to a tab', () => {
    expect(tabHref('keys')).toBe('/admin/integrations?tab=keys');
  });
});
