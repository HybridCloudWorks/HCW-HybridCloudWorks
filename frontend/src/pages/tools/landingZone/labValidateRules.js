/**
 * The rules "Validate on the lab" decides by (#672), apart from React so each
 * is a pure function the tests hold directly: why the button is disabled,
 * what the line beside it says, what a finished job or a refusal says, what
 * one poll of the job means, and the payload the files become. The control
 * itself, its two hooks and its panels are LzLabValidate.jsx.
 */
import { buildLabPayload } from '@/lib/landingZone/labPayload';
import { isTerminalJobStatus } from '@/lib/labsPolling';

/** The server's cap on the encoded payload (ADR 0032 decision 6). */
export const MAX_LAB_PAYLOAD_BYTES = 64 * 1024;
/** Past this the page stops asking; the job's output stays readable for a day. */
export const POLL_DEADLINE_MS = 15 * 60 * 1000;

/**
 * The door codes the server answers with (functions/src/lib/labs/public-bounds.js
 * DOOR_CODES; public-lock.test.js there reads this list and fails when a code
 * is missing from it).
 */
export const DOOR_CODES = Object.freeze([
  'PUBLIC_SUBMISSION_CLOSED',
  'TURNSTILE_NOT_CONFIGURED',
  'LAB_AGENT_OFFLINE',
  'LAB_QUEUE_FULL',
  'LAB_STATUS_UNAVAILABLE',
]);

/**
 * The lock's 403s (functions/src/lib/labs/public-lock.js LOCK_CODES): the
 * server's own sentence is shown for these, as for its 400s and 429s.
 */
export const LOCK_CODES = Object.freeze([
  'ORIGIN_NOT_ALLOWED',
  'TURNSTILE_REQUIRED',
  'TURNSTILE_FAILED',
]);

export const LINES = Object.freeze({
  checking: 'Checking whether the lab is taking jobs…',
  unreadable: "The lab's status could not be read, so Validate on the lab is unavailable.",
  closedFallback: 'The lab is not taking public jobs yet.',
  noSiteKey:
    'Validate on the lab is not set up on this build of the site: it has no Cloudflare Turnstile site key.',
  browserCheck: 'Checking this browser with Cloudflare Turnstile before the lab takes a job…',
  browserInteractive:
    'Cloudflare wants to confirm a person is here: complete the check below, then validate.',
  browserError:
    "Cloudflare's browser check could not run here, so Validate on the lab is unavailable. Reload the page to try again.",
  browserMissing: 'The browser check has not finished yet. Wait for it, then validate.',
  empty: 'Add a component first: an empty build has no Terraform to validate.',
  ready:
    "Runs terraform init and terraform validate on these files in the lab's sandbox, with no network. Two an hour per visitor.",
  submitting: 'Sending the files to the lab…',
  queued: 'Queued on the lab…',
  running: 'Running on the lab…',
  stalled: 'The lab has not finished this job yet. It may still run; its output is kept for a day.',
});

/** The sentence for modules the runner image would leave for `init` to fail on. */
export function unresolvedLine(unresolved) {
  const names = unresolved.map((row) => `${row.module} ${row.constraint}`.trim()).join(', ');
  return `The lab's runner image does not vendor ${names}, which this build calls, so terraform init would fail there. Remove the components that need it to validate the rest, or validate the download where there is network.`;
}

/** Why the lab will not take the job, or null when its door is open. */
function doorReason(door) {
  if (door.phase === 'checking') return LINES.checking;
  if (door.phase === 'unreadable') return LINES.unreadable;
  return door.open === true ? null : door.reason || LINES.closedFallback;
}

/** Why this build cannot be validated there, or null when it can. */
function buildReason(hasTerraform, resolution) {
  if (!hasTerraform) return LINES.empty;
  return resolution.ok ? null : unresolvedLine(resolution.unresolved);
}

/** Where Cloudflare's browser check is (useLabTurnstile.js), or null once a token is held or spent. */
function browserReason(phase) {
  if (phase === 'ready' || phase === 'spent') return null;
  if (phase === 'interactive') return LINES.browserInteractive;
  if (phase === 'error') return LINES.browserError;
  return LINES.browserCheck;
}

/**
 * Why the button may not be pressed, as one line, or null when it may. The
 * door comes first, because a closed lab is the reason even for a build the
 * image could not validate anyway; then a build of the site with no Turnstile
 * site key, which no build of the files can fix; then the build; and last the
 * browser check, which is the only one that finishes by itself.
 *
 * @param {object} args
 * @param {{ phase: 'checking'|'known'|'unreadable', open?: boolean, reason?: string }} args.door
 * @param {boolean} args.hasTerraform
 * @param {{ ok: boolean, unresolved: object[] }} args.resolution
 * @param {string} args.siteKey  the build's Turnstile site key, '' when it had none
 * @param {string} args.check  useLabTurnstile's phase
 */
export function disabledReason({ door, hasTerraform, resolution, siteKey, check }) {
  return (
    doorReason(door) ??
    (siteKey ? null : LINES.noSiteKey) ??
    buildReason(hasTerraform, resolution) ??
    browserReason(check)
  );
}

