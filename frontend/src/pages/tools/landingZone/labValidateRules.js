/**
 * The rules "Validate on the lab" decides by (#672), apart from React so each
 * is a pure function the tests hold directly: why the button is disabled,
 * what the line beside it says, what a finished job or a refusal says, what
 * one poll of the job means, and the payload the files become. The control
 * itself, its two hooks and its panels are LzLabValidate.jsx.
 *
 * VISITOR WORDS ONLY (owner direction 2026-09-28). Every sentence the control
 * shows is written here and chosen by the server's `code`, or by the status
 * when there is no code. The status read's `reason` and a refusal's `error`
 * are never rendered, so whatever a server message says — a vendor, a
 * setting, something an admin has to fix — it cannot reach the page. Every
 * closed door reads the same, because a visitor can do nothing about which
 * setting closed it; the code stays on the error and in the server's log.
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

/** The one door that opens by itself: a full queue drains. */
const BUSY_DOOR = 'LAB_QUEUE_FULL';

/** The codes this page raises itself, before or instead of asking the server. */
export const LOCAL_CODES = Object.freeze({
  tooLarge: 'PAYLOAD_TOO_LARGE',
  notBuilt: 'PAYLOAD_NOT_BUILT',
  checkPending: 'CHECK_PENDING',
});

export const LINES = Object.freeze({
  checking: 'Checking whether the lab is available…',
  unavailable:
    "Validation on the lab isn't available right now. You can still download the files and validate locally.",
  busy: 'The lab is busy right now. Try again in a few minutes, or download the files and validate locally.',
  browserCheck: 'Running a quick browser check before the lab takes a job…',
  browserInteractive: 'Please complete the check below, then validate.',
  browserError:
    "The browser check couldn't run here, so Validate on the lab is unavailable. Reload the page to try again.",
  browserMissing: 'The browser check has not finished yet. Wait for it, then validate.',
  empty: 'Add a component first: an empty build has no Terraform to validate.',
  ready:
    "Runs terraform init and terraform validate on these files in the lab's sandbox, with no network. Two an hour per visitor.",
  submitting: 'Sending the files to the lab…',
  queued: 'Queued on the lab…',
  running: 'Running on the lab…',
  stalled: 'The lab has not finished this job yet. It may still run; its output is kept for a day.',
  notBuilt:
    "The files couldn't be packaged in this browser. Download them and validate locally instead.",
  jobGone: 'The lab no longer has this job. Its output is kept for a day.',
  failed: 'Something went wrong. Please try again.',
});

/**
 * A refusal's sentence, by the code the server answered with
 * (functions/src/lib/labs/public-bounds.js DOOR_CODES and LIMIT_CODES,
 * public-lock.js LOCK_CODES, public-job.js JOB_NOT_FOUND).
 */
export const REFUSAL_LINES = Object.freeze({
  ...Object.fromEntries(
    DOOR_CODES.map((code) => [code, code === BUSY_DOOR ? LINES.busy : LINES.unavailable])
  ),
  ORIGIN_NOT_ALLOWED:
    'Validate on the lab works only from the Landing Zone Builder on hybridcloudworks.com.',
  TURNSTILE_REQUIRED:
    "The browser check didn't finish, so the lab didn't take the job. Reload the page and try again.",
  TURNSTILE_RATE_LIMITED:
    'Too many attempts from this browser in the last few minutes. Try again in about ten minutes.',
  TURNSTILE_FAILED: "The browser check didn't pass, so the lab didn't take the job. Try again.",
  TURNSTILE_UNAVAILABLE: "The browser check couldn't be completed just now. Try again in a minute.",
  LAB_RATE_LIMITED:
    "You've reached the limit for validation on the lab for now (two an hour). Try again in about an hour.",
  LAB_PAUSED_FOR_TODAY:
    "Validation on the lab has reached today's limit. Try again tomorrow, or download the files and validate locally.",
  JOB_NOT_FOUND: LINES.jobGone,
  [LOCAL_CODES.notBuilt]: LINES.notBuilt,
  [LOCAL_CODES.checkPending]: LINES.browserMissing,
});

/** An error this page raises itself, carrying a code like the server's. */
export function localError(code, fields = {}) {
  return Object.assign(new Error(code), { code, ...fields });
}

/** The sentence for a build over the cap: its size when this page measured it. */
export function tooLargeLine(bytes) {
  const limit = MAX_LAB_PAYLOAD_BYTES.toLocaleString('en-US');
  const size = Number.isFinite(bytes)
    ? ` (${bytes.toLocaleString('en-US')} bytes; the limit is ${limit})`
    : '';
  return `This build is too large for the lab${size}. Remove some components, or download the files and validate locally.`;
}

