/**
 * Every alert rule `infra/` declares, with the Azure name, resource group,
 * subscription and action group each one resolves to (PLAT-4, #964).
 *
 * WHY THIS IS DERIVED, NOT LISTED. verify-alert-state.yml checked three
 * hard-coded rule names from 2026-08-26 until PLAT-4, while the module grew to
 * fourteen: the reachability and export rules, the Telegram rule and the three
 * lab rules in another subscription were never read back at all. A list beside
 * the configuration drifts the day a rule is added; a list read OUT of the
 * configuration cannot. So the expected inventory is computed from the `.tf`
 * text on every run, and anything this cannot resolve is an error, because an
 * unresolvable rule would otherwise drop out of the inventory silently, which
 * is the failure this file exists to end.
 *
 * WHAT "RESOLVE" MEANS HERE, and no more:
 *
 *   - `name`: a quoted template whose interpolations are `var.<name>` with a
 *     string default in the module. That is how every rule is named.
 *   - `resource_group_name`: `azurerm_resource_group.<name>[...].name`, read
 *     through that group's own `name` with `each.key` bound, or a literal.
 *   - the subscription: the rule's `provider` alias, through that provider's
 *     `subscription_id = var.<x>` to the `(sub-…)` that variable's
 *     description ends with. The variables are sensitive, so the subscription
 *     ID is never in the configuration; its display name is, and the live
 *     check finds the ID from that.
 *   - the action groups: every `azurerm_monitor_action_group.<name>.id` named
 *     in the rule's `action` blocks, resolved the same way.
 *   - the gate: `count = var.<x> ? 1 : 0`. Any other `count` is reported as an
 *     unrecognised gate by its text rather than guessed at.
 *
 * A rule whose resource group is in one subscription while its provider points
 * at another is refused here: ARM would refuse it at apply with
 * ResourceGroupNotFound, which is how the action group's alias comment in
 * observability.tf came to be written.
 */
import { parseBody, skipString } from './hcl-blocks.mjs';

/**
 * The alert resource types this verifier can read back, and how.
 *
 * `armType` is the provider path the live check lists; `autoMitigate` names the
 * Terraform attribute behind the live `properties.autoMitigate` and the
 * provider's default for it (azurerm 5.8 schema; Microsoft's REST default for
 * scheduled query rules is true, azurerm's is false, and azurerm's is the one
 * that applies to a rule declared without it). Activity Log alerts have no
 * auto-resolution.
 */
export const ALERT_TYPES = {
  azurerm_monitor_scheduled_query_rules_alert_v2: {
    kind: 'log',
    armType: 'Microsoft.Insights/scheduledQueryRules',
    autoMitigate: { attribute: 'auto_mitigation_enabled', default: false },
  },
  azurerm_monitor_metric_alert: {
    kind: 'metric',
    armType: 'Microsoft.Insights/metricAlerts',
    autoMitigate: { attribute: 'auto_mitigate', default: true },
  },
  azurerm_monitor_activity_log_alert: {
    kind: 'activity-log',
    armType: 'Microsoft.Insights/activityLogAlerts',
    autoMitigate: null,
  },
};

/**
 * A resource type that looks like an alert rule. Anything matching this and
 * absent from ALERT_TYPES stops the check: a smart detector or a legacy
 * scheduled query rule added later must be taught to the verifier, not left
 * out of its inventory. Alert processing rules are excluded because they are
 * not rules that fire; they route or suppress the ones that do.
 */
const LOOKS_LIKE_ALERT = /^azurerm_monitor_(?!alert_processing_rule_)\w*alert\w*$/;

const ACTION_GROUP_TYPE = 'azurerm_monitor_action_group';
const RESOURCE_GROUP_TYPE = 'azurerm_resource_group';

/** The literal string an expression is, or null when it is not one string. */
function quoted(expr) {
  if (!expr?.startsWith('"')) return null;
  let end;
  try {
    end = skipString(expr, 0);
  } catch {
    return null;
  }
  return end === expr.length ? expr.slice(1, -1) : null;
}

/**
 * Evaluate a quoted template, handing each `${…}` to `resolve`. Escapes are
 * undone; a `%{…}` directive is refused, since no rule name uses one.
 */
