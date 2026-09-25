/**
 * `subscriptions.tf` (#667): every subscription id the build places, in one
 * list, with the rule that they are pairwise distinct. A subscription can sit
 * under one management group only, so the same id given twice would make
 * alz.tf's `subscription_placement` fight itself; the `precondition` on the
 * output turns that into a plan-time error with a message that says so.
 * An output precondition needs no provider, so the rule holds in an offline
 * `terraform plan` on this file and variables.tf alone.
 */
import { block, file } from './format';
import { placements } from './subscriptions';

/** The lines of `concat([single ids], list ids...)`, one id per line. */
function concatLines(singles, lists) {
  const lines = ['concat('];
  if (singles.length) lines.push('[', ...singles.map((v) => `  ${v},`), '],');
  for (const l of lists) lines.push(`${l},`);
  lines.push(')');
  return lines;
}

export function subscriptionIdsTf(state) {
  const placed = placements(state);
  const singles = placed.filter((p) => !p.group || p.group === 'identity').map((p) => p.variable);
  const lists = [];
  if (state.options.corpCount > 0) lists.push('var.corp_subscription_ids');
  if (state.options.onlineCount > 0) lists.push('var.online_subscription_ids');
  return file('subscriptions.tf', [
    '# Every subscription this build places, one per platform role and per landing zone.',
    '# A subscription can sit under one management group only, so the same id given twice',
    '# would make the placements in alz.tf fight; the precondition refuses it at plan time.',
    ...block('locals', [['placed_subscription_ids', concatLines(singles, lists)]]),
    '',
    ...block('output "placed_subscription_ids"', [
      ['description', '"Every subscription id this build places, in placement order."'],
      ['value', 'local.placed_subscription_ids'],
      '',
      ...block('precondition', [
        [
          'condition',
          'length(distinct(local.placed_subscription_ids)) == length(local.placed_subscription_ids)',
        ],
        [
          'error_message',
          '"Every subscription id must be distinct: a subscription can be placed under one management group only."',
        ],
      ]),
    ]),
  ]);
}
