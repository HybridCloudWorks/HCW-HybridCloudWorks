/**
 * "Validate on the lab" (#672, Phase 6 of #657): send the build's files to
 * the Hybrid Lab, where the `terraform-validate` job runs `terraform init
 * -backend=false` and `terraform validate` in the runner image with no
 * network, and show what Terraform said.
 *
 * CLOSED UNTIL THE SERVER SAYS OPEN. On mount the control asks
 * `GET public/labs/submit` whether a job would be taken, and until the
 * answer is `open: true` the button is disabled with one line saying why:
 * public submission is switched off (the default, ADR 0032 decision 6), no
 * lab agent is online, the queue is full, or the status could not be read.
 * That line is text, never a spinner: a spinner says "wait", and waiting
 * would not open a door the owner has closed. The pre-rendered page carries
 * the "checking" line, which is the same markup the first client render
 * produces, so hydration adopts it.
 *
 * THE FILES ARE SENT UNCHANGED. The payload is the download (labPayload.js):
 * registry `source` and `version` lines stay, and the lab rewrites them to
 * its vendored copies inside the job (ADR 0032 decision 5). Before sending,
 * labImage.js predicts that rewrite with the image's own rule, and a build
 * calling a module the image does not vendor is refused here with the
 * module named, rather than spending one of the visitor's two jobs an hour
 * on an `init` that cannot succeed.
 *
 * ONLY ON A CLICK, and the answer is keyed to the files it validated, as the
 * explain button's is: change the build and the output goes away rather
 * than describing files no longer on the page, and polling stops.
 *
 * Two hooks carry the state: `useLabDoor` (the status read) and `useLabRun`
 * (one submission and its polling). Everything they decide with is a pure
 * function exported beside them, so the tests can hold each rule directly.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { labModuleReport, labResolution } from '@/lib/landingZone';
import { buildLabPayload } from '@/lib/landingZone/labPayload';
import { isTerminalJobStatus, jobPollDelay } from '@/lib/labsPolling';
import { fetchLabSubmissionStatus, fetchPublicLabJob, submitLabValidation } from '@/lib/publicApi';
import { HINT_CLASS } from './styles';

/** The server's cap on the encoded payload (ADR 0032 decision 6). */
export const MAX_LAB_PAYLOAD_BYTES = 64 * 1024;
/** Past this the page stops asking; the job's output stays readable for a day. */
export const POLL_DEADLINE_MS = 15 * 60 * 1000;

/** The door codes the server answers with (functions/src/lib/labs/public-submit.js DOOR_CODES). */
export const DOOR_CODES = Object.freeze([
  'PUBLIC_SUBMISSION_CLOSED',
  'LAB_AGENT_OFFLINE',
  'LAB_QUEUE_FULL',
  'LAB_STATUS_UNAVAILABLE',
]);

export const LINES = Object.freeze({
  checking: 'Checking whether the lab is taking jobs…',
  unreadable: "The lab's status could not be read, so Validate on the lab is unavailable.",
  closedFallback: 'The lab is not taking public jobs yet.',
  empty: 'Add a component first: an empty build has no Terraform to validate.',
  ready:
    "Runs terraform init and terraform validate on these files in the lab's sandbox, with no network. Two an hour per visitor.",
  submitting: 'Sending the files to the lab…',
  queued: 'Queued on the lab…',
  running: 'Running on the lab…',
  stalled: 'The lab has not finished this job yet. It may still run; its output is kept for a day.',
});

const DEFAULT_REQUESTS = Object.freeze({
  status: fetchLabSubmissionStatus,
  submit: submitLabValidation,
  job: fetchPublicLabJob,
});

/** The sentence for modules the runner image would leave for `init` to fail on. */
export function unresolvedLine(unresolved) {
  const names = unresolved.map((row) => `${row.module} ${row.constraint}`.trim()).join(', ');
  return `The lab's runner image does not vendor ${names}, which this build calls, so terraform init would fail there. Remove the components that need it to validate the rest, or validate the download where there is network.`;
}

