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
 * (one submission and its polling). Every rule they decide by is a pure
 * function in labValidateRules.js.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { labModuleReport, labResolution } from '@/lib/landingZone';
import { jobPollDelay } from '@/lib/labsPolling';
import { fetchLabSubmissionStatus, fetchPublicLabJob, submitLabValidation } from '@/lib/publicApi';
import {
  LINES,
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
  outcomeLine,
  preparePayload,
  settle,
  statusLine,
} from './labValidateRules';
import { HINT_CLASS } from './styles';

const DEFAULT_REQUESTS = Object.freeze({
  status: fetchLabSubmissionStatus,
  submit: submitLabValidation,
  job: fetchPublicLabJob,
});

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

  const validate = async () => {
    const runKey = key;
    setRecord({ key: runKey, phase: 'submitting' });
    const prepared = await preparePayload(files);
    const sent = prepared.error ? prepared : await settle(requests.submit(prepared.body));
    if (!mounted.current) return;
    if (sent.error && !prepared.error) onRefusal(sent.error);
    if (sent.error) update(runKey, { phase: 'error', error: sent.error });
    else {
      update(runKey, { phase: 'polling', jobId: sent.value.jobId, job: { status: 'queued' } });
      watch(runKey, sent.value.jobId, 0, now());
    }
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

/** What a finished job said: the sentence, then Terraform's own output. */
function LabOutput({ job }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
      data-testid="lz-lab-output"
      data-status={job.status}
    >
      <p className="font-medium text-slate-900 dark:text-slate-100">{outcomeLine(job)}</p>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-800 dark:text-slate-200">
        {job.output || '(no output)'}
      </pre>
    </div>
  );
}

/** How the run ended: the output, a stall, or a refusal. Nothing while one is in flight. */
function LabOutcome({ run }) {
  switch (run?.phase) {
    case 'done':
      return <LabOutput job={run.job} />;
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
