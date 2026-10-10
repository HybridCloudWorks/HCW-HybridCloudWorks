/**
 * Is the Function App's origin lock enforcing? Read where it is enforced.
 * (PLAT-2, #962)
 *
 * ## What this replaced
 *
 * `deploy-functions.yml` used to prove the lock by curling the API's public,
 * Cloudflare-proxied hostname from the runner and passing on anything but a
 * 200. A GitHub-hosted runner asking that hostname is answered by Cloudflare's
 * Bot Fight Mode with a challenge and a 403 before the request leaves
 * Cloudflare. So the step read Cloudflare's answer, never Azure's, and
 * reported "enforcing" whether the Azure restriction was on or off. Turning
 * `functions_origin_lock_enabled` to false would have left it green.
 *
 * ## What it reads instead
 *
 * The control plane: `az functionapp config access-restriction show`, the
 * Function App's own IP security restrictions, held to what `infra/` declares.
 * `infra/functionapp.tf` writes them from `functions_origin_lock_enabled`:
 * when true, one Allow rule per range in `cloudflare_ip_ranges`
 * (`infra/variables.tf`), an explicit IPv4 deny-all, and
 * `ip_restriction_default_action = "Deny"`; when false, no rules and Allow.
 *
 * It fails when:
 *
 *   1. `ipSecurityRestrictionsDefaultAction` is not `Deny`. That is the
 *      unmatched-request action, the one that decides IPv6 and anything no rule
 *      names, and it is what the variable flips. Allow means the variable is
 *      false in the workspace, or the site has drifted from Terraform.
 *   2. Any address an Allow rule lists is `Any`, `0.0.0.0/0` or `::/0`. A rule
 *      may list several addresses separated by commas, and each one is read:
 *      a permitted address beside an unrestricted one does not hide it.
 *   3. A `cloudflare-*` rule lists an address that is not one of the declared
 *      Cloudflare ranges. The name is not what makes a rule Cloudflare's; the
 *      addresses are.
 *   4. A `ci-*` rule lists anything wider than one address. A per-run window
 *      admits one runner, as a /32.
 *   5. An Allow rule is named neither `cloudflare-*` (Terraform's) nor `ci-*`
 *      (a workflow's per-run window). It was added outside Terraform.
 *   6. Unmatched requests are refused and a declared Cloudflare range has no
 *      Allow rule. Cloudflare's edges in that range are refused at the origin;
 *      with none at all the API is unreachable through Cloudflare, which is
 *      not a lock that works.
 *   7. `--window-closed <rule>` was given and that rule is still present: the
 *      caller's own window did not close.
 *
 * The SCM site's posture is printed and not asserted: `functions_scm_lock_enabled`
 * defaults to false, and deploy-functions.yml's SCM window steps already
 * assert that the posture they found is the posture they left.
 *
 * ## Usage
 *
 *     az functionapp config access-restriction show -n APP -g RG -o json \
 *       | node scripts/assert-origin-lock.mjs [--window-closed ci-smoke-<run id>]
 *
 * Run from a checkout: the declared ranges are read from `infra/`. Exit 0
 * enforcing, 1 not enforcing (each reason named), 2 the input or `infra/`
 * could not be read. Every line is Markdown for a job summary, on stdout.
 */
import { pathToFileURL } from 'node:url';

import { INFRA, terraformSource } from './terraform-source.mjs';

/** The Terraform variable that decides the posture, named in every failure. */
export const LOCK_VARIABLE = 'functions_origin_lock_enabled';

/** The Terraform variable that lists the ranges Cloudflare reaches the origin from. */
export const RANGES_VARIABLE = 'cloudflare_ip_ranges';

/**
 * Fewer declared ranges than this means the parse broke, not that Cloudflare
 * shrank: it publishes fifteen IPv4 ranges today. Without the floor a parse
 * that found nothing would fail every rule as "not declared", or, worse, a
 * future edit could make it pass with nothing to hold the rules to.
 */
export const MIN_DECLARED_RANGES = 10;

/** Addresses that, on an Allow rule, admit everyone. */
const EVERYONE = new Set(['any', '0.0.0.0/0', '::/0']);

/** The address field on a rule, whichever spelling the CLI used. */
const addressOf = (rule) => String(rule?.ip_address ?? rule?.ipAddress ?? '').trim();

/**
 * Every address a rule lists. Azure accepts several, comma-separated, in one
 * rule, so a check that compared the whole string would miss one of them.
 */
export const addressesOf = (rule) =>
  addressOf(rule)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

/** Whether a rule admits rather than refuses. */
const isAllow = (rule) => String(rule?.action ?? '').toLowerCase() === 'allow';