/**
 * Why the button may not be pressed, as one line, or null when it may.
 * The door comes first: a closed lab is the reason even for a build the
 * image could not validate anyway.
 *
 * @param {object} args
 * @param {{ phase: 'checking'|'known'|'unreadable', open?: boolean, reason?: string }} args.door
 * @param {boolean} args.hasTerraform
 * @param {{ ok: boolean, unresolved: object[] }} args.resolution
 */
export function disabledReason({ door, hasTerraform, resolution }) {
  if (door.phase === 'checking') return LINES.checking;
  if (door.phase === 'unreadable') return LINES.unreadable;
  if (door.open !== true) return door.reason || LINES.closedFallback;
  if (!hasTerraform) return LINES.empty;
  if (!resolution.ok) return unresolvedLine(resolution.unresolved);
  return null;
}

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
const doorTag = (door) => {
  if (door.phase !== 'known') return door.phase;
  return door.open ? 'open' : door.code;
};

const isBusy = (run) => run?.phase === 'submitting' || run?.phase === 'polling';

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
  if (error?.status === 404) return 'The lab no longer has this job. Its output is kept for a day.';
  return `The job could not be sent to the lab: ${error?.message ?? 'unknown error'}`;
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

/** A 404 or 503 while polling is the server's answer, not a transport failure. */
const isAnswer = (error) => Boolean(error) && [404, 503].includes(error.status);

/** A job still in flight, or a poll that failed in transit: stall at the deadline, else keep going. */
function stillPending(job, { errors, overdue }) {
  if (overdue)
    return { update: job ? { phase: 'stalled', job } : { phase: 'stalled' }, stop: true, errors };
  if (job) return { update: { job }, stop: false, errors: 0 };
  return { update: null, stop: false, errors: errors + 1 };
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
const filesKey = (files) => files.map((f) => `${f.path}\u0000${f.content}`).join('\u0001');

/** A promise as `{ value }` or `{ error }`, so a step reads its outcome without a try. */
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );

/** The door: `checking` until the status read answers, then what it said. */
function useLabDoor(requests) {
  const [door, setDoor] = useState({ phase: 'checking' });
  useEffect(() => {
    let cancelled = false;
    settle(requests.status()).then(({ value, error }) => {
      if (!cancelled) setDoor(error ? { phase: 'unreadable' } : doorFromStatus(value));
    });
    return () => {
      cancelled = true;
    };
  }, [requests]);
  return [door, setDoor];
}

/**
 * One submission and its polling, held against the files it sent.
 * `onRefusal` hears every refused submission, so the door can shut.
 */
function useLabRun({ files, key, requests, pollDelay, deadlineMs, now, onRefusal }) {
  const [record, setRecord] = useState(null);
  const timer = useRef(null);
  const liveKey = useRef(key);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  // A new build stops watching the old one's job.
  useEffect(() => {
    liveKey.current = key;
    return () => clearTimeout(timer.current);
  }, [key]);

  const update = (runKey, next) =>
    setRecord((prev) => (prev?.key === runKey ? { ...prev, ...next } : prev));
  const stillWatching = (runKey) => mounted.current && liveKey.current === runKey;

  const watch = (runKey, jobId, errors, startedAt) => {
    timer.current = setTimeout(async () => {
      const { value: job, error } = await settle(requests.job(jobId));
      if (!stillWatching(runKey)) return;
      const next = afterPoll({ job, error }, { errors, elapsed: now() - startedAt, deadlineMs });
      if (next.update) update(runKey, next.update);
      if (!next.stop) watch(runKey, jobId, next.errors, startedAt);
    }, pollDelay(errors));
  };

  const validate = async () => {
    const runKey = key;
    setRecord({ key: runKey, phase: 'submitting' });
    const prepared = await preparePayload(files);
    const sent = prepared.error ? prepared : await settle(requests.submit(prepared.body));
    if (!mounted.current) return;
    if (sent.error) {
      if (!prepared.error) onRefusal(sent.error);
      update(runKey, { phase: 'error', error: sent.error });
      return;
    }
    update(runKey, { phase: 'polling', jobId: sent.value.jobId, job: { status: 'queued' } });
    watch(runKey, sent.value.jobId, 0, now());
  };

  return { current: record?.key === key ? record : null, validate };
}

