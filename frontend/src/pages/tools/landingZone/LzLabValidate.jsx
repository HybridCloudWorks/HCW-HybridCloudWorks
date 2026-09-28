/**
 * "Validate on the lab" (#672, Phase 6 of #657): send the build's files to
 * the Hybrid Lab, where the `terraform-validate` job runs `terraform init
 * -backend=false` and `terraform validate` in the runner image with no
 * network, and show what Terraform said.
 *
 * A REPORT FOR LEARNERS, NOT THE JOB LOG (owner request 2026-09-28). What a
 * finished job shows is the report the server builds for visitors
 * (functions/src/lib/labs/visitor-report.js, read here through
 * `visitorReport`): the verdict in plain words, Terraform's own errors with
 * the learner's file names and line numbers, the modules the lab used as
 * `name@version` with one line on why it has offline copies, and the
 * providers. The first public run printed the raw log instead, image pull,
 * digests and runner paths included; the control no longer reads `output`,
 * even when a job carries one.
 *
 * CLOSED UNTIL THE SERVER SAYS OPEN. On mount the control asks
 * `GET public/labs/submit` whether a job would be taken, and until the
 * answer is `open: true` the button is disabled with one line saying why.
 * The server's code picks the line (labValidateRules.js), in the visitor's
 * words only (owner direction 2026-09-28): a full queue says to try again in
 * a few minutes, and every other closed door — switched off, no browser-check
 * secret, no runner online, status unreadable — says validation is not
 * available right now and points at the download, because a visitor can do
 * nothing about which it is. That line is text, never a spinner: a spinner
 * says "wait", and waiting would not open a closed door. The pre-rendered page
 * carries the "checking" line, which is the same markup the first client
 * render produces, so hydration adopts it.
 *
 * LOCKED TO THIS PANE (ADR 0032 decision 6, revised 2026-09-28). The server
 * takes a job only from the site's origin with a Turnstile token for the
 * `lab-validate` action. Once the door is open, and only then, the control
 * loads Cloudflare's widget (useLabTurnstile.js; invisible unless Cloudflare
 * wants the visitor to act) and the button waits for its token. Each
 * submission spends one token and asks for the next. A build of the site
 * with no `VITE_TURNSTILE_SITE_KEY` never loads the widget, and the button
 * reads as unavailable.
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
 * explain button's is: change the build and the report goes away rather
 * than describing files no longer on the page, and polling stops.
 *
 * Two hooks carry the state: `useLabDoor` (the status read) and `useLabRun`
 * (one submission and its polling). Every rule they decide by is a pure
 * function in labValidateRules.js.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { labModuleReport, labResolution } from '@/lib/landingZone';
import { jobPollDelay } from '@/lib/labsPolling';
import { fetchLabSubmissionStatus, fetchPublicLabJob, submitLabValidation } from '@/lib/publicApi';
import { loadTurnstile, turnstileSiteKey } from '@/lib/turnstile';
import {
  LINES,
  LOCAL_CODES,
  POLL_DEADLINE_MS,
  afterPoll,
  buttonLabel,
  disabledReason,
  doorFromRefusal,
  doorFromStatus,
  doorTag,
  failureLine,
  filesKey,
  isBusy,
  localError,
  outcomeLine,
  preparePayload,
  settle,
  statusLine,
  turnstileActive,
  visitorReport,
} from './labValidateRules';
import { HINT_CLASS } from './styles';
import { useLabTurnstile } from './useLabTurnstile';

const DEFAULT_REQUESTS = Object.freeze({
  status: fetchLabSubmissionStatus,
  submit: submitLabValidation,
  job: fetchPublicLabJob,
});

/** The build's site key and Cloudflare's loader; tests pass their own. */
const DEFAULT_TURNSTILE = Object.freeze({ siteKey: turnstileSiteKey(), load: loadTurnstile });

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
 * The poll's timer, and the two facts a late callback checks before it
 * writes: the control is still mounted, and the build is still the one the
 * job was sent for. Unmounting, or a new build, clears the timer.
 */
function useWatchState(key) {
  const timer = useRef(null);
  const liveKey = useRef(key);
  const mounted = useRef(true);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  const schedule = useCallback((callback, delayMs) => {
    timer.current = setTimeout(callback, delayMs);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  // A new build stops watching the old one's job.
  useEffect(() => {
    liveKey.current = key;
    return cancel;
  }, [key, cancel]);

  const isMounted = () => mounted.current;
  const stillWatching = (runKey) => mounted.current && liveKey.current === runKey;
  return { schedule, isMounted, stillWatching };
}

/**
 * One submission and its polling, held against the files it sent.
 * `onRefusal` hears every refused submission, so the door can shut.
 * `takeToken` and `renewCheck` are the Turnstile widget's: its token rides on
 * the submission, and the widget is renewed once the server has answered,
 * since the token is then spent.
 */
function useLabRun({
  files,
  key,
  requests,
  pollDelay,
  deadlineMs,
  now,
  onRefusal,
  takeToken,
  renewCheck,
}) {
  const [record, setRecord] = useState(null);
  const { schedule, isMounted, stillWatching } = useWatchState(key);

  const update = (runKey, next) =>
    setRecord((prev) => (prev?.key === runKey ? { ...prev, ...next } : prev));

  const watch = (runKey, jobId, errors, startedAt) => {
    schedule(async () => {
      const { value: job, error } = await settle(requests.job(jobId));
      if (stillWatching(runKey)) {
        const clock = { errors, elapsed: now() - startedAt, deadlineMs };
        follow(runKey, jobId, afterPoll({ job, error }, clock), startedAt);
      }
    }, pollDelay(errors));
  };

  /** Record what a poll said, and ask again unless it was the end. */
  const follow = (runKey, jobId, next, startedAt) => {
    if (next.update) update(runKey, next.update);
    if (!next.stop) watch(runKey, jobId, next.errors, startedAt);
  };

  /** The payload with this pane's one-use token, sent; the widget renewed after. */
  const submit = async (payloadBody) => {
    const turnstileToken = takeToken();
    if (!turnstileToken) return { error: localError(LOCAL_CODES.checkPending) };
    const outcome = await settle(requests.submit({ ...payloadBody, turnstileToken }));
    renewCheck();
    return outcome;
  };

  const validate = async () => {
    const runKey = key;
    setRecord({ key: runKey, phase: 'submitting' });
    const prepared = await preparePayload(files);
    const sent = prepared.error ? prepared : await submit(prepared.body);
    if (!isMounted()) return;
    if (sent.error && !prepared.error) onRefusal(sent.error);
    if (sent.error) update(runKey, { phase: 'error', error: sent.error });
    else {
      update(runKey, { phase: 'polling', jobId: sent.value.jobId, job: { status: 'queued' } });
      watch(runKey, sent.value.jobId, 0, now());
    }
  };

  return { current: record?.key === key ? record : null, validate };
}

/** Whether the lab has each module block's module, under a disclosure. */
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
              ? `the lab's copy, ${row.vendored}`
              : `not on the lab (it has ${row.have.join(', ') || 'no version'})`}
          </li>
        ))}
      </ul>
    </details>
  );
}