/** Whether an address is one host: a bare IP, an IPv4 /32 or an IPv6 /128. */
export function isSingleAddress(address) {
  const [ip, prefix] = String(address).split('/');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return prefix === undefined || prefix === '32';
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':')) return prefix === undefined || prefix === '128';
  return false;
}

/**
 * The Cloudflare ranges `infra/` admits: the default of `cloudflare_ip_ranges`,
 * which `infra/functionapp.tf` turns into one Allow rule each.
 *
 * @param {string} source - the Terraform module, as terraformSource() returns it
 * @returns {string[]} the ranges, in declaration order; empty when not found
 */
export function declaredCloudflareRanges(source) {
  const at = String(source).indexOf(`variable "${RANGES_VARIABLE}"`);
  if (at < 0) return [];
  const end = source.indexOf('\n}', at);
  const block = source.slice(at, end < 0 ? undefined : end);
  const list = /default\s*=\s*\[([\s\S]*?)\]/.exec(block);
  if (!list) return [];
  return [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Read the access-restriction document.
 *
 * Throws when it is not the shape `az functionapp config access-restriction
 * show` prints, because a document without the main site's rules says nothing
 * about the lock and must not be read as "no rules, so open" or "fine".
 */
export function parseRestrictions(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('the input is not JSON. Expected `az functionapp config access-restriction show -o json`.');
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.ipSecurityRestrictions)) {
    throw new Error(
      'the input has no `ipSecurityRestrictions` list. Expected `az functionapp config access-restriction show -o json`.'
    );
  }
  return doc;
}

/** The problems with one Allow rule, and the declared ranges it admits. */
function allowRuleProblems(rule, declared) {
  const name = String(rule?.name ?? '');
  const label = `\`${name || '(unnamed)'}\``;
  const addresses = addressesOf(rule);
  const admitted = [];

  const everyone = addresses.filter((address) => EVERYONE.has(address.toLowerCase()));
  if (everyone.length > 0) {
    return { problems: [`The Allow rule ${label} admits \`${everyone.join(', ')}\`, which is every address.`], admitted };
  }
  if (addresses.length === 0) {
    return {
      problems: [
        `The Allow rule ${label} lists no IP address (\`${rule?.tag ?? rule?.vnet_subnet_resource_id ?? 'no address'}\`), ` +
          'so whom it admits cannot be held to infra/.',
      ],
      admitted,
    };
  }

  if (name.startsWith('cloudflare-')) {
    const foreign = addresses.filter((address) => !declared.has(address));
    admitted.push(...addresses.filter((address) => declared.has(address)));
    return {
      problems:
        foreign.length === 0
          ? []
          : [
              `The Allow rule ${label} admits \`${foreign.join(', ')}\`, which is not a Cloudflare range ` +
                `\`infra/variables.tf\` declares (\`${RANGES_VARIABLE}\`). A rule's name is not what makes it Cloudflare's.`,
            ],
      admitted,
    };
  }
  if (name.startsWith('ci-')) {
    const wide = addresses.filter((address) => !isSingleAddress(address));
    return {
      problems:
        wide.length === 0
          ? []
          : [
              `The Allow rule ${label} admits \`${wide.join(', ')}\`. A per-run window admits one runner, as a /32; ` +
                'anything wider is not a window.',
            ],
      admitted,
    };
  }
  return {
    problems: [
      `The Allow rule ${label} (\`${addresses.join(', ')}\`) is not one Terraform writes (\`cloudflare-*\`) ` +
        "nor a workflow's per-run window (`ci-*`). It was added outside Terraform and admits a caller the " +
        'configuration does not know about.',
    ],
    admitted,
  };
}

/**
 * The reasons the lock is not enforcing; empty when it is.
 *
 * @param {object} doc - parsed access-restriction document
 * @param {{ declaredRanges: string[], windowRule?: string }} options
 */
export function lockProblems(doc, { declaredRanges, windowRule } = {}) {
  const problems = [];
  const rules = doc.ipSecurityRestrictions;
  const declared = new Set(declaredRanges ?? []);

  const defaultAction = doc.ipSecurityRestrictionsDefaultAction;
  const denies = String(defaultAction ?? '').toLowerCase() === 'deny';
  if (!denies) {
    problems.push(
      `The unmatched-request action is \`${defaultAction ?? 'unset'}\`, not \`Deny\`. ` +
        `\`infra/functionapp.tf\` sets it to Deny when \`${LOCK_VARIABLE}\` is true, so this means the ` +
        'variable is false in the `hcw-azure` workspace, or the site has drifted from Terraform. ' +
        'IPv6 and every address no rule names reach the origin directly.'
    );
  }

  const covered = new Set();
  for (const rule of rules.filter(isAllow)) {
    const result = allowRuleProblems(rule, declared);
    problems.push(...result.problems);
    for (const range of result.admitted) covered.add(range);
  }

  // Only while unmatched requests are refused: with Allow, every range gets
  // in anyway, and the first problem above already says the lock is off.
  const uncovered = [...declared].filter((range) => !covered.has(range));
  if (denies && uncovered.length > 0) {
    problems.push(
      `No Allow rule admits ${uncovered.length} of the ${declared.size} Cloudflare ranges ` +
        `\`infra/variables.tf\` declares: ${uncovered.map((range) => `\`${range}\``).join(', ')}. ` +
        "Cloudflare's edges there are refused at the origin" +
        (covered.size === 0 ? ', and with none admitted the API is unreachable through Cloudflare.' : '.')
    );
  }

  if (windowRule && rules.some((rule) => rule?.name === windowRule)) {
    problems.push(`This run's window \`${windowRule}\` is still on the origin after the step that removes it.`);
  }
  return problems;
}

