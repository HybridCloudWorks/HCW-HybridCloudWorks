import { describe, expect, it } from 'vitest';

import {
  ADMIN_ROLES,
  ENTRA_ADMIN_APP_ROLE,
  ROLE_CACHE_TTL_MS,
  ROLE_NAMES,
  minimumRole,
  roleLevel,
  satisfiesRole,
} from './roles.js';

/**
 * The 4x4 matrix is the cheapest test in the suite and the code it replaces
 * fails it. `requireAdminClaims(request, ['editor'])` used
 * `userRoles.includes('editor')`, so a publisher — who outranks an editor —
 * was DENIED. Site-Main admits them (`admin-auth.js:116-123`).
 */

describe('roleLevel', () => {
  it('orders the four roles', () => {
    expect(roleLevel('viewer')).toBe(1);
    expect(roleLevel('editor')).toBe(2);
    expect(roleLevel('publisher')).toBe(3);
    expect(roleLevel('super_admin')).toBe(4);
  });

  it('is case-insensitive, matching the source', () => {
    expect(roleLevel('EDITOR')).toBe(2);
    expect(roleLevel('Editor')).toBe(2);
  });

  it('sorts anything unrecognised below every real role', () => {
    // An unknown name must never satisfy a check.
    for (const bad of ['', null, undefined, 'admin', 'root', 'publishor', 'super-admin', 0, {}]) {
      expect(roleLevel(bad)).toBe(0);
    }
  });
});

describe('satisfiesRole — the full hierarchy matrix', () => {
  const expected = {
    // actual        viewer editor publisher super_admin  (required)
    viewer: [true, false, false, false],
    editor: [true, true, false, false],
    publisher: [true, true, true, false],
    super_admin: [true, true, true, true],
  };

  for (const [actual, results] of Object.entries(expected)) {
    for (const [i, required] of ROLE_NAMES.entries()) {
      const should = results[i];
      it(`${actual} ${should ? 'satisfies' : 'does not satisfy'} ${required}`, () => {
        expect(satisfiesRole(actual, required)).toBe(should);
      });
    }
  }

  it('admits a publisher where editor is required — the case the old code broke', () => {
    expect(satisfiesRole('publisher', 'editor')).toBe(true);
    expect(satisfiesRole('super_admin', 'editor')).toBe(true);
  });

  it('never satisfies an unrecognised requirement', () => {
    // A typo in a handler must close the endpoint, not open it.
    expect(satisfiesRole('super_admin', 'publishor')).toBe(false);
    expect(satisfiesRole('super_admin', '')).toBe(false);
    expect(satisfiesRole('super_admin', undefined)).toBe(false);
  });

  it('never satisfies anything for an unrecognised actual role', () => {
    expect(satisfiesRole('root', 'viewer')).toBe(false);
    expect(satisfiesRole('', 'viewer')).toBe(false);
  });
});

describe('minimumRole', () => {
  it('takes the least privileged of several, matching Math.min in the source', () => {
    expect(minimumRole(['publisher', 'editor'])).toBe('editor');
    expect(minimumRole(['super_admin', 'viewer', 'publisher'])).toBe('viewer');
  });

  it('accepts a bare string', () => {
    expect(minimumRole('editor')).toBe('editor');
  });

  it('normalises case', () => {
    expect(minimumRole('EDITOR')).toBe('editor');
  });

  it('returns null when nothing is recognised, so the caller can throw', () => {
    expect(minimumRole([])).toBeNull();
    expect(minimumRole('nonsense')).toBeNull();
    expect(minimumRole(undefined)).toBeNull();
  });

  it('ignores unrecognised entries alongside real ones', () => {
    expect(minimumRole(['nonsense', 'publisher'])).toBe('publisher');
  });
});

describe('constants', () => {
  it('defines exactly one App Role value', () => {
    expect(ENTRA_ADMIN_APP_ROLE).toBe('Admin');
  });

  it('states the revocation SLA as a number', () => {
    // The cache TTL is the window in which a demoted admin keeps their old
    // level. It is asserted so a change is a visible, reviewed decision.
    expect(ROLE_CACHE_TTL_MS).toBe(60_000);
  });

  it('keeps the four levels contiguous and ordered', () => {
    const levels = Object.values(ADMIN_ROLES).map((r) => r.level).sort((a, b) => a - b);
    expect(levels).toEqual([1, 2, 3, 4]);
  });

  it('exposes role names lowest-privilege first', () => {
    expect(ROLE_NAMES).toEqual(['viewer', 'editor', 'publisher', 'super_admin']);
  });
});
