/**
 * lab-checks.js — the Hybrid Lab checks that keep #1009's failures from
 * coming back unnoticed, each read from what is already stored and judged
 * by a pure function, so the health pulse and the Labs snapshot say the same
 * thing about the same data.
 *
 *   lab-drift       Does every active agent's host run main? The host's
 *                   applied commit (on the agent's registry document)
 *                   against main's lab-host/ and vps-agent/ commits
 *                   (admin_config/lab_drift); labs/drift.js has the rule.
 *   coder-template  Does Coder serve the template of the commit the host
 *                   converged from? The host's Coder upkeep report
 *                   (admin_config/coder_automation) carries the digest of
 *                   what it last published and the digest of its checkout;
 *                   coderTemplateVerdict below compares them.
 *   lab-canary      Did the last real lab job run end to end? The hourly
 *                   canary's record (admin_config/lab_canary, labs/canary.js).
 *   coder-token     Does Coder accept the site's status token? Coder's last
 *                   answers to it (admin_config/coder_status_token,
 *                   labs/coder-status.js recordTokenAnswer).
 *
 * WHY THE TEMPLATE IS COMPARED ON THE HOST'S TWO DIGESTS, NOT THE SITE'S
 * BUILD. A digest of lab-host/coder/templates/hcw-lab computed when the
 * Functions app is built would describe the commit the site was deployed
 * from, and deploys are by hand: a template change merged and bootstrapped
 * before the next deploy would read as a mismatch, and one deployed before
 * the host ran bootstrap.sh would read as fine. The question that failed on
 * 2026-10-08 (finding 8) is narrower and exact: after the host converged, did
 * the publish follow? The host computes both digests with one function
 * (template_digest in hcw-coder-automation.py, over the files
 * hcw-coder-template-push publishes and the autostop it sets), so a pair that
 * differs means one thing. Whether the converged commit is main's is the
 * drift check's question, and the two together cover main → host → Coder.
 *
 * Every verdict is `{ status, summary, detail? }` in the Health Hub's words
 * (health/status-model.js). Nothing here throws on odd data.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { CODER_AUTOMATION_DOC_ID } from './coder-automation.js';
import { LAB_CANARY_DOC_ID, UNREACHED_OUTCOMES } from './canary.js';
import { TOKEN_STATE_DOC_ID, isRefusing } from './coder-status.js';
import { LAB_DRIFT_DOC_ID, agoText, labDriftVerdict } from './drift.js';

export const LAB_DRIFT_PROBE = 'lab-drift';
export const CODER_TEMPLATE_PROBE = 'coder-template';
export const LAB_CANARY_PROBE = 'lab-canary';
export const CODER_TOKEN_PROBE = 'coder-token';

const HOUR_MS = 60 * 60 * 1000;
/** Three missed hourly runs: the canary has stopped, and its last result is no longer evidence. */
export const CANARY_STALE_AFTER_MS = 3 * HOUR_MS;
/**
 * A day without a read of Coder with the token: an acceptance that old no
 * longer vouches for the token. With the canary armed the status is read
 * hourly; without it, only visitors and the Integrations card read it.
 */
export const TOKEN_EVIDENCE_STALE_AFTER_MS = 24 * HOUR_MS;

/** The registry fields the drift verdict reads. */
export const LAB_DRIFT_AGENTS_QUERY = 'SELECT TOP 200 c.id, c.active, c.applied FROM c';

/**
 * The Integrations card's silence rule (SILENT_AFTER_DAYS in
 * frontend/src/components/admin/integrations/coderAutomationView.js): a
 * daily report a week old is a host that has stopped reporting.
 */
export const TEMPLATE_REPORT_COLD_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const DIGEST = /^[0-9a-f]{64}$/;
const result = (status, summary, detail = null) => ({ status, summary, detail });
const day = (iso) => String(iso).slice(0, 10);

/**
 * Whether Coder serves the template of the commit the host converged from.
 * Pure.
 *
 * @param {object|null} report admin_config/coder_automation, as stored
 * @param {number} nowMs
 */