/** Exit code and Markdown lines for a parsed document. */
export function report(doc, options = {}) {
  const problems = lockProblems(doc, options);
  const declared = new Set(options.declaredRanges ?? []);
  const allows = doc.ipSecurityRestrictions.filter(isAllow);
  const admitted = new Set(
    allows
      .filter((rule) => String(rule?.name ?? '').startsWith('cloudflare-'))
      .flatMap(addressesOf)
      .filter((address) => declared.has(address))
  );
  const windows = allows
    .map((rule) => String(rule?.name ?? ''))
    .filter((name) => name.startsWith('ci-'));
  const scm = doc.scmIpSecurityRestrictionsDefaultAction ?? 'unset';

  const facts = [
    `Read from the control plane: unmatched requests \`${doc.ipSecurityRestrictionsDefaultAction ?? 'unset'}\`, ` +
      `${admitted.size} of ${declared.size} declared Cloudflare ranges admitted` +
      (windows.length > 0 ? `, open per-run window(s): ${windows.map((n) => `\`${n}\``).join(', ')}` : '') +
      `. SCM (Kudu) unmatched requests \`${scm}\`, reported only; \`functions_scm_lock_enabled\` governs it.`,
  ];

  if (problems.length === 0) {
    return { code: 0, lines: ['✅ Origin lock: **enforcing**', '', ...facts] };
  }
  return {
    code: 1,
    lines: [
      '❌ Origin lock: **NOT ENFORCING**',
      '',
      ...problems.map((problem) => `- ${problem}`),
      '',
      ...facts,
    ],
  };
}

export const USAGE =
  'usage: az functionapp config access-restriction show -n APP -g RG -o json | ' +
  'node scripts/assert-origin-lock.mjs [--window-closed <rule name>]';

/** An exit-2 answer: the check could not run, which says nothing about the lock. */
const unreadable = (reason) => ({
  code: 2,
  lines: [`⚠️ Origin lock: **unreadable**: ${reason} This says nothing about the lock either way.`],
});

/**
 * Arguments and stdin text in; exit code and stdout lines out.
 *
 * `declaredRanges` defaults to the ones `infra/` declares, read from the
 * checkout; tests pass their own.
 */
export function run({ args = [], input = '', declaredRanges }) {
  let windowRule;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--window-closed' && args[i + 1] && !args[i + 1].startsWith('--')) {
      windowRule = args[i + 1];
      i += 1;
    } else {
      return { code: 2, lines: [`⚠️ Origin lock: **unreadable**: unknown or incomplete argument \`${args[i]}\`.`, USAGE] };
    }
  }

  let ranges = declaredRanges;
  if (ranges === undefined) {
    try {
      ranges = declaredCloudflareRanges(terraformSource(INFRA));
    } catch (error) {
      return unreadable(`infra/ could not be read: ${error.message}`);
    }
  }
  if (ranges.length < MIN_DECLARED_RANGES) {
    return unreadable(
      `only ${ranges.length} Cloudflare ranges were parsed from \`${RANGES_VARIABLE}\` in infra/variables.tf, ` +
        `fewer than ${MIN_DECLARED_RANGES}, so the parse is broken and the rules cannot be held to it.`
    );
  }

  let doc;
  try {
    doc = parseRestrictions(input);
  } catch (error) {
    return unreadable(error.message);
  }
  return report(doc, { windowRule, declaredRanges: ranges });
}

/** All of stdin, as text. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  readStdin()
    .then((input) => run({ args: process.argv.slice(2), input }))
    .then(({ code, lines }) => {
      process.stdout.write(`${lines.join('\n')}\n`);
      process.exitCode = code;
    })
    .catch((error) => {
      process.stdout.write(`⚠️ Origin lock: **unreadable**: ${error?.message || String(error)}\n`);
      process.exitCode = 2;
    });
}