/** The image's decision for each module block, under a disclosure. */
function LabModules({ report }) {
  if (!report.length) return null;
  return (
    <details className="text-xs text-slate-600 dark:text-slate-400" data-testid="lz-lab-modules">
      <summary className="cursor-pointer">What the lab does with each module</summary>
      <ul className="mt-2 flex flex-col gap-1 font-mono">
        {report.map((row) => (
          <li key={`${row.path}:${row.block}`} data-vendored={row.vendored ? 'true' : 'false'}>
            {`module "${row.block}" (${row.source} ${row.constraint}) → `}
            {row.vendored
              ? `the vendored copy ${row.vendored}`
              : `not vendored (the image has ${row.have.join(', ') || 'none'})`}
          </li>
        ))}
      </ul>
    </details>
  );
}

const NOTICE_CLASS = 'text-sm text-amber-700 dark:text-amber-400';

/** How the run ended: the output, a stall, or a refusal. Nothing while one is in flight. */
function LabOutcome({ run }) {
  if (run?.phase === 'done') {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
        data-testid="lz-lab-output"
        data-status={run.job.status}
      >
        <p className="font-medium text-slate-900 dark:text-slate-100">{outcomeLine(run.job)}</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-800 dark:text-slate-200">
          {run.job.output || '(no output)'}
        </pre>
      </div>
    );
  }
  if (run?.phase === 'stalled') {
    return (
      <p role="status" className={NOTICE_CLASS} data-testid="lz-lab-stalled">
        {LINES.stalled}
      </p>
    );
  }
  if (run?.phase === 'error') {
    return (
      <p
        role="alert"
        className={NOTICE_CLASS}
        data-testid="lz-lab-error"
        data-status={run.error?.status ?? 'error'}
      >
        {failureLine(run.error)}
      </p>
    );
  }
  return null;
}

/**
 * @param {object} props
 * @param {Array<{ path: string, content: string }>} props.files  the emitted files, as the tabs show them
 * @param {{ status: Function, submit: Function, job: Function }} [props.requests]  the publicApi calls; tests pass their own
 * @param {(errors: number) => number} [props.pollDelay]
 * @param {number} [props.deadlineMs]
 * @param {() => number} [props.now]
 */
export function LzLabValidate({
  files,
  requests = DEFAULT_REQUESTS,
  pollDelay = jobPollDelay,
  deadlineMs = POLL_DEADLINE_MS,
  now = Date.now,
}) {
  const [door, setDoor] = useLabDoor(requests);
  const key = useMemo(() => filesKey(files), [files]);
  const resolution = useMemo(() => labResolution(files), [files]);
  const report = useMemo(() => labModuleReport(files), [files]);
  const hasTerraform = files.some((f) => f.path.endsWith('.tf'));
  const onRefusal = (error) => {
    const shut = doorFromRefusal(error);
    if (shut) setDoor(shut);
  };
  const { current, validate } = useLabRun({
    files,
    key,
    requests,
    pollDelay,
    deadlineMs,
    now,
    onRefusal,
  });
  const busy = isBusy(current);
  const reason = disabledReason({ door, hasTerraform, resolution });
  const Icon = busy ? Loader2 : FlaskConical;

  return (
    <div
      className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-700"
      data-testid="lz-lab"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={validate}
          disabled={Boolean(reason) || busy}
          aria-describedby="lz-lab-line"
          data-testid="lz-lab-validate"
          className="shrink-0"
        >
          <Icon className={`mr-2 h-3.5 w-3.5${busy ? ' animate-spin' : ''}`} aria-hidden="true" />
          {buttonLabel(current)}
        </Button>
        <p
          id="lz-lab-line"
          role="status"
          className={`${HINT_CLASS} min-w-0 flex-1`}
          data-testid="lz-lab-line"
          data-door={doorTag(door)}
        >
          {statusLine(reason, current)}
        </p>
      </div>
      <LabModules report={report} />
      <LabOutcome run={current} />
    </div>
  );
}