/** The sentence for modules the lab does not have, so `init` would fail there. */
export function unresolvedLine(unresolved) {
  const names = unresolved.map((row) => `${row.module} ${row.constraint}`.trim()).join(', ');
  return `The lab doesn't have ${names}, which this build calls, and it runs with no network, so terraform init would fail there. Remove the components that need it to validate the rest, or download the files and validate locally.`;
}

/** Why the lab will not take the job, or null when its door is open. */
function doorReason(door) {
  if (door.phase === 'checking') return LINES.checking;
  if (door.phase === 'unreadable') return LINES.unavailable;
  if (door.open === true) return null;
  return door.code === BUSY_DOOR ? LINES.busy : LINES.unavailable;
}

/** Why this build cannot be validated there, or null when it can. */
function buildReason(hasTerraform, resolution) {
  if (!hasTerraform) return LINES.empty;
  return resolution.ok ? null : unresolvedLine(resolution.unresolved);
}

/** Where the browser check is (useLabTurnstile.js), or null once a token is held or spent. */
function browserReason(phase) {
  if (phase === 'ready' || phase === 'spent') return null;
  if (phase === 'interactive') return LINES.browserInteractive;
  if (phase === 'error') return LINES.browserError;
  return LINES.browserCheck;
}

/**
 * Why the button may not be pressed, as one line, or null when it may. The
 * door comes first, because a closed lab is the reason even for a build the
 * lab could not validate anyway; then a build of the site with no browser-check
 * site key, which reads as the lab being unavailable because to a visitor it
 * is; then the build; and last the browser check, which is the only one that
 * finishes by itself.
 *
 * @param {object} args
 * @param {{ phase: 'checking'|'known'|'unreadable', open?: boolean, code?: string|null }} args.door
 * @param {boolean} args.hasTerraform
 * @param {{ ok: boolean, unresolved: object[] }} args.resolution
 * @param {string} args.siteKey  the build's Turnstile site key, '' when it had none
 * @param {string} args.check  useLabTurnstile's phase
 */
export function disabledReason({ door, hasTerraform, resolution, siteKey, check }) {
  return (
    doorReason(door) ??
    (siteKey ? null : LINES.unavailable) ??
    buildReason(hasTerraform, resolution) ??
    browserReason(check)
  );
}

/** Whether the widget should load: the server said open, and this build can run the check. */
export const turnstileActive = (door, siteKey) =>
  door.phase === 'known' && door.open === true && Boolean(siteKey);

/**
 * The status read's answer as the door the button reads: whether it is open
 * and the code that shut it. The answer's `reason` is dropped here, so no
 * server sentence is ever held, let alone shown.
 */
export function doorFromStatus(answer) {
  if (!answer) return { phase: 'unreadable' };
  return {
    phase: 'known',
    open: answer.open === true,
    code: typeof answer.code === 'string' ? answer.code : null,
  };
}

/** A refusal that names the door shuts it; any other leaves it. */
export function doorFromRefusal(error) {
  if (error?.status !== 503 || !DOOR_CODES.includes(error.code)) return null;
  return { phase: 'known', open: false, code: error.code };
}

/**
 * The door as a data attribute: its phase, `open`, `busy` for a full queue,
 * or `closed`. Never the code, which names what is behind the site.
 */
export function doorTag(door) {
  if (door.phase !== 'known') return door.phase;
  if (door.open) return 'open';
  return door.code === BUSY_DOOR ? 'busy' : 'closed';
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

/** The sentence for a refusal the code does not name, by its status. */
function lineForStatus(status) {
  if (status === 404) return LINES.jobGone;
  if (status === 429) return REFUSAL_LINES.LAB_RATE_LIMITED;
  if (status === 503) return LINES.unavailable;
  return LINES.failed;
}

/**
 * What a refused or failed request says: this file's sentence for the code,
 * else for the status, else "something went wrong". Never the error's own
 * message.
 */
export function failureLine(error) {
  if (error?.code === LOCAL_CODES.tooLarge || error?.status === 413)
    return tooLargeLine(error.bytes);
  return REFUSAL_LINES[error?.code] ?? lineForStatus(error?.status);
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
 * the job is gone, or the path has closed, and asking again will not change
 * either.
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
    return { error: localError(LOCAL_CODES.notBuilt) };
  }
  if (built.bytes <= MAX_LAB_PAYLOAD_BYTES) return { body: built.body };
  return { error: localError(LOCAL_CODES.tooLarge, { status: 413, bytes: built.bytes }) };
}

/** A key that changes whenever any file does, so a result is held against exactly the files it validated. */
export const filesKey = (files) => files.map((f) => `${f.path}\u0000${f.content}`).join('\u0001');

/** A promise as `{ value }` or `{ error }`, so a step reads its outcome without a try. */
export const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
