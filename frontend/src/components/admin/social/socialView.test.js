/**
 * The Social Hub's pure view helpers (#575).
 *
 * The three that are new here are the ones worth guarding: `selectLivePages`
 * is what keeps one page out of the composer's picker twice, `groupByDay` is
 * the Published calendar, and `postResults` reports per-account outcomes
 * WITHOUT inventing one — the mistake #463 shipped one layer down, where a job
 * whose every account failed was reported as a success.
 */
import { describe, expect, it } from 'vitest';
import {
  connectedPlatformIds,
  dayKey,
  fmtDate,
  firstText,
  groupByDay,
  postResults,
  postWhen,
  selectLivePages,
} from './socialView';

const live = (over = {}) => ({ __source: 'content', Live: true, id: 'a', ...over });

describe('selectLivePages', () => {
  it('keeps only live records', () => {
    const rows = selectLivePages([
      live({ id: 'a' }),
      { __source: 'content', id: 'b', Live: false },
      { __source: 'content', id: 'c', contentStatus: 'published_blog' },
      { __source: 'content', id: 'd', contentStatus: 'draft' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('drops a soft-deleted record even when it still says Live', () => {
    expect(selectLivePages([live({ id: 'a', softDeletedAt: '2026-09-01' })])).toEqual([]);
  });

  it('de-duplicates by public URL across the two containers', () => {
    // The same page read from `content` and from legacy `blogs` is one page.
    // Scheduling it twice is the bug this prevents.
    const rows = selectLivePages([
      live({ id: 'a', slugPageUrl: 'https://hybridcloudworks.com/x', publishedAt: 2 }),
      { __source: 'blogs', Live: true, id: 'b', slugPageUrl: 'https://hybridcloudworks.com/x' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('a');
  });

  it('keeps two URL-less records apart by source and id', () => {
    const rows = selectLivePages([live({ id: 'a' }), { __source: 'blogs', Live: true, id: 'a' }]);
    expect(rows).toHaveLength(2);
  });

  it('sorts newest first and honours the cap', () => {
    const rows = selectLivePages(
      [
        live({ id: 'old', publishedAt: '2026-01-01T00:00:00Z' }),
        live({ id: 'new', publishedAt: '2026-09-01T00:00:00Z' }),
        live({ id: 'mid', publishedAt: '2026-05-01T00:00:00Z' }),
      ],
      2
    );
    expect(rows.map((r) => r.id)).toEqual(['new', 'mid']);
  });
});

describe('groupByDay', () => {
  const post = (id, when) => ({ id, published_at: when });

  it('groups posts into days, newest day first', () => {
    const days = groupByDay([
      post('a', '2026-09-10T09:00:00Z'),
      post('b', '2026-09-12T09:00:00Z'),
      post('c', '2026-09-10T18:00:00Z'),
    ]);
    expect(days.map((d) => d.posts.length)).toEqual([1, 2]);
    expect(days[0].posts[0].id).toBe('b');
  });

  it('keeps an undated post rather than dropping it, at the end', () => {
    // A post Publer returned with no timestamp still published; losing it from
    // the history would be the worse error.
    const days = groupByDay([post('a', '2026-09-10T09:00:00Z'), { id: 'z' }]);
    expect(days).toHaveLength(2);
    expect(days[1].label).toBe('Undated');
    expect(days[1].posts[0].id).toBe('z');
  });

  it('is empty for no posts', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('falls back through scheduled_at and created_at for the day', () => {
    expect(postWhen({ scheduled_at: 's' })).toBe('s');
    expect(postWhen({ created_at: 'c' })).toBe('c');
    expect(postWhen({ published_at: 'p', scheduled_at: 's' })).toBe('p');
  });

  it('treats an unreadable timestamp as undated rather than throwing', () => {
    expect(dayKey('not a date')).toBe('');
    expect(dayKey(undefined)).toBe('');
  });
});

describe('postResults', () => {
  it('reports each account, and reports no state as no state', () => {
    // An account Publer said nothing about must not be shown as succeeded.
    const [only] = postResults({ accounts: [{ id: 'acc-1', name: 'HCW on LinkedIn' }] });
    expect(only.name).toBe('HCW on LinkedIn');
    expect(only.state).toBe('');
    expect(only.error).toBe('');
  });

  it('carries the state and the error Publer sent', () => {
    const [failed] = postResults({
      accounts: [{ id: 'acc-2', name: 'HCW on X', status: 'failed', error: 'token expired' }],
    });
    expect(failed.state).toBe('failed');
    expect(failed.error).toBe('token expired');
  });

  it('is empty for a post with no accounts array', () => {
    expect(postResults({})).toEqual([]);
    expect(postResults({ accounts: 'nope' })).toEqual([]);
    expect(postResults(null)).toEqual([]);
  });

  it('names an account with no name after its id, and never renders an object', () => {
    const [anon] = postResults({ accounts: [{ name: { html: '<b>x</b>' } }] });
    expect(anon.name).toBe('account');
  });
});

describe('connectedPlatformIds', () => {
  it('lists only the platforms with a connected account', () => {
    expect(
      connectedPlatformIds([{ provider: 'LinkedIn' }, { provider: 'twitter' }, { provider: 'x' }])
    ).toEqual(['linkedin', 'twitter']);
  });

  it('is empty for no accounts, and for a missing list', () => {
    expect(connectedPlatformIds([])).toEqual([]);
    expect(connectedPlatformIds(undefined)).toEqual([]);
  });
});

describe('the fallbacks a Publer field needs', () => {
  it('firstText skips non-strings and blanks', () => {
    expect(firstText([null, 42, '  ', 'ok'], '—')).toBe('ok');
    expect(firstText([{ html: 'x' }], '—')).toBe('—');
  });

  it('fmtDate returns a dash rather than throwing a RangeError', () => {
    expect(fmtDate('not a date')).toBe('—');
    expect(fmtDate(null)).toBe('—');
  });
});
