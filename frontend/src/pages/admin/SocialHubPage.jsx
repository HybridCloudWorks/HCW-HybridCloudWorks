/**
 * Social Hub — Publer Integration
 *
 * Schedule HCW articles to LinkedIn, X (Twitter), Facebook, Instagram, and YouTube
 * via Publer's bulk schedule API. Also supports manual / non-Publer platform posts.
 *
 * Publer API reference: https://publer.com/docs/api-reference/introduction
 * (the publer.io help article this cited is not the API reference; five
 * defects in #463 came from building requests against it instead)
 *
 * FINDING-04 fix: all Publer API calls are routed through the `publerProxy`
 * Azure Function. The PUBLER_API_KEY and PUBLER_WORKSPACE_ID are stored in
 * Azure Key Vault and never bundled into the client JS build.
 *
 * Required Azure Function App settings (prefer Key Vault references):
 *   PUBLER_API_KEY        — Publer API key
 *   PUBLER_WORKSPACE_ID   — Publer workspace ID
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { recordLegacyBlogsRead } from '@/lib/legacyBlogsTelemetry';
import {
  Share2,
  Calendar,
  Clock,
  CheckCircle,
  Loader2,
  ExternalLink,
  AlertCircle,
  Sparkles,
  Link,
  AtSign,
  Users,
  Camera,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { postJSON, getJSON, sendJSON } from '@/lib/api';
import {
  describePublerFailure,
  publerAccountsStatus,
  readPublerErrors,
  unwrapPublerAccounts,
} from '@/lib/publerAccounts';
import { fetchPublicContentList } from '@/lib/publicApi';
import { toMillis } from '@/lib/dateUtils';

// ── YouTube brand icon (no lucide equivalent) ─────────────────────────────────

const YoutubeIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

// ── Constants ─────────────────────────────────────────────────────────────────
// PUBLER_API_BASE removed — Publer calls now go through the publerProxy Cloud
// Function, not directly from the client (FINDING-04).

const PLATFORM_META = {
  linkedin: {
    label: 'LinkedIn',
    Icon: Link,
    color: 'text-[#0A66C2]',
    bg: 'bg-[#0A66C2]/10 border-[#0A66C2]/20',
  },
  twitter: {
    label: 'X / Twitter',
    Icon: AtSign,
    color: 'text-slate-900 dark:text-white',
    bg: 'bg-slate-900/10 border-slate-900/20 dark:bg-white/10 dark:border-white/20',
  },
  facebook: {
    label: 'Facebook',
    Icon: Users,
    color: 'text-[#1877F2]',
    bg: 'bg-[#1877F2]/10 border-[#1877F2]/20',
  },
  instagram: {
    label: 'Instagram',
    Icon: Camera,
    color: 'text-[#E1306C]',
    bg: 'bg-[#E1306C]/10 border-[#E1306C]/20',
  },
  youtube: {
    label: 'YouTube',
    Icon: YoutubeIcon,
    color: 'text-[#FF0000]',
    bg: 'bg-[#FF0000]/10 border-[#FF0000]/20',
  },
};

const TABS = [
  { id: 'compose', label: 'Compose & Schedule' },
  { id: 'queue', label: 'Scheduled Queue' },
  { id: 'published', label: 'Published' },
  { id: 'settings', label: 'Connection Settings' },
];

/** Same rule as LivePagesPage — content / blog is considered a published live page. */
function isLiveRecord(item) {
  const status = String(item?.contentStatus || '');
  if (item?.softDeletedAt || item?.softDeleteExpiresAt) return false;
  return item?.Live === true || item?.Status === 'Live' || status.startsWith('published_');
}

function getLiveTitle(item) {
  return item.Title || item.title || 'Untitled';
}

function getLiveUrl(item) {
  const explicit =
    item.slugPageUrl ||
    item.publishedUrl ||
    item.blogUrl ||
    item.publicUrl ||
    (item.curatedSubpagePath
      ? `https://hybridcloudworks.com${String(item.curatedSubpagePath).startsWith('/') ? item.curatedSubpagePath : `/${item.curatedSubpagePath}`}`
      : '');
  return explicit || '';
}

