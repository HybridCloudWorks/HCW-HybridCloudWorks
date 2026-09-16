/**
 * The Social Hub's pure view helpers and its platform table (#575).
 *
 * Everything here is a function of its arguments — no React, no fetch — so a
 * tab component can be read for what it renders rather than for how it derives
 * what it renders.
 */
import { brandIconFor } from '@/components/shared/BrandIcon';
import { toMillis } from '@/lib/dateUtils';

// Real brand marks, not stand-ins (#498). lucide-react v1 dropped its brand
// icons and this map had been using a chain link, an @, two heads and a
// camera in their place — and had no entry at all for Threads, which joined
// the workspace after it was written. With three accounts of near-identical
// names the owner could not tell which chip was which, which is the one job
// an icon has here.
export const PLATFORM_META = {
  linkedin: {
    label: 'LinkedIn',
    Icon: brandIconFor('linkedin'),
    color: 'text-[#0A66C2]',
    bg: 'bg-[#0A66C2]/10 border-[#0A66C2]/20',
  },
  twitter: {
    label: 'X / Twitter',
    Icon: brandIconFor('twitter'),
    color: 'text-slate-900 dark:text-white',
    bg: 'bg-slate-900/10 border-slate-900/20 dark:bg-white/10 dark:border-white/20',
  },
  facebook: {
    label: 'Facebook',
    Icon: brandIconFor('facebook'),
    color: 'text-[#1877F2]',
    bg: 'bg-[#1877F2]/10 border-[#1877F2]/20',
  },
  instagram: {
    label: 'Instagram',
    Icon: brandIconFor('instagram'),
    color: 'text-[#E1306C]',
    bg: 'bg-[#E1306C]/10 border-[#E1306C]/20',
  },
  threads: {
    label: 'Threads',
    Icon: brandIconFor('threads'),
    color: 'text-slate-900 dark:text-white',
    bg: 'bg-slate-900/10 border-slate-900/20 dark:bg-white/10 dark:border-white/20',
  },
  youtube: {
    label: 'YouTube',
    Icon: brandIconFor('youtube'),
    color: 'text-[#FF0000]',
    bg: 'bg-[#FF0000]/10 border-[#FF0000]/20',
  },
};

/** Same rule as LivePagesPage — content / blog is considered a published live page. */
export function isLiveRecord(item) {
  const status = String(item?.contentStatus || '');
  if (item?.softDeletedAt || item?.softDeleteExpiresAt) return false;
  return item?.Live === true || item?.Status === 'Live' || status.startsWith('published_');
}

export function getLiveTitle(item) {
  return item.Title || item.title || 'Untitled';
}

/**
 * The fields that already carry a whole URL, in the order they are trusted.
 * A list rather than a chain of `||`: the chain had a ternary with its own
 * nested ternary hanging off the end of it, which is the one expression
 * `qlty:boolean-logic` objects to in this file.
 */
const LIVE_URL_FIELDS = ['slugPageUrl', 'publishedUrl', 'blogUrl', 'publicUrl'];

/** A curated path (with or without its leading slash) as an absolute URL. */
function curatedUrl(path) {
  if (!path) return '';
  const rooted = String(path).startsWith('/') ? path : `/${path}`;
  return `https://hybridcloudworks.com${rooted}`;
}

export function getLiveUrl(item) {
  const explicit = LIVE_URL_FIELDS.map((field) => item[field]).find(Boolean);
  return explicit || curatedUrl(item.curatedSubpagePath) || '';
}

export function getRecency(item) {
  return Math.max(
    toMillis(item?.publishedDate),
    toMillis(item?.datePublished),
    toMillis(item?.['Published At']),
    toMillis(item?.blogPublishedAt),
    toMillis(item?.publishedAt),
    toMillis(item?.updatedAt),
    toMillis(item?.createdAt)
  );
}

/**
 * The live pages from one or more merged reads, de-duplicated by public URL,
 * newest first. Two reads can name the same page — the content container and
 * the legacy blogs container both do — and a duplicate in the picker is a post
 * scheduled twice.
 */
