/**
 * The Social Hub's Publer client and its social-post records (#575 moved this
 * out of SocialHubPage.jsx, which held it beside 900 lines of JSX).
 *
 * FINDING-04 (HIGH): API key removed from client. All Publer calls now route
 * through the `publerProxy` Azure Function which holds the key in Key Vault.
 *
 * The wrappers below are EXPORTED for their tests. They were not, and all five
 * defects in #463 lived in them — a job poll that could never succeed, an
 * undocumented delete, a rejected publish state — reachable only by driving the
 * whole Compose tab, so none of them was ever asserted. A request builder that
 * talks to a third-party API is worth testing on its own terms.
 *
 * Publer API reference: https://publer.com/docs/api-reference/introduction
 * (the publer.io help article this cited is not the API reference; five
 * defects in #463 came from building requests against it instead)
 */
import { postJSON, getJSON, sendJSON } from '@/lib/api';
import {
  describePublerFailure,
  publerAccountsStatus,
  readPublerErrors,
  unwrapPublerAccounts,
  unwrapPublerPosts,
} from '@/lib/publerAccounts';

// publerReady is always true — readiness is now determined by the function's
// ability to resolve its secrets, not by client-side env vars.
export const publerReady = () => true;

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
export function loadPublerAccounts(settle) {
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
export const publerListPosts = (state = 'scheduled', extra = {}) => {
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
  // Trimmed before the emptiness test, not after. `String('  ')` is truthy, so
  // an id that is only whitespace passed the guard and went out as
  // `post_ids[]=%20%20` — a request Publer answers for a post that does not
  // exist, from a caller that meant to send nothing. `deletePosts` in
  // `lib/timers/publer-sync.js` has always trimmed; this half had not, and the
  // two must agree because they build the same call.
  const id = String(postId ?? '').trim();
  if (!id) throw new Error('Cannot delete a Publer post without an id');
  const res = await publerFetch(`/posts?post_ids[]=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (res?.ok === false)
    throw new Error(`Publer refused the delete — ${describePublerEnvelope(res)}`);
  // `Array.isArray`, not `|| []`. A `deleted_ids` that came back as a string or
  // an object is falsy-free and would reach `.map`, throwing a TypeError from
  // inside a delete that may well have succeeded — the operator would see
  // "x.map is not a function" where the honest answer is "Publer did not say
  // this post was deleted".
  const deleted = Array.isArray(res?.data?.deleted_ids) ? res.data.deleted_ids.map(String) : [];
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

export async function saveSocialPost(data) {
  return postJSON('cms/social-posts', data);
}

export async function deleteSocialPostDoc(id) {
  return sendJSON(`cms/social-posts/${id}`, 'DELETE');
}

/** Default-status list (scheduled+published), newest first, capped at 50. */
export async function listSocialPosts(statuses) {
  const qs = statuses ? `?status=${statuses.join(',')}` : '';
  const res = await getJSON(`cms/social-posts${qs}`);
  return res.items || [];
}

/**
 * A Publer list response as `{ posts, notice }`: the posts and, when the proxy
 * said not configured or Publer refused, the sentence to show in their place.
 * A thrown call reads as a failure too, never as an empty queue.
 */
export function readPublerPosts(response) {
  const unwrapped = unwrapPublerPosts(response);
  let notice = '';
  if (unwrapped.notConfigured) {
    notice =
      unwrapped.reason || 'Publer is not configured — seed its keys on the Integrations page.';
  } else if (unwrapped.failed) {
    notice = `Could not read Publer: ${describePublerEnvelope(response)}`;
  }
  return { posts: unwrapped.posts, notice };
}

/** A thrown list call, as the refused envelope `readPublerPosts` knows how to read. */
export const publerCallFailed = (err) => ({
  ok: false,
  error: err?.message || 'the request failed',
});