export function coderTemplateVerdict(report, nowMs) {
  if (!report) {
    return result(
      'unknown',
      'The lab host has not sent a Coder upkeep report yet; hcw-coder-automation sends one daily once it is seeded.'
    );
  }
  const reported = report.reportedAt ? ` Reported ${agoText(report.reportedAt, nowMs)}.` : '';
  const version = report.templateVersion ? ` (${report.templateVersion})` : '';
  if (!report.templatePushedAt) {
    return result(
      'critical',
      `The lab host's automation has never published the hcw-lab template, so Coder may serve one older than the host's commit. bootstrap.sh publishes it, once hcw-coder-automation-seed has stored the rotation credential.${reported}`
    );
  }
  const published = report.templateDigest;
  const source = report.templateSourceDigest;
  if (!DIGEST.test(String(published ?? '')) || !DIGEST.test(String(source ?? ''))) {
    return result(
      'unknown',
      `The hcw-lab template was last published ${day(report.templatePushedAt)}${version}, but the host's report carries no template digests to compare with its checkout yet. They arrive with the first daily report after bootstrap.sh installs this version.${reported}`
    );
  }
  const detail = `published ${published}\ncheckout  ${source}`;
  if (published !== source) {
    return result(
      'critical',
      `Coder serves the hcw-lab template published ${day(report.templatePushedAt)}${version}, which is not the template in the commit the host converged from: the publish did not follow the host's last bootstrap.sh run. Run bootstrap.sh again, or hcw-coder-automation push-template on the host.${reported}`,
      detail
    );
  }
  const reportedMs = Date.parse(report.reportedAt ?? '');
  if (Number.isFinite(reportedMs) && nowMs - reportedMs > TEMPLATE_REPORT_COLD_AFTER_MS) {
    return result(
      'degraded',
      `Coder served the hcw-lab template of the host's commit${version} when the host last reported, but that report is more than a week old, so a later change may not be published.${reported}`,
      detail
    );
  }
  return result(
    'healthy',
    `Coder serves the hcw-lab template of the commit the host converged from${version}, published ${day(report.templatePushedAt)}.${reported}`,
    detail
  );
}

const secondsText = (ms) => `${Math.round(ms / 1000)} s`;

/** "claimed after 12 s, done 3 s later", from whichever timings the run has. */
function timingsText(timings) {
  const parts = [];
  if (Number.isFinite(timings?.claimMs)) parts.push(`claimed after ${secondsText(timings.claimMs)}`);
  if (Number.isFinite(timings?.runMs)) parts.push(`done ${secondsText(timings.runMs)} later`);
  return parts.join(', ');
}

/**
 * Whether the last real lab job ran end to end. Pure.
 *
 * Nothing ran it (no agent online, nobody claimed it) is `offline`, the
 * status-model's word for silence; a job that ran and failed, a registry with
 * no agent for the job type, or a job left in flight is `critical`.
 *
 * @param {object|null} state admin_config/lab_canary
 * @param {number} nowMs
 */
export function labCanaryVerdict(state, nowMs) {
  if (!state?.lastRunAt) {
    return result(
      'unknown',
      'The lab canary has not run. Add LAB_CANARY to enabled_timers to run one shell-echo job an hour end to end.'
    );
  }
  const last = state.lastResult ?? {};
  const when = agoText(state.lastRunAt, nowMs);
  const timings = timingsText(last.timings);
  const lastLine = last.ok
    ? `the last job passed${timings ? ` (${timings})` : ''}`
    : `the last did not pass (${last.reason || last.outcome || 'no reason recorded'})`;
  const lastRunMs = Date.parse(String(state.lastRunAt));
  if (!Number.isFinite(lastRunMs) || nowMs - lastRunMs > CANARY_STALE_AFTER_MS) {
    return result(
      'unknown',
      `The lab canary last ran ${when}, and it runs hourly while LAB_CANARY is armed, so it has stopped; ${lastLine}.`
    );
  }
  if (last.ok) {
    return result(
      'healthy',
      `A shell-echo job ran end to end ${when}${timings ? `: ${timings}` : ''}.`
    );
  }
  const streak = Number(state.consecutiveFailures) > 1 ? ` ${state.consecutiveFailures} runs in a row.` : '';
  const success = state.lastSuccessAt
    ? ` The last job that passed ran ${agoText(state.lastSuccessAt, nowMs)}.`
    : ' No canary job has passed yet.';
  return result(
    UNREACHED_OUTCOMES.includes(last.outcome) ? 'offline' : 'critical',
    `The lab canary did not pass ${when}: ${last.reason || last.outcome || 'no reason recorded'}.${streak}${success}`,
    last.outcome ? `outcome ${last.outcome}` : null
  );
}

const refusalMeaning = (status) =>
  status === 403
    ? 'it lacks the template:read or workspace:read scope'
    : 'it has expired or been revoked';