export function selectLivePages(merged, limit = 50) {
  const seen = new Set();
  const live = [];
  for (const item of merged) {
    if (!isLiveRecord(item)) continue;
    const url = getLiveUrl(item);
    const key = (url || `${item.__source}:${item.id}`).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    live.push(item);
  }
  live.sort((a, b) => getRecency(b) - getRecency(a));
  return live.slice(0, limit);
}

export function getSelectedContentUrl(selectedContent) {
  if (!selectedContent) return '';
  const path = selectedContent.curatedSubpagePath || selectedContent.slugPageUrl || '';
  return path ? `https://hybridcloudworks.com${path}` : '';
}

export function getScheduleValidationError({ ready, caption, selectedAccountIds }) {
  if (!ready) return 'Publer not configured';
  if (!caption.trim()) return 'Caption required';
  if (selectedAccountIds.length === 0) return 'Select at least one account';
  return '';
}

export function getScheduleValidationDescription(validationError) {
  if (validationError === 'Publer not configured') return 'Check the Settings tab.';
  if (validationError === 'Caption required') return 'Write a caption before scheduling.';
  return '';
}

export function buildScheduledPosts({ selectedAccountIds, accounts, text, scheduledTime }) {
  return selectedAccountIds.map((accountId) => {
    const account = accounts.find((a) => a.id === accountId);
    const provider = account?.provider?.toLowerCase() || 'linkedin';
    return {
      networks: {
        [provider]: { type: 'status', text },
      },
      accounts: [
        {
          id: accountId,
          ...(scheduledTime ? { scheduled_at: scheduledTime } : {}),
        },
      ],
    };
  });
}

/** The first non-empty string among `values`, or `fallback`: Publer fields are not always strings. */
export const firstText = (values, fallback = '') =>
  values.find((value) => typeof value === 'string' && value.trim()) ?? fallback;

/**
 * A readable date, or a dash. `Intl.DateTimeFormat#format` THROWS a RangeError
 * on an invalid date, so one malformed timestamp took the whole page down.
 */
export function fmtDate(value) {
  if (!value) return '—';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** The platforms with at least one connected account, in PLATFORM_META order. */
export function connectedPlatformIds(accounts) {
  const connected = new Set(
    (accounts || []).map((account) => account.provider?.toLowerCase()).filter(Boolean)
  );
  return Object.keys(PLATFORM_META).filter((id) => connected.has(id));
}

/** The day an ISO/epoch timestamp falls on, as `YYYY-MM-DD`, or '' if unreadable. */
export function dayKey(value) {
  const ms = toMillis(value);
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A day heading: "Mon, Sep 15", or "Undated" for a post with no usable stamp. */
export function dayLabel(key) {
  if (!key) return 'Undated';
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'Undated';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** When Publer says a post went out. Its own `published_at` first. */
export function postWhen(post) {
  return post?.published_at || post?.scheduled_at || post?.created_at;
}

/**
 * Posts grouped into days, newest day first, for the Published calendar (#575).
 *
 * Undated posts are their own group at the end rather than dropped: a post
 * Publer returned with no timestamp still published, and losing it from the
 * history would be the worse error.
 */
export function groupByDay(posts) {
  const days = new Map();
  for (const post of posts) {
    const key = dayKey(postWhen(post));
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(post);
  }
  return [...days.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0;
      // '' (undated) sorts last whichever side it is on.
      if (!a) return 1;
      if (!b) return -1;
      return a < b ? 1 : -1;
    })
    .map(([key, items]) => ({ key, label: dayLabel(key), posts: items }));
}

/**
 * Per-account outcomes for one published post, when Publer sent them.
 *
 * Only fields that are present are reported. An account with no state is
 * listed with an empty one rather than assumed to have succeeded — this hub
 * has already shipped a bug (#463) where a job whose every account failed was
 * reported as a success, and inventing a state here is the same mistake one
 * layer up.
 */
export function postResults(post) {
  const accounts = Array.isArray(post?.accounts) ? post.accounts : [];
  return accounts.map((account) => ({
    id: firstText([account?.id], ''),
    name: firstText([account?.name, account?.id], 'account'),
    provider: firstText([account?.provider, account?.network]),
    state: firstText([account?.state, account?.status]),
    error: firstText([account?.error, account?.message, account?.failure]),
  }));
}
