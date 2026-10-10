/**
 * The AzureWebJobsStorage strip depends on the Function App and nothing else
 * (PLAT-2, #962).
 *
 * Terraform skips every node downstream of a failed one and runs everything
 * else, so the strip can be stranded only by a failure among its ancestors.
 * infra/functionapp.tf explains why no ordering removes the ones on the path
 * itself (the Function App's update, the list, the strip) and why the rest
 * cannot strand it today: the pair's only other ancestors are the Function
 * App's own, and if one of those fails the Function App is skipped and writes
 * nothing to strip.
 *
 * That second half is true only while the pair reaches nothing else. A
 * `depends_on`, or a reference to a resource, a data source, a module or a
 * local (which can reach any of those), added to either block makes a failure
 * there able to skip the strip after azurerm has written the setting. So this
 * holds the two blocks to exactly the references the guarantee assumes.
 *
 * Read as text, like the other checks here that hold infra/ to a claim: it has
 * to fail in CI on a checkout, with no Terraform binary and no credentials.
 */
import { describe, expect, it } from 'vitest';

import { terraformSource } from './terraform-source.mjs';

const FUNCTION_APP = 'azurerm_function_app_flex_consumption.hcw';
const LIST = 'azapi_resource_action.function_app_settings';
const STRIP = 'azapi_update_resource.function_app_settings_without_webjobs_storage';

const source = terraformSource();

/** One top-level block, from its header to the closing brace in column 0. */
function block(address) {
  const [type, name] = address.split('.');
  const match = new RegExp(`^resource "${type}" "${name}" \\{[\\s\\S]*?^\\}`, 'm').exec(source);
  expect(match, `resource "${type}" "${name}" is not in infra/*.tf`).not.toBeNull();
  return match[0];
}

/** The block with its comment lines removed, so prose cannot add or hide a reference. */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join('\n');

/**
 * Every object the block refers to: `type.name` for resources, and
 * `data.`/`module.`/`local.` references in full. `var.` is an input with no
 * graph ancestor of its own and is not counted. The block's own header is
 * skipped.
 */
function references(text) {
  const body = code(text).split('\n').slice(1).join('\n');
  const found = new Set();
  for (const m of body.matchAll(/\b(data\.[a-z0-9_]+\.[a-z0-9_]+|module\.[a-z0-9_]+|local\.[a-z0-9_]+)/g)) {
    found.add(m[1]);
  }
  for (const m of body.matchAll(/(?<!data\.)\b((?:azurerm|azapi|cloudflare|random|time|null|terraform)_[a-z0-9_]+)\.([a-z0-9_]+)/g)) {
    found.add(`${m[1]}.${m[2]}`);
  }
  return [...found].sort();
}

describe('the strip pair depends on the Function App and nothing else', () => {
  it('the list reads only the Function App', () => {
    expect(references(block(LIST))).toEqual([FUNCTION_APP]);
  });

  it('the strip reads only the Function App and the list', () => {
    expect(references(block(STRIP))).toEqual([LIST, FUNCTION_APP].sort());
  });

  it.each([LIST, STRIP])('%s declares no depends_on', (address) => {
    expect(code(block(address))).not.toMatch(/^\s*depends_on\s*=/m);
  });

  it('both are replaced on every Function App change, so every azurerm write is followed by a strip', () => {
    expect(code(block(LIST))).toMatch(
      new RegExp(`replace_triggered_by\\s*=\\s*\\[\\s*${FUNCTION_APP.replace('.', '\\.')}\\s*\\]`)
    );
    expect(code(block(STRIP))).toMatch(new RegExp(`replace_triggered_by\\s*=\\s*\\[\\s*${LIST.replace('.', '\\.')}\\s*\\]`));
  });

  it('the strip removes AzureWebJobsStorage and stamps the writer the detectors read', () => {
    const strip = code(block(STRIP));
    expect(strip).toMatch(/if key != "AzureWebJobsStorage"/);
    expect(strip).toMatch(/"RUNTIME_CONFIG_WRITER" = "azapi-strip"/);
  });

  it('the reference scan sees what it is meant to see', () => {
    // Guards the guard: a scan that matched nothing would pass any block.
    expect(references('resource "x" "y" {\n  a = local.z\n  b = data.azurerm_client_config.c.id\n  depends_on = [cloudflare_dns_record.r]\n}')).toEqual(
      ['cloudflare_dns_record.r', 'data.azurerm_client_config.c', 'local.z']
    );
  });
});