function getRecency(item) {
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

function getSelectedContentUrl(selectedContent) {
  if (!selectedContent) return '';
  const path = selectedContent.curatedSubpagePath || selectedContent.slugPageUrl || '';
  return path ? `https://hybridcloudworks.com${path}` : '';
}

function getScheduleValidationError({ ready, caption, selectedAccountIds }) {
  if (!ready) return 'Publer not configured';
  if (!caption.trim()) return 'Caption required';
  if (selectedAccountIds.length === 0) return 'Select at least one account';
  return '';
}

function getScheduleValidationDescription(validationError) {
  if (validationError === 'Publer not configured') return 'Check Connection Settings.';
  if (validationError === 'Caption required') return 'Write a caption before scheduling.';
  return '';
}

function buildScheduledPosts({ selectedAccountIds, accounts, text, scheduledTime }) {
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

function ScheduleButtonContent({ submitting, jobStatus, scheduledAt }) {
  if (submitting) {
    return (
      <>
        <Loader2 className="h-4 w-4 animate-spin" />{' '}
        {jobStatus === 'polling' ? 'Processing…' : 'Scheduling…'}
      </>
    );
  }

  if (scheduledAt) {
    return (
      <>
        <Calendar className="h-4 w-4" /> Schedule Post
      </>
    );
  }

  return (
    <>
      <Send className="h-4 w-4" /> Post Now
    </>
  );
}

// ── Publer API wrappers ───────────────────────────────────────────────────────
// FINDING-04 (HIGH): API key removed from client. All Publer calls now route
// through the `publerProxy` Azure Function which holds the key in Key Vault.
//
// The wrappers below are EXPORTED for their tests. They were not, and all five
// defects in #463 lived in them — a job poll that could never succeed, an
// undocumented delete, a rejected publish state — reachable only by driving the
// whole tab, so none of them was ever asserted. A request builder that talks to
// a third-party API is worth testing on its own terms.

// publerReady is always true — readiness is now determined by the function's
// ability to resolve its secrets, not by client-side env vars.
const publerReady = () => true;

/**
 * Route a Publer API request through the server-side publerProxy Azure Function.
 * The function enforces admin auth and injects the Publer credentials from
 * Azure Key Vault — no API key is ever sent to or stored on the client.
 *
 * @param {string} path - Publer API path, e.g. '/accounts'
 * @param {{ method?: string, body?: string }} options - fetch-style options
 */
async function publerFetch(path, options = {}) {
  return postJSON('publerProxy', {
    path,
    method: options.method || 'GET',
    body: options.body ? JSON.parse(options.body) : undefined,
  });
}

const publerListAccounts = () => publerFetch('/accounts');

/**
 * Load the account list for one tab and settle it into exactly one of three
 * outcomes. Both tabs used to read the response with `Array.isArray`, which the
 * proxy envelope never satisfies, so a connected workspace and an unseeded
 * integration and a failed call all rendered as "no accounts" (#397).
 * `unwrapPublerAccounts` is the same reader the Platform settings page uses.
 *
 * Note the two ways a call can fail. The proxy answers HTTP 200 whatever
 * happens, so Publer refusing the key arrives here as a *resolved* envelope
 * with `ok: false` — the `.catch()` below never sees it, and only `failed`
 * keeps it from being read as an empty workspace.
 *
 * @param {(settled: { accounts: Array<object>, status: 'ready' | 'not_configured' | 'error', error: string, reason: string }) => void} settle
 * @returns {() => void} cancel — safe to use as an effect cleanup
 */
function loadPublerAccounts(settle) {
  let cancelled = false;
  publerListAccounts()
    .then((response) => {
      if (cancelled) return;
      const unwrapped = unwrapPublerAccounts(response);
      settle({
        accounts: unwrapped.accounts,
        status: publerAccountsStatus(unwrapped),
        error: unwrapped.failed ? describePublerFailure(unwrapped) : '',
        reason: unwrapped.notConfigured ? unwrapped.reason : '',
      });
    })
    .catch((err) => {
      if (cancelled) return;
      settle({
        accounts: [],
        status: 'error',
        error: err?.message || 'the request failed',
        reason: '',
      });
    });
  return () => {
    cancelled = true;
  };
}

// `per_page` is a field of Publer's RESPONSE, not a parameter of the request
// (#463 item 5) — sending it was ignored upstream while describing the paging
// here as something it was not. `page` is the documented control, default 0.
const publerListPosts = (state = 'scheduled', extra = {}) => {
  const qs = new URLSearchParams({ state, ...extra }).toString();
  return publerFetch(`/posts?${qs}`);
};

/**
 * One failed proxy envelope as one sentence.
 *
 * The proxy answers HTTP 200 for every outcome, so a Publer failure arrives as
 * a RESOLVED promise with `ok: false` and never reaches a `.catch()`. Each
 * call site below therefore has to test `ok` itself; this turns what it finds
 * into the same sentence the Connections card shows, Publer's own `errors[]`
 * text included (#463 item 4).
 */
export function describePublerEnvelope(res) {
  return describePublerFailure({
    status: Number.isFinite(res?.status) ? res.status : null,
    reason: (typeof res?.error === 'string' && res.error) || readPublerErrors(res?.data),
  });
}

/**
 * Bulk-schedule, or publish immediately.
 *
 * TWO ENDPOINTS, not one with a different `state` (#463 item 3). Publer's
 * bulk states are `scheduled`, `auto` and `recycle`; `published` is a state a
 * post ends up in, not one that may be asked for, and sending it was refused.
 * An immediate publish is `POST /posts/schedule/publish` carrying
 * `state: 'scheduled'` with `scheduled_at` left off every account — the
 * missing timestamp is what means "now", and `buildScheduledPosts` already
 * omits it when there is no scheduled time.
 *
 * Returns the proxy envelope; `data.job_id` is Publer's.
 */
export const publerScheduleBulk = (bulk, { immediate = false } = {}) =>
  publerFetch(immediate ? '/posts/schedule/publish' : '/posts/schedule', {
    method: 'POST',
    body: JSON.stringify({ bulk }),
  });

/**
 * Delete one post, in the form Publer documents (#463 item 2).
 *
 * `DELETE /posts?post_ids[]=<id>`, answering `{ deleted_ids }` — NOT
 * `DELETE /posts/{id}`, which this sent and which Publer does not define.
 * The id must never fall out of the query: the documented meaning of
 * `DELETE /posts` with no `post_ids` is "delete every non-published post in
 * the workspace". That is why the id is checked before the call rather than
 * interpolated into a template that degrades to the dangerous form when it is
 * undefined.
 *
 * A 200 is not proof. An id absent from `deleted_ids` was not deleted, and
 * reporting it as gone leaves a post scheduled to publish under the owner's
 * name with nothing on the calendar to show for it.
 */
export async function publerDeletePost(postId) {
  const id = String(postId ?? '');
  if (!id) throw new Error('Cannot delete a Publer post without an id');
  const res = await publerFetch(`/posts?post_ids[]=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (res?.ok === false) throw new Error(`Publer refused the delete — ${describePublerEnvelope(res)}`);
  const deleted = (res?.data?.deleted_ids || []).map(String);
  if (!deleted.includes(id)) {
    throw new Error('Publer did not report this post as deleted — check the Publer queue');
  }
  return res;
}

const publerJobStatus = (jobId) => publerFetch(`/job_status/${jobId}`);

/** The states `GET /job_status/{id}` uses for a finished job. */
const JOB_DONE_STATES = ['completed', 'complete'];

/**
 * Per-account failures on an otherwise finished job, as one line.
 *
 * `payload.failures` is the difference between "nothing published" and "three
 * of four accounts published", and it was never read: a job that finished with
 * every account failing was reported to the operator as a success.
 */
export function describePublerJobFailures(payload) {
  const failures = payload?.failures;
  if (!failures || typeof failures !== 'object') return '';
  const entries = Array.isArray(failures)
    ? failures.map((failure) => [failure?.account_id ?? '', failure])
    : Object.entries(failures);
  return entries
    .map(([account, detail]) => {
      const message =
        typeof detail === 'string'
          ? detail
          : detail?.message || detail?.error || JSON.stringify(detail);
      if (!message) return '';
      return account ? `${account}: ${message}` : message;
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * Poll until the job finishes (max ~30 s).
 *
 * READS THE ENVELOPE, NOT THE PROXY'S HTTP STATUS (#463 item 1). `publerFetch`
 * resolves to `{ ok, status, data }` where `status` is the HTTP code, so
 * `res.status === 'complete'` compared `200` to a string and could never be
 * true. Every scheduled post therefore ran all fifteen polls, threw "Timed out
 * waiting for Publer job", skipped `saveSocialPost` and toasted "Failed to
 * schedule" — for a post Publer had accepted and would publish on time. The
 * job's own status is at `data.status`, and Publer spells it `completed`;
 * `complete` is accepted too so this cannot turn on one character again.
 */
export async function publerPollJob(jobId) {
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await publerJobStatus(jobId);
    if (res?.ok === false) {
      throw new Error(`Publer job status unavailable — ${describePublerEnvelope(res)}`);
    }
    const job = res?.data || {};
    const state = String(job.status || '').toLowerCase();
    if (JOB_DONE_STATES.includes(state)) {
      const failures = describePublerJobFailures(job.payload);
      if (failures) throw new Error(`Publer could not post to every account — ${failures}`);
      return job;
    }
    if (state === 'failed') {
      const failures = describePublerJobFailures(job.payload);
      throw new Error(`Publer job failed${failures ? ` — ${failures}` : ''}`);
    }
  }
  throw new Error('Timed out waiting for Publer job');
}

// ── Social-post API helpers (cms/social-posts; the server stamps createdAt) ───

async function saveSocialPost(data) {
  return postJSON('cms/social-posts', data);
}

async function deleteSocialPostDoc(id) {
  return sendJSON(`cms/social-posts/${id}`, 'DELETE');
}

/** Default-status list (scheduled+published), newest first, capped at 50. */
async function listSocialPosts(statuses) {
  const qs = statuses ? `?status=${statuses.join(',')}` : '';
  const res = await getJSON(`cms/social-posts${qs}`);
  return res.items || [];
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtDate(value) {
  if (!value) return '—';
  const d = value?.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function PlatformBadge({ provider }) {
  const meta = PLATFORM_META[provider?.toLowerCase()] || {};
  const { Icon, color, label } = meta;
  return (
    <Badge variant="outline" className={`text-[10px] capitalize gap-1 ${color || ''}`}>
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {label || provider}
    </Badge>
  );
}

// ── Account Checkbox ──────────────────────────────────────────────────────────

function AccountToggle({ account, selected, onToggle }) {
  const provider = account.provider?.toLowerCase() || '';
  const meta = PLATFORM_META[provider] || {};
  const { Icon, color, bg } = meta;
  const isOn = selected.includes(account.id);
  return (
    <button
      type="button"
      onClick={() => onToggle(account.id)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
        isOn ? `${bg} ${color} shadow-sm` : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {Icon ? <Icon className={`h-4 w-4 ${isOn ? color : ''}`} /> : null}
      <span className="truncate max-w-30">{account.name || account.provider}</span>
      {isOn && <CheckCircle className="h-3.5 w-3.5 ml-auto shrink-0" />}
    </button>
  );
}

// ── Publer account states ─────────────────────────────────────────────────────

/**
 * What the account list says when it has nothing to show. An unseeded
 * integration, a failed call and a genuinely empty workspace are three
 * different problems with three different fixes, and until #397 all three
 * rendered as the same "No accounts found."
 *
 * `atConnectionSettings` is true on the tab that holds the fix, where "go to
 * the Connection Settings tab" would be pointing at itself.
 */
function PublerAccountsNotice({ status, error, reason, atConnectionSettings = false }) {
  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
      </div>
    );
  }
  if (status === 'not_configured') {
    return (
      <p className="text-sm text-muted-foreground">
        <strong>Publer is not connected.</strong>{' '}
        {/* The proxy returns one code for a missing key and for a missing
            workspace id, so naming only the key would be a guess. Its `error`
            names the setting when it sends one; otherwise say both. */}
        {reason
          ? `${reason}, so Publer was never asked for accounts.`
          : 'PUBLER_API_KEY or PUBLER_WORKSPACE_ID is not set on the function app, so Publer was never asked for accounts.'}{' '}
        {atConnectionSettings
          ? 'Set both on the function app — as Key Vault references — then reload this page.'
          : 'Connect it in the Connection Settings tab.'}
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p className="text-sm text-destructive">
        <strong>Publer accounts could not be loaded</strong> — {error || 'the call failed'}. The
        list is empty because the call did not succeed, not because the workspace is.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      No accounts found. Add social accounts in{' '}
      <a
        href="https://app.publer.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline"
      >
        Publer
      </a>
      .
    </p>
  );
}

// ── Compose Tab ───────────────────────────────────────────────────────────────

export function ComposeTab({ recentContent, initialContentId }) {
  const { toast } = useToast();
  const ready = publerReady();

  // Publer accounts
  const [accounts, setAccounts] = useState([]);
  // 'loading' | 'ready' | 'not_configured' | 'error' — PublerAccountsNotice
  // says which, so an unseeded key never reads as an empty workspace (#397).
  const [accountsStatus, setAccountsStatus] = useState('loading');
  const [accountsError, setAccountsError] = useState('');
  const [accountsReason, setAccountsReason] = useState('');

  // Form state
  const [selectedContent, setSelectedContent] = useState(null);
  const [caption, setCaption] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobStatus, setJobStatus] = useState(null); // null | 'polling' | 'done' | 'error'

  useEffect(() => {
    if (!ready) return undefined;
    return loadPublerAccounts(({ accounts: list, status, error, reason }) => {
      setAccounts(list);
      setAccountsStatus(status);
      setAccountsError(error);
      setAccountsReason(reason);
    });
  }, [ready]);

  // Preselect content when deep-linked from the publish flow
  // (?tab=compose&contentId=...).
  useEffect(() => {
    if (!initialContentId) return;
    const match = recentContent.find((item) => item.id === initialContentId);
    if (match) {
      queueMicrotask(() => {
        setSelectedContent(match);
      });
    }
  }, [initialContentId, recentContent]);

  const toggleAccount = (id) =>
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleSelectContent = (item) => {
    setSelectedContent(item);
    setCaption('');
    setJobStatus(null);
  };

  const handleGenerateCaption = async () => {
    if (!selectedContent) return;
    setGeneratingCaption(true);
    try {
      const result = await postJSON('generateSocialCaption', {
        contentId: selectedContent.id,
        platforms: selectedAccountIds,
        title: selectedContent.Title || selectedContent.title || '',
        summary: selectedContent.Summary || selectedContent.summary || '',
        sourceUrl: selectedContent.sourceUrl || '',
      });
      setCaption(result.caption || '');
    } catch (err) {
      toast({
        title: 'Caption generation failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setGeneratingCaption(false);
    }
  };

  const handleSchedule = async () => {
    const validationError = getScheduleValidationError({ ready, caption, selectedAccountIds });
    if (validationError) {
      toast({
        title: validationError,
        description: getScheduleValidationDescription(validationError) || undefined,
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    setJobStatus(null);
    try {
      const url = getSelectedContentUrl(selectedContent);
      const text = url ? `${caption.trim()}\n\n${url}` : caption.trim();
      const scheduledTime = scheduledAt ? new Date(scheduledAt).toISOString() : null;
      // `scheduled` either way. Publishing now is the other ENDPOINT, not
      // another state (#463 item 3).
      const bulk = {
        state: 'scheduled',
        posts: buildScheduledPosts({ selectedAccountIds, accounts, text, scheduledTime }),
      };

      const scheduleRes = await publerScheduleBulk(bulk, { immediate: !scheduledTime });
      // A refused schedule resolves rather than throwing, so without this the
      // next lines would save a social post for a Publer job that never was.
      if (scheduleRes?.ok === false) throw new Error(describePublerEnvelope(scheduleRes));

      if (scheduleRes?.data?.job_id) {
        setJobStatus('polling');
        await publerPollJob(scheduleRes.data.job_id);
      }

      // Save to the social_posts content container
      await saveSocialPost({
        contentId: selectedContent?.id || null,
        caption: caption.trim(),
        url: url || null,
        accountIds: selectedAccountIds,
        platforms: selectedAccountIds.map(
          (id) => accounts.find((a) => a.id === id)?.provider || id
        ),
        scheduledAt: scheduledTime || null,
        publerJobId: scheduleRes?.data?.job_id || null,
        status: scheduledTime ? 'scheduled' : 'published',
      });

      setJobStatus('done');
      toast({
        title: scheduledTime ? 'Scheduled via Publer!' : 'Published via Publer!',
        description: `Sent to ${selectedAccountIds.length} account(s).`,
      });
      setCaption('');
      setScheduledAt('');
      setSelectedAccountIds([]);
    } catch (err) {
      setJobStatus('error');
      toast({ title: 'Failed to schedule', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Content Picker */}
      <div className="space-y-4">
        <Label className="text-sm font-semibold block">1. Pick published content</Label>

        {!ready && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>Publer not fully configured.</strong> Check the Connection Settings tab.
            </span>
          </div>
        )}

        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {recentContent.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No published content found.
            </p>
          )}
          {recentContent.map((item) => {
            const title = item.Title || item.title || 'Untitled';
            const provider = item['Cloud Provider'] || item.cloudProvider || '';
            const isSelected = selectedContent?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectContent(item)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                  isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  {provider && <p className="text-xs text-muted-foreground">{provider}</p>}
                </div>
                {isSelected && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Composer */}
      <div className="space-y-4">
        {/* Step 2 — Account picker */}
        <div>
          <Label className="text-sm font-semibold block mb-2">2. Choose Publer accounts</Label>
          {accounts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => (
                <AccountToggle
                  key={a.id}
                  account={a}
                  selected={selectedAccountIds}
                  onToggle={toggleAccount}
                />
              ))}
            </div>
          ) : (
            <PublerAccountsNotice
              status={accountsStatus}
              error={accountsError}
              reason={accountsReason}
            />
          )}
        </div>

        {/* Step 3 — Caption */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">3. Write your caption</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleGenerateCaption}
              disabled={!selectedContent || generatingCaption}
              className="text-xs h-7 gap-1.5"
            >
              {generatingCaption ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              AI Caption
            </Button>
          </div>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write your post caption here…"
            className="min-h-32 resize-none"
          />
          <p className="text-xs text-muted-foreground mt-1 text-right">{caption.length} chars</p>
        </div>

        {/* Step 4 — Schedule time */}
        <div>
          <Label className="text-sm font-semibold block mb-2">4. Schedule (optional)</Label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">Leave blank to post immediately.</p>
        </div>

        {/* Job status feedback */}
        {jobStatus === 'polling' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Waiting for Publer to process…
          </div>
        )}
        {jobStatus === 'done' && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle className="h-4 w-4" /> Done! Post queued in Publer.
          </div>
        )}

        <Button
          onClick={handleSchedule}
          disabled={submitting || !caption.trim() || selectedAccountIds.length === 0}
          className="w-full gap-2"
        >
          <ScheduleButtonContent
            submitting={submitting}
            jobStatus={jobStatus}
            scheduledAt={scheduledAt}
          />
        </Button>
      </div>
    </div>
  );
}

// ── Scheduled Queue Tab ───────────────────────────────────────────────────────

function QueueTab() {
  const { toast } = useToast();
  const ready = publerReady();

  const [publerPosts, setPublerPosts] = useState([]);
  const [localPosts, setLocalPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [publerRes, snap] = await Promise.all([
        ready
          ? publerListPosts('scheduled').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        listSocialPosts(),
      ]);
      setPublerPosts(publerRes?.data || []);
      setLocalPosts(snap);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [ready]);

  useEffect(() => {
    Promise.all([
      ready
        ? publerListPosts('scheduled').catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      listSocialPosts(),
    ])
      .then(([publerRes, snap]) => {
        setPublerPosts(publerRes?.data || []);
        setLocalPosts(snap);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [ready]);

  const handleDeletePubler = async (postId) => {
    setDeletingId(postId);
    try {
      await publerDeletePost(postId);
      setPublerPosts((prev) => prev.filter((p) => p.id !== postId));
      toast({ title: 'Post deleted from Publer' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteLocal = async (docId) => {
    setDeletingId(docId);
    try {
      await deleteSocialPostDoc(docId);
      setLocalPosts((prev) => prev.filter((p) => p.id !== docId));
      toast({ title: 'Post record removed' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-8 gap-3 text-destructive">
        <AlertCircle className="h-6 w-6" />
        <p className="text-sm">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            load();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const totalPubler = publerPosts.length;
  const totalLocal = localPosts.length;

  return (
    <div className="space-y-6">
      {/* Publer live queue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Publer Queue
            {totalPubler > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {totalPubler}
              </Badge>
            )}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="gap-1.5 h-7"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {!ready && (
          <p className="text-xs text-muted-foreground">
            Publer not configured — connect it in the Connection Settings tab to see live queue.
          </p>
        )}

        {ready && totalPubler === 0 && (
          <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
            <CheckCircle className="h-8 w-8 text-emerald-400" />
            <p className="text-sm font-medium">No scheduled posts in Publer</p>
          </div>
        )}

        {publerPosts.map((post) => {
          const text = post.caption || post.text || post.description || '—';
          const provider = post.network || post.provider || '';
          const accts = Array.isArray(post.accounts) ? post.accounts : [];
          const schedTime = post.scheduled_at;
          return (
            <Card key={post.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{text}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {provider && <PlatformBadge provider={provider} />}
                    {accts.map((a, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {a.name || a.id}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {fmtDate(schedTime)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className="capitalize text-[10px]">
                    {post.status || 'scheduled'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    disabled={deletingId === post.id}
                    onClick={() => handleDeletePubler(post.id)}
                  >
                    {deletingId === post.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Local social-post records */}
      {totalLocal > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            Local Records
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {totalLocal}
            </Badge>
          </h3>
          {localPosts.map((post) => (
            <Card key={post.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{post.caption || '—'}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {(post.platforms || []).map((p) => (
                      <PlatformBadge key={p} provider={p} />
                    ))}
                    {post.scheduledAt && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {fmtDate(post.scheduledAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="secondary"
                    className={`capitalize text-[10px] ${
                      post.status === 'published'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : ''
                    }`}
                  >
                    {post.status || 'scheduled'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    disabled={deletingId === post.id}
                    onClick={() => handleDeleteLocal(post.id)}
                  >
                    {deletingId === post.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Published Tab ─────────────────────────────────────────────────────────────

function PublishedTab({ recentContent }) {
  const ready = publerReady();
  const [publerPosts, setPublerPosts] = useState([]);
  const [hubPosts, setHubPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [publerRes, snap] = await Promise.all([
        ready
          ? publerListPosts('published').catch((e) => {
              setError(e.message);
              return { data: [] };
            })
          : Promise.resolve({ data: [] }),
        listSocialPosts(['published']).catch(() => []),
      ]);
      setPublerPosts(Array.isArray(publerRes?.data) ? publerRes.data : []);
      setHubPosts(snap);
    } finally {
      setLoading(false);
    }
  }, [ready]);

  useEffect(() => {
    queueMicrotask(() => {
      load();
    });
  }, [load]);

  // Track which Publer posts originated from this hub via publerJobId
  const hubJobIds = new Set(hubPosts.map((p) => p.publerJobId).filter(Boolean));

  return (
    <div className="space-y-8">
      {/* Section 1 — Live Pages on hybridcloudworks.com */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              Live Pages on hybridcloudworks.com
              {recentContent.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {recentContent.length}
                </Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              Blogs &amp; articles already published from the Content Library.
            </p>
          </div>
        </div>

        {recentContent.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No live pages found.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {recentContent.map((item) => {
              const title = getLiveTitle(item);
              const url = getLiveUrl(item);
              const provider = item['Cloud Provider'] || item.cloudProvider || '';
              return (
                <Card key={`${item.__source}-${item.id}`} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{title}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {provider && (
                          <Badge variant="outline" className="text-[10px]">
                            {provider}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {item.__source}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {fmtDate(item.publishedAt || item.updatedAt || item.createdAt)}
                        </span>
                      </div>
                    </div>
                    {url && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2 — Published in Publer */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              Published in Publer
              {publerPosts.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {publerPosts.length}
                </Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              Social posts already live on LinkedIn, X, Facebook, Instagram &amp; YouTube via
              Publer.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="gap-1.5 h-7"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {!ready && (
          <p className="text-xs text-muted-foreground">
            Publer not configured — connect it in the Connection Settings tab.
          </p>
        )}

        {ready && loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {ready && !loading && error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {ready && !loading && !error && publerPosts.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No published posts in Publer yet.
          </p>
        )}

        {publerPosts.map((post) => {
          const text = post.caption || post.text || post.description || '—';
          const provider = post.network || post.provider || '';
          const accts = Array.isArray(post.accounts) ? post.accounts : [];
          const publishedAt = post.published_at || post.scheduled_at || post.created_at;
          const fromHub = post.job_id ? hubJobIds.has(post.job_id) : false;
          const permalink = post.permalink || post.public_url || post.url;
          return (
            <Card key={post.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{text}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {provider && <PlatformBadge provider={provider} />}
                    {accts.map((a, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {a.name || a.id}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {fmtDate(publishedAt)}
                    </span>
                    {fromHub && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-pink-300 text-pink-600"
                      >
                        via Social Hub
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {permalink && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                      <a href={permalink} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

/**
 * Everything the browser can honestly say about the Publer credential, keyed by
 * the outcome of the one call that uses it.
 *
 * It cannot say more. FINDING-04 moved the key into Key Vault and the proxy
 * never returns it, so the accounts call is the only evidence this page has.
 * The card used to claim otherwise by calling `publerKey()` and `publerWsId()`,
 * which are defined nowhere in the bundle — reaching this tab threw a
 * ReferenceError before it could render (found while fixing #397).
 */
const PUBLER_CONNECTION = {
  loading: { dot: 'bg-muted-foreground/40', detail: 'Checking…' },
  ready: {
    dot: 'bg-emerald-500',
    detail: 'Connected — the proxy resolved its credentials and Publer answered.',
  },
  not_configured: {
    // One code covers a missing key and a missing workspace id, so the tile
    // names neither; the notice below reports whichever the server named.
    dot: 'bg-amber-500',
    detail: 'Not configured — a required app setting is missing.',
  },
  error: { dot: 'bg-destructive', detail: 'The accounts call failed' },
};

export function SettingsTab() {
  const [accounts, setAccounts] = useState([]);
  // 'loading' | 'ready' | 'not_configured' | 'error' — the same three outcomes
  // the Compose tab shows, from the same reader (#397).
  const [accountsStatus, setAccountsStatus] = useState('loading');
  const [accountsError, setAccountsError] = useState('');
  const [accountsReason, setAccountsReason] = useState('');

  useEffect(
    () =>
      loadPublerAccounts(({ accounts: list, status, error, reason }) => {
        setAccounts(list);
        setAccountsStatus(status);
        setAccountsError(error);
        setAccountsReason(reason);
      }),
    []
  );

  const connection = PUBLER_CONNECTION[accountsStatus] ?? PUBLER_CONNECTION.loading;

  return (
    <div className="max-w-2xl space-y-6">
      {/* API Connection status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publer API Connection</CardTitle>
          <CardDescription>
            The API key and workspace id live in Key Vault and are injected by the publerProxy
            function; the browser never sees them, so this card reports whether the proxy could use
            them rather than what they are.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <div className={`h-2.5 w-2.5 rounded-full ${connection.dot}`} />
            <div>
              <p className="text-xs font-semibold">Credentials</p>
              <p className="text-xs text-muted-foreground">
                {connection.detail}
                {accountsStatus === 'error' ? ` — ${accountsError || 'no reason given'}.` : ''}
              </p>
            </div>
          </div>

          <a
            href="https://app.publer.com/#/settings/access"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Manage API Keys in Publer <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>

      {/* Connected accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected Accounts</CardTitle>
          <CardDescription>Social accounts connected to your Publer workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {accounts.map((a) => {
                const meta = PLATFORM_META[a.provider?.toLowerCase()] || {};
                const { Icon, color, bg } = meta;
                return (
                  <div
                    key={a.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${bg || 'bg-muted/30'}`}
                  >
                    {Icon && <Icon className={`h-5 w-5 shrink-0 ${color}`} />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{a.name || a.social_id}</p>
                      <p className="text-xs text-muted-foreground capitalize">{a.provider}</p>
                    </div>
                    <CheckCircle className="h-4 w-4 text-emerald-500 ml-auto shrink-0" />
                  </div>
                );
              })}
            </div>
          ) : (
            <PublerAccountsNotice
              status={accountsStatus}
              error={accountsError}
              reason={accountsReason}
              atConnectionSettings
            />
          )}
        </CardContent>
      </Card>

      {/* Supported platforms reference — only platforms with connected accounts */}
      {(() => {
        const connectedIds = Array.from(
          new Set(
            (accounts || [])
              .map((a) => a.provider?.toLowerCase())
              .filter((id) => id && PLATFORM_META[id])
          )
        );
        if (connectedIds.length === 0) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supported Platforms</CardTitle>
              <CardDescription>Channels active in your Publer workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {connectedIds.map((id) => {
                  const { label, Icon, color, bg } = PLATFORM_META[id];
                  return (
                    <div key={id} className={`flex items-center gap-2 p-3 rounded-lg border ${bg}`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SocialHubPage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'compose';

  const [recentContent, setRecentContent] = useState([]);
  const [loadingContent, setLoadingContent] = useState(true);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    async function load() {
      try {
        const contentMerged = (await fetchPublicContentList({ limit: 250 }).catch(() => [])).map(
          (item) => ({ __source: 'content', ...item })
        );
        const shouldLoadLegacy = contentMerged.length === 0;
        const legacyItems = shouldLoadLegacy
          ? await fetchPublicContentList({ limit: 250, source: 'blogs' }).catch(() => [])
          : [];
        if (shouldLoadLegacy) {
          recordLegacyBlogsRead({
            source: 'SocialHubPage',
            details: { collectionPath: 'blogs', limit: 250 },
          });
        }
        const merged = [
          ...contentMerged,
          ...legacyItems.map((item) => ({ __source: 'blogs', ...item })),
        ];
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
        if (!cancelled) setRecentContent(live.slice(0, 50));
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  const setTab = (id) => setSearchParams({ tab: id });

  return (
    <div className="space-y-6">
      {/* Header */}
      <ServicePageHeader
        icon={Share2}
        title="Social Hub"
        service="Publer"
        connected={publerReady()}
        description="Schedule content to LinkedIn, X, Facebook, Instagram, and YouTube via Publer."
        accent="pink"
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'compose' &&
          (loadingContent ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ComposeTab
              recentContent={recentContent}
              initialContentId={searchParams.get('contentId') || ''}
            />
          ))}
        {activeTab === 'queue' && <QueueTab />}
        {activeTab === 'published' && <PublishedTab recentContent={recentContent} />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}