/** Whether the widget should load: the server said open, and this build can run the check. */
export const turnstileActive = (door, siteKey) =>
  door.phase === 'known' && door.open === true && Boolean(siteKey);

/** The status read's answer as the door the button reads. */
export function doorFromStatus(answer) {
  return answer ? { phase: 'known', ...answer } : { phase: 'unreadable' };
}

/** A refusal that names the door shuts it with the server's sentence; any other leaves it. */
export function doorFromRefusal(error) {
  if (error?.status !== 503 || !DOOR_CODES.includes(error.code)) return null;
  return { phase: 'known', open: false, code: error.code, reason: error.message };
}

/** The door as a data attribute: its phase, or `open`, or the code that shut it. */
export function doorTag(door) {
  if (door.phase !== 'known') return door.phase;
  return door.open ? 'open' : door.code;
}

export const isBusy = (run) => run?.phase === 'submitting' || run?.phase === 'polling';

/** A run's progress while one is in flight, or null. */
function progressLine(run) {
  if (run.phase === 'submitting') return LINES.submitting;
  if (run.phase !== 'polling') return null;
  return run.job && run.job.status === 'queued' ? LINES.queued : LINES.running;
}

/** The line beside the button: the run's progress while one is in flight, otherwise the reason or what it does. */
export function statusLine(reason, run) {
  const progress = run ? progressLine(run) : null;
  return progress || reason || LINES.ready;
}

export function buttonLabel(run) {
  if (run?.phase === 'submitting') return 'Sending…';
  if (run?.phase === 'polling') return 'Validating…';
  return 'Validate on the lab';
}

/** What a finished job says, in a sentence above its output. */
export function outcomeLine(job) {
  switch (job.status) {
    case 'succeeded':
      return `terraform validate passed on the lab (exit ${job.exitCode ?? 0}).`;
    case 'failed':
      return `terraform init or validate failed on the lab (exit ${job.exitCode ?? 'unknown'}). Its output is below.`;
    case 'timeout':
      return 'The job ran out of time on the lab before Terraform finished.';
    case 'cancelled':
      return 'The job was cancelled before it ran.';
    default:
      return `The job ended as ${job.status}.`;
  }
}

/** What a refused or failed request says. The server's own sentence where it gave one. */
export function failureLine(error) {
  if ([400, 413, 429, 503].includes(error?.status)) return error.message;
  if (error?.status === 403 && LOCK_CODES.includes(error.code)) return error.message;
  if (error?.status === 404) return 'The lab no longer has this job. Its output is kept for a day.';
  return `The job could not be sent to the lab: ${error?.message ?? 'unknown error'}`;
}

/** A 404 or 503 while polling is the server's answer, not a transport failure. */
const isAnswer = (error) => Boolean(error) && [404, 503].includes(error.status);

/** A job still in flight, or a poll that failed in transit: stall at the deadline, else keep going. */
function stillPending(job, { errors, overdue }) {
  if (overdue) {
    return { update: job ? { phase: 'stalled', job } : { phase: 'stalled' }, stop: true, errors };
  }
  if (job) return { update: { job }, stop: false, errors: 0 };
  return { update: null, stop: false, errors: errors + 1 };
}

/**
 * What one poll of the job means for the run: the fields to record, whether
 * to stop, and how many transport failures in a row there have been (which
 * drives the backoff). A 404 or 503 is an answer, not a transient failure:
 * the job is gone, or the owner closed the path, and asking again will not
 * change either.
 *
 * @param {{ job?: object, error?: Error & { status?: number } }} step
 * @param {{ errors: number, elapsed: number, deadlineMs: number }} clock
 */
export function afterPoll(step, { errors, elapsed, deadlineMs }) {
  if (isAnswer(step.error)) {
    return { update: { phase: 'error', error: step.error }, stop: true, errors };
  }
  if (step.job && isTerminalJobStatus(step.job.status)) {
    return { update: { phase: 'done', job: step.job }, stop: true, errors: 0 };
  }
  return stillPending(step.job, { errors, overdue: elapsed >= deadlineMs });
}

/** The submission body for the files, or the error that stops it before it is sent. */
export async function preparePayload(files) {
  let built;
  try {
    built = await buildLabPayload(files);
  } catch {
    return { error: new Error('the payload could not be built in this browser') };
  }
  if (built.bytes <= MAX_LAB_PAYLOAD_BYTES) return { body: built.body };
  const error = new Error(
    `This build is ${built.bytes.toLocaleString('en-US')} bytes as a lab payload, and the lab takes at most ${MAX_LAB_PAYLOAD_BYTES.toLocaleString('en-US')}.`
  );
  error.status = 413;
  return { error };
}

/** A key that changes whenever any file does, so a result is held against exactly the files it validated. */
export const filesKey = (files) => files.map((f) => `${f.path}\u0000${f.content}`).join('\u0001');

/** A promise as `{ value }` or `{ error }`, so a step reads its outcome without a try. */
export const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