export function evaluateTemplate(expr, resolve) {
  const body = quoted(expr);
  if (body === null) throw new Error(`not a quoted string: ${expr}`);
  let out = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '\\') {
      out += body[i + 1];
      i += 2;
    } else if ((c === '$' || c === '%') && body[i + 1] === c && body[i + 2] === '{') {
      out += `${c}{`;
      i += 3;
    } else if (c === '%' && body[i + 1] === '{') {
      throw new Error(`template directive in ${expr}`);
    } else if (c === '$' && body[i + 1] === '{') {
      // Interpolations in a name hold a bare reference, never a nested brace.
      const close = body.indexOf('}', i + 2);
      out += resolve(body.slice(i + 2, close).trim());
      i = close + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** The module's top-level blocks, grouped by kind. */
export function moduleBlocks(source) {
  const root = parseBody(source);
  if (root.attributes.size > 0) {
    throw new Error(`top-level attributes in the module: ${[...root.attributes.keys()].join(', ')}`);
  }
  const resources = new Map();
  const variables = new Map();
  const providers = [];
  for (const block of root.blocks) {
    if (block.type === 'resource') {
      const [type, name] = block.labels;
      resources.set(`${type}.${name}`, { type, name, ...parseBody(block.body) });
    } else if (block.type === 'variable') {
      variables.set(block.labels[0], parseBody(block.body));
    } else if (block.type === 'provider') {
      providers.push({ name: block.labels[0], ...parseBody(block.body) });
    }
  }
  return { resources, variables, providers };
}

/** `var.x` -> x's string default, or an error naming what was not resolvable. */
function variableResolver(variables) {
  return (reference) => {
    const m = /^var\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(reference);
    if (!m) throw new Error(`cannot resolve \${${reference}}: only var.<name> is read`);
    const variable = variables.get(m[1]);
    if (!variable) throw new Error(`var.${m[1]} is not declared`);
    const value = quoted(variable.attributes.get('default'));
    if (value === null) throw new Error(`var.${m[1]} has no string default`);
    return value;
  };
}

/** provider alias ('' for the default) -> the `sub-…` display name it targets. */
function subscriptionsByAlias({ providers, variables }) {
  const out = new Map();
  for (const provider of providers.filter((p) => p.name === 'azurerm')) {
    const alias = quoted(provider.attributes.get('alias')) ?? '';
    const ref = /^var\.([A-Za-z_]\w*)$/.exec(provider.attributes.get('subscription_id') ?? '');
    if (!ref) throw new Error(`provider azurerm${alias ? `.${alias}` : ''} has no var.<x> subscription_id`);
    const description = quoted(variables.get(ref[1])?.attributes.get('description')) ?? '';
    const named = /\((sub-[a-z0-9-]+)\)\s*$/.exec(description);
    if (!named) {
      throw new Error(`var.${ref[1]}'s description does not end with the subscription's (sub-…) name`);
    }
    out.set(alias, named[1]);
  }
  return out;
}

/** The subscription a resource's `provider` attribute sends it to. */
function subscriptionOf(resource, subscriptions) {
  const expr = resource.attributes.get('provider');
  const alias = expr ? /^azurerm\.([A-Za-z_]\w*)$/.exec(expr)?.[1] : '';
  if (alias === undefined) throw new Error(`${resource.type}.${resource.name}: unreadable provider ${expr}`);
  const subscription = subscriptions.get(alias);
  if (!subscription) throw new Error(`${resource.type}.${resource.name}: no azurerm provider aliased '${alias}'`);
  return subscription;
}

/** A resource group reference, or literal, -> { name, subscription }. */
function resolveResourceGroup(expr, context) {
  const literal = quoted(expr);
  if (literal !== null && !literal.includes('${')) return { name: literal, subscription: null };
  const m = /^azurerm_resource_group\.([A-Za-z_][\w-]*)(?:\["([^"]+)"\])?\.name$/.exec(expr ?? '');
  if (!m) throw new Error(`cannot resolve resource_group_name = ${expr}`);
  const group = context.resources.get(`${RESOURCE_GROUP_TYPE}.${m[1]}`);
  if (!group) throw new Error(`${RESOURCE_GROUP_TYPE}.${m[1]} is not declared`);
  const vars = variableResolver(context.variables);
  const name = evaluateTemplate(group.attributes.get('name'), (reference) => {
    if (reference === 'each.key') {
      if (m[2] === undefined) throw new Error(`${RESOURCE_GROUP_TYPE}.${m[1]} uses each.key; index it`);
      return m[2];
    }
    return vars(reference);
  });
  return { name, subscription: subscriptionOf(group, context.subscriptions) };
}

/** `count = var.x ? 1 : 0` -> 'x'; no count -> null; anything else -> its text. */
export function gateOf(attributes) {
  const count = attributes.get('count');
  if (count === undefined) return null;
  const m = /^var\.([A-Za-z_]\w*)\s*\?\s*1\s*:\s*0$/.exec(count);
  return m ? { variable: m[1] } : { expression: count };
}

/** `true` / `false` literal -> boolean; absent -> the default; else null (unknown). */
function booleanOf(expr, fallback) {
  if (expr === undefined) return fallback;
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  return null;
}

/** Every action group address named in a rule's `action` blocks. */
function actionGroupAddresses(resource) {
  const pattern = new RegExp(`\\b${ACTION_GROUP_TYPE}\\.([A-Za-z_][\\w-]*)\\.id\\b`, 'g');
  return resource.blocks
    .filter((block) => block.type === 'action')
    .flatMap((block) => [...block.body.matchAll(pattern)].map((m) => `${ACTION_GROUP_TYPE}.${m[1]}`));
}

/** An action group address -> { address, name, resourceGroup, subscription }. */
function resolveActionGroup(address, context) {
  const group = context.resources.get(address);
  if (!group) throw new Error(`${address} is not declared`);
  const name = evaluateTemplate(group.attributes.get('name'), variableResolver(context.variables));
  const resourceGroup = resolveResourceGroup(group.attributes.get('resource_group_name'), context);
  const subscription = subscriptionOf(group, context.subscriptions);
  if (resourceGroup.subscription && resourceGroup.subscription !== subscription) {
    throw new Error(`${address}: its provider targets ${subscription}, its resource group ${resourceGroup.subscription}`);
  }
  return { address, name, resourceGroup: resourceGroup.name, subscription };
}

/**
 * The declared alert rules, sorted by subscription, resource group and name.
 *
 * @param {string} source the module text, from terraformSource()
 */
export function declaredAlertRules(source) {
  const blocks = moduleBlocks(source);
  const context = { ...blocks, subscriptions: subscriptionsByAlias(blocks) };
  const rules = [];
  for (const [address, resource] of blocks.resources) {
    const spec = ALERT_TYPES[resource.type];
    if (!spec) {
      if (LOOKS_LIKE_ALERT.test(resource.type)) {
        throw new Error(
          `${address}: ${resource.type} is an alert rule type the verifier cannot read back. ` +
            'Add it to ALERT_TYPES in scripts/lib/alert-declarations.mjs and to the live read.'
        );
      }
      continue;
    }
    const name = evaluateTemplate(resource.attributes.get('name'), variableResolver(context.variables));
    const resourceGroup = resolveResourceGroup(resource.attributes.get('resource_group_name'), context);
    const subscription = subscriptionOf(resource, context.subscriptions);
    if (resourceGroup.subscription && resourceGroup.subscription !== subscription) {
      throw new Error(
        `${address}: its provider targets ${subscription} but its resource group is in ` +
          `${resourceGroup.subscription}; ARM would answer ResourceGroupNotFound`
      );
    }
    const actionGroups = [...new Set(actionGroupAddresses(resource))].map((a) => resolveActionGroup(a, context));
    rules.push({
      address,
      type: resource.type,
      kind: spec.kind,
      armType: spec.armType,
      name,
      resourceGroup: resourceGroup.name,
      subscription,
      gate: gateOf(resource.attributes),
      enabled: booleanOf(resource.attributes.get('enabled'), true),
      autoMitigate: spec.autoMitigate
        ? booleanOf(resource.attributes.get(spec.autoMitigate.attribute), spec.autoMitigate.default)
        : null,
      actionGroups,
    });
  }
  return rules.sort(
    (a, b) =>
      a.subscription.localeCompare(b.subscription) ||
      a.resourceGroup.localeCompare(b.resourceGroup) ||
      a.name.localeCompare(b.name)
  );
}

/**
 * The name an operator table uses for a rule: the Azure name without the
 * `-<environment>-<region>` suffix every rule carries (`alert-app-exceptions`
 * for `alert-app-exceptions-prod-cus`).
 */
export function shortName(rule, suffix) {
  return suffix && rule.name.endsWith(suffix) ? rule.name.slice(0, -suffix.length) : rule.name;
}

/** `-<environment>-<region_abbreviation>` from the module's variable defaults. */
export function environmentSuffix(source) {
  const { variables } = moduleBlocks(source);
  const resolve = variableResolver(variables);
  return `-${resolve('var.environment')}-${resolve('var.region_abbreviation')}`;
}
