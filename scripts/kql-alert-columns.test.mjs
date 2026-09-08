/**
 * A scheduled-query alert's measured column must be a name KQL will accept,
 * and the name the query actually produces.
 *
 * ## The failure this catches
 *
 * `azurerm_monitor_scheduled_query_rules_alert_v2` can measure a column
 * instead of counting rows: the KQL projects one value and
 * `metric_measure_column` names it. Two things about that pairing fail only
 * at APPLY, on the owner's confirmation, long after review and `validate` and
 * `plan` have all passed:
 *
 *   1. **The column name is a KQL reserved word.** `project missing = …` does
 *      not parse. Azure rejects the whole resource with
 *
 *        Query could not be parsed at 'missing' on line [5,11].
 *        A recognition error occurred in the query.
 *
 *      which names the token and the position but never says the word is
 *      reserved. Line 5 column 11 is exactly where the column name begins, so
 *      it reads as a problem with the expression that follows it.
 *
 *   2. **The two halves disagree.** A rename in the query that does not move
 *      `metric_measure_column` with it leaves a rule measuring a column that
 *      does not exist. They are matched by string and nothing else checks it.
 *
 * The first one cost a partial apply on 2026-09-08. Terraform created
 * `alert-cosmos-export-daily` and set `FEATURE_FLAG_COSMOS_EXPORT = "true"`,
 * then failed on `alert-cosmos-export-full` — leaving the Cosmos exporter
 * armed with one of its two alerts. Both rules are gated on the single
 * `cosmos_export_enabled` variable precisely so that half-state cannot exist,
 * and a partial apply produced it anyway, because a `count` gate decides
 * whether Terraform ATTEMPTS a resource and has no say in whether Azure
 * accepts it.
 *
 * This is the same shape as `terraform-role-definitions.test.mjs`: a mistake
 * that passes every local gate and fails on the apply. That is what a guard
 * is for.
 *
 * ## The reserved list is MEASURED, not remembered
 *
 * Every name below was confirmed rejected by running
 * `print zzz = 1 | project <name> = 1` against the live Application Insights
 * component on 2026-09-08 and observing the request refused. Names that were
 * tried and ACCEPTED are recorded too, in `MEASURED_ACCEPTABLE`, because a
 * list of failures with no record of what passed cannot be told apart from a
 * list someone guessed at.
 *
 * IT IS NOT EXHAUSTIVE, and this file does not pretend otherwise. KQL has
 * reserved words nobody here has tried. A name absent from this list is
 * untested, not blessed — so the second assertion matters independently: it
 * holds for every rule whatever the name, and it is the one that catches a
 * rename.
 *
 * To extend the list, measure rather than reason:
 *
 *   az monitor app-insights query --app <appId> \
 *     --analytics-query "print zzz = 1 | project <candidate> = 1"
 *
 * A refusal means reserved. Add it below with the date.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const observability = readFileSync(join(repoRoot, 'infra', 'observability.tf'), 'utf8');

/** Column names measured on 2026-09-08 to be refused by KQL. */
export const MEASURED_RESERVED = new Set([
  'and',
  'between',
  'datetime',
  'dynamic',
  'false',
  'int',
  'long',
  'missing',
  'or',
  'real',
  'string',
  'timespan',
  'true',
  'views',
]);

/**
 * Measured on the same run and ACCEPTED — the control group.
 *
 * Without these, the list above could be any collection of words. `count`,
 * `by`, `in`, `let`, `not`, `set`, `step`, `of`, `bool`, `null`, `typeof`,
 * `has`, `contains`, `matches`, `on`, `delta` and `full` were all tried and
 * all worked as column names, which is what makes the refusals meaningful.
 */
export const MEASURED_ACCEPTABLE = new Set([
  'bool',
  'by',
  'contains',
  'count',
  'delta',
  'full',
  'has',
  'in',
  'let',
  'matches',
  'not',
  'null',
  'of',
  'on',
  'set',
  'step',
  'typeof',
]);

/**
 * Split the file into one entry per scheduled-query alert resource.
 *
 * Deliberately crude: a resource block runs until the next top-level
 * `resource` keyword, which is true of this file and is checked by the
 * shape assertion below rather than assumed. A parser would be a second
 * thing to keep correct for no gain here.
 */
export function alertBlocks(source) {
  const parts = source.split(/^resource "/m).slice(1);
  return parts
    .filter((part) => part.startsWith('azurerm_monitor_scheduled_query_rules_alert_v2'))
    .map((part) => {
      const name = /^azurerm_monitor_scheduled_query_rules_alert_v2" "([^"]+)"/.exec(part);
      return { name: name ? name[1] : '(unnamed)', body: part };
    });
}

/** The value of `metric_measure_column`, or null when the rule counts rows. */
export function measuredColumn(body) {
  const match = /metric_measure_column\s*=\s*"([^"]+)"/.exec(body);
  return match ? match[1] : null;
}

/**
 * Every column name the KQL introduces, from any operator that can name one.
 *
 * `summarize` belongs here as much as `project` and `extend`, and leaving it
 * out is not a harmless omission: the first version of this file matched only
 * the latter two and reported `function_response_time` as measuring a column
 * its query never produced. Two of the three measured columns in this file
 * come from `summarize`, so the narrow version would have failed on real,
 * correct rules — a guard that cries wolf gets deleted, and then the case it
 * was written for ships.
 *
 * `=(?!=)` is what separates an assignment from a comparison, so the `fulls
 * == 0` inside an `iff()` is not read as a column called `fulls`. Names after
 * a `by` are not assignments and are correctly ignored.
 */
export function producedColumns(body) {
  const segments = [...body.matchAll(/\|\s*(?:summarize|project|extend)\s+([^|]*)/g)];
  return segments.flatMap((segment) =>
    [...segment[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g)].map((m) => m[1])
  );
}

describe('scheduled-query alerts in infra/observability.tf', () => {
  const blocks = alertBlocks(observability);

  it('finds the alert rules, so a parse that silently matches nothing fails', () => {
    // Without this, every assertion below passes vacuously the day the file
    // is reorganised — the failure mode a text-matching guard actually has.
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block.name).not.toBe('(unnamed)');
  });

  it('measures a column the query actually produces', () => {
    for (const block of blocks) {
      const column = measuredColumn(block.body);
      if (!column) continue;
      expect(
        producedColumns(block.body),
        `${block.name} measures "${column}", which its KQL never projects`
      ).toContain(column);
    }
  });

  it('never names a measured column with a word KQL refuses', () => {
    for (const block of blocks) {
      for (const column of producedColumns(block.body)) {
        expect(
          MEASURED_RESERVED.has(column),
          `${block.name} projects "${column}", a reserved word — Azure rejects the rule at apply`
        ).toBe(false);
      }
    }
  });
});

describe('the measured reserved list', () => {
  it('is disjoint from the names measured to work', () => {
    // One word in both sets means a transcription slip, and a guard built on
    // a slip is worse than none.
    for (const name of MEASURED_RESERVED) expect(MEASURED_ACCEPTABLE.has(name)).toBe(false);
  });

  it('carries the name that caused the partial apply', () => {
    expect(MEASURED_RESERVED.has('missing')).toBe(true);
  });
});