const NOTICE_CLASS = 'text-sm text-amber-700 dark:text-amber-400';
const REPORT_HEADING_CLASS =
  'text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

/** One titled list in the report, or nothing when it is empty. */
function ReportList({ title, items, testId, children = null }) {
  if (!items.length) return null;
  return (
    <div data-testid={testId}>
      <p className={REPORT_HEADING_CLASS}>{title}</p>
      <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-slate-800 dark:text-slate-200">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {children}
    </div>
  );
}

/** Terraform's errors, each in its own block as Terraform wrote it. */
function ReportErrors({ errors }) {
  if (!errors.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="lz-lab-report-errors">
      {errors.map((text, index) => (
        <pre
          // Terraform can report the same error twice; the position tells them apart.
          key={`${index}:${text}`}
          className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-red-200 bg-white p-2 font-mono text-xs text-slate-800 dark:border-red-900 dark:bg-slate-950 dark:text-slate-200"
        >
          {text}
        </pre>
      ))}
    </div>
  );
}

/**
 * What a finished job said, as the visitor report: the verdict, Terraform's
 * errors, then the modules and providers the lab used. Never the job log,
 * which this control does not read.
 */
function LabReport({ job }) {
  const report = visitorReport(job);
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
      data-testid="lz-lab-output"
      data-status={job.status}
      data-verdict={report?.verdict ?? 'none'}
    >
      <p className="font-medium text-slate-900 dark:text-slate-100" data-testid="lz-lab-verdict">
        {report ? report.headline : outcomeLine(job)}
      </p>
      {report ? (
        <>
          <ReportErrors errors={report.errors} />
          <ReportList title="Modules used" items={report.modules} testId="lz-lab-report-modules">
            {report.modulesNote ? (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {report.modulesNote}
              </p>
            ) : null}
          </ReportList>
          <ReportList title="Providers" items={report.providers} testId="lz-lab-report-providers" />
        </>
      ) : null}
    </div>
  );
}

/** How the run ended: the report, a stall, or a refusal. Nothing while one is in flight. */
function LabOutcome({ run }) {
  switch (run?.phase) {
    case 'done':
      return <LabReport job={run.job} />;
    case 'stalled':
      return (
        <p role="status" className={NOTICE_CLASS} data-testid="lz-lab-stalled">
          {LINES.stalled}
        </p>
      );
    case 'error':
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
    default:
      return null;
  }
}

/**
 * @param {object} props
 * @param {Array<{ path: string, content: string }>} props.files  the emitted files, as the tabs show them
 * @param {{ status: Function, submit: Function, job: Function }} [props.requests]  the publicApi calls; tests pass their own
 * @param {{ siteKey: string, load: () => Promise<object> }} [props.turnstile]  the site key and Cloudflare's loader; tests pass their own
 * @param {(errors: number) => number} [props.pollDelay]
 * @param {number} [props.deadlineMs]
 * @param {() => number} [props.now]
 */
export function LzLabValidate({
  files,
  requests = DEFAULT_REQUESTS,
  turnstile = DEFAULT_TURNSTILE,
  pollDelay = jobPollDelay,
  deadlineMs = POLL_DEADLINE_MS,
  now = Date.now,
}) {
  const [door, setDoor] = useLabDoor(requests);
  const key = useMemo(() => filesKey(files), [files]);
  const resolution = useMemo(() => labResolution(files), [files]);
  const report = useMemo(() => labModuleReport(files), [files]);
  const hasTerraform = files.some((f) => f.path.endsWith('.tf'));
  const widgetActive = turnstileActive(door, turnstile.siteKey);
  const {
    containerRef: turnstileRef,
    phase: checkPhase,
    take: takeToken,
    renew: renewCheck,
  } = useLabTurnstile({
    active: widgetActive,
    siteKey: turnstile.siteKey,
    load: turnstile.load,
  });
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
    takeToken,
    renewCheck,
  });
  const busy = isBusy(current);
  const reason = disabledReason({
    door,
    hasTerraform,
    resolution,
    siteKey: turnstile.siteKey,
    check: checkPhase,
  });
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
      {widgetActive ? (
        <div ref={turnstileRef} data-testid="lz-lab-check" data-check={checkPhase} />
      ) : null}
      <LabModules report={report} />
      <LabOutcome run={current} />
    </div>
  );
}
