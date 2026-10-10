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
import { LAB_DRIFT_DOC_ID, agoText, labDriftVerdict } from './drift.js';

export const LAB_DRIFT_PROBE = 'lab-drift';
export const CODER_TEMPLATE_PROBE = 'coder-template';

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
  const [drift, template] = await Promise.all([
    readLabDrift(store, nowMs, agentRows).catch((error) => ({ ...unreadable(error), agents: {} })),
    readCoderTemplate(store, nowMs).catch(unreadable),
  ]);
  const { agents: _perAgent, ...driftCheck } = drift;
  return {
    checks: { [LAB_DRIFT_PROBE]: driftCheck, [CODER_TEMPLATE_PROBE]: template },
    drift,
  };
}