/**
 * Whether Coder accepts the site's status token, by its last recorded answers.
 * Pure. A refusal newer than the last acceptance is critical however old: it
 * is still the latest evidence. An acceptance older than a day is unknown.
 *
 * @param {object|null} state admin_config/coder_status_token
 * @param {number} nowMs
 */
export function coderTokenVerdict(state, nowMs) {
  if (!state?.lastAcceptedAt && !state?.lastRefusedAt) {
    return result(
      'unknown',
      'No read of Coder with CODER_STATUS_TOKEN has been recorded yet; the labs status read records each one.'
    );
  }
  if (isRefusing(state)) {
    const status = Number(state.lastRefusedStatus) || 401;
    const since = state.refusingSince ?? state.lastRefusedAt;
    return result(
      'critical',
      `Coder has refused CODER_STATUS_TOKEN (HTTP ${status}) since ${since}, ${agoText(since, nowMs)}: ${refusalMeaning(status)}, so the labs card's templates and running count are unknown. The lab host's Coder automation renews it daily; Integrations → Hybrid Lab shows its last report.`,
      state.lastAcceptedAt ? `last accepted ${state.lastAcceptedAt}` : 'never accepted since this check began'
    );
  }
  const acceptedMs = Date.parse(String(state.lastAcceptedAt));
  if (!Number.isFinite(acceptedMs) || nowMs - acceptedMs > TOKEN_EVIDENCE_STALE_AFTER_MS) {
    return result(
      'unknown',
      `Coder last accepted CODER_STATUS_TOKEN ${agoText(state.lastAcceptedAt, nowMs)}, and nothing has read Coder with it since, so whether it still does is unknown.`
    );
  }
  return result('healthy', `Coder accepted CODER_STATUS_TOKEN ${agoText(state.lastAcceptedAt, nowMs)}.`);
}

/** The drift verdict from the registry rows given, or read here when none are. */
export async function readLabDrift(store, nowMs, agentRows = null) {
  const [agents, drift] = await Promise.all([
    agentRows ?? store.queryDocs('lab_agents', LAB_DRIFT_AGENTS_QUERY, []),
    store.readDoc('admin_config', LAB_DRIFT_DOC_ID, ADMIN_CONFIG_PARTITION),
  ]);
  return labDriftVerdict({ agents, drift, nowMs });
}

/** The template verdict from the host's last Coder upkeep report. */
export async function readCoderTemplate(store, nowMs) {
  const report = await store.readDoc('admin_config', CODER_AUTOMATION_DOC_ID, ADMIN_CONFIG_PARTITION);
  return coderTemplateVerdict(report, nowMs);
}

/** The canary verdict from its record. */
export async function readLabCanary(store, nowMs) {
  return labCanaryVerdict(
    await store.readDoc('admin_config', LAB_CANARY_DOC_ID, ADMIN_CONFIG_PARTITION),
    nowMs
  );
}

/** The status-token verdict from Coder's recorded answers. */
export async function readCoderToken(store, nowMs) {
  return coderTokenVerdict(
    await store.readDoc('admin_config', TOKEN_STATE_DOC_ID, ADMIN_CONFIG_PARTITION),
    nowMs
  );
}

/** A check that could not be read is said as such, never as healthy. */
const unreadable = (error) =>
  result('unknown', `The check's data could not be read: ${error?.message || error}`);

/**
 * Every check, for the Labs snapshot: `{ checks, drift }`, where `drift` is
 * the drift verdict whole (its per-agent lines go on the agent cards). One
 * failed read leaves that check unknown and the others standing.
 *
 * @param {object} store
 * @param {number} nowMs
 * @param {object[]} agentRows the registry rows the snapshot already read
 */
export async function readLabChecks(store, nowMs, agentRows) {
  const [drift, template, canary, token] = await Promise.all([
    readLabDrift(store, nowMs, agentRows).catch((error) => ({ ...unreadable(error), agents: {} })),
    readCoderTemplate(store, nowMs).catch(unreadable),
    readLabCanary(store, nowMs).catch(unreadable),
    readCoderToken(store, nowMs).catch(unreadable),
  ]);
  const { agents: _perAgent, ...driftCheck } = drift;
  return {
    checks: {
      [LAB_DRIFT_PROBE]: driftCheck,
      [CODER_TEMPLATE_PROBE]: template,
      [LAB_CANARY_PROBE]: canary,
      [CODER_TOKEN_PROBE]: token,
    },
    drift,
  };
}
