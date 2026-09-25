/**
 * `management.tf` (#667): the Log Analytics workspace, data collection rules,
 * monitoring-agent identity and Automation account from
 * avm-ptn-alz-management. The names are locals because alz.tf builds policy
 * parameters from them.
 */
import { block, file, moduleSource, providersMap, q } from './format';

/** The names alz.tf's policy defaults are built from; `uami-ama` is the module's own default. */
export const MANAGEMENT_LOCALS = Object.freeze([
  ['management_resource_group_name', q('rg-alz-management-${var.location}')],
  ['log_analytics_workspace_name', q('law-alz-${var.location}')],
  ['automation_account_name', q('aa-alz-${var.location}')],
  ['ama_user_assigned_identity_name', q('uami-ama')],
]);

export function managementTf() {
  return file('management.tf', [
    '# Management: the Log Analytics workspace every subscription reports to, the data',
    '# collection rules for the monitoring agent, the identity the agent runs as, and an',
    '# Automation account. The names are locals because alz.tf builds policy parameters',
    '# from them.',
    ...block('locals', MANAGEMENT_LOCALS),
    '',
    ...block('module "management"', [
      ...moduleSource('avm-ptn-alz-management'),
      '',
      ['automation_account_name', 'local.automation_account_name'],
      ['location', 'var.location'],
      ['log_analytics_workspace_name', 'local.log_analytics_workspace_name'],
      ['resource_group_name', 'local.management_resource_group_name'],
      ['enable_telemetry', 'var.enable_telemetry'],
      '',
      ['providers', providersMap('avm-ptn-alz-management', 'management')],
    ]),
  ]);
}
