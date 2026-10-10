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
 * Function App's own IP security restrictions. `infra/functionapp.tf` writes
 * them from `functions_origin_lock_enabled`: when true, an Allow rule per
 * Cloudflare range named `cloudflare-<range>`, an explicit IPv4 deny-all, and
 * `ip_restriction_default_action = "Deny"`; when false, no rules and Allow.
 *
 * It fails when:
 *
 *   1. `ipSecurityRestrictionsDefaultAction` is not `Deny`. That is the
 *      unmatched-request action, the one that decides IPv6 and anything no rule
 *      names, and it is what the variable flips. Allow means the variable is
 *      false in the workspace, or the site has drifted from Terraform.
 *   2. An Allow rule admits every address (`Any`, `0.0.0.0/0`, `::/0`): the
 *      lock is defeated whatever the default action says.
 *   3. An Allow rule is named neither `cloudflare-*` (Terraform's) nor
 *      `ci-*` (a per-run window a workflow opens for its own runner and
 *      removes). Anything else was added outside Terraform and admits someone
 *      the configuration does not know about.
 *   4. `--window-closed <rule>` was given and that rule is still present: the
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
 * Exit 0 enforcing, 1 not enforcing (each reason named), 2 the input could
 * not be read. Every line is Markdown for a job summary, on stdout.
 */
import { pathToFileURL } from 'node:url';

/** The Terraform variable that decides the posture, named in every failure. */
export const LOCK_VARIABLE = 'functions_origin_lock_enabled';

/** Addresses that, on an Allow rule, admit everyone. */
const EVERYONE = new Set(['any', '0.0.0.0/0', '::/0']);

/** The address on a rule, whichever spelling the CLI used. */
const addressOf = (rule) => String(rule?.ip_address ?? rule?.ipAddress ?? '').trim();

const isAllow = (rule) => String(rule?.action ?? '').toLowerCase() === 'allow';

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

/**
 * The reasons the lock is not enforcing; empty when it is.
 *
 * @param {object} doc - parsed access-restriction document
 * @param {{ windowRule?: string }} [options]
 */
export function lockProblems(doc, { windowRule } = {}) {
  const problems = [];
  const rules = doc.ipSecurityRestrictions;

  const defaultAction = doc.ipSecurityRestrictionsDefaultAction;
  if (String(defaultAction ?? '').toLowerCase() !== 'deny') {
    problems.push(
      `The unmatched-request action is \`${defaultAction ?? 'unset'}\`, not \`Deny\`. ` +
        `\`infra/functionapp.tf\` sets it to Deny when \`${LOCK_VARIABLE}\` is true, so this means the ` +
        'variable is false in the `hcw-azure` workspace, or the site has drifted from Terraform. ' +
        'IPv6 and every address no rule names reach the origin directly.'
    );
  }

  for (const rule of rules.filter(isAllow)) {
    const address = addressOf(rule);
    const name = String(rule?.name ?? '');
    if (EVERYONE.has(address.toLowerCase())) {
      problems.push(`The Allow rule \`${name || '(unnamed)'}\` admits \`${address}\`, which is every address.`);
    } else if (!name.startsWith('cloudflare-') && !name.startsWith('ci-')) {
      problems.push(
        `The Allow rule \`${name || '(unnamed)'}\` (\`${address || rule?.tag || 'no address'}\`) is not one ` +
          "Terraform writes (`cloudflare-*`) nor a workflow's per-run window (`ci-*`). It was added " +
          'outside Terraform and admits a caller the configuration does not know about.'
      );
    }
  }

  if (windowRule && rules.some((rule) => rule?.name === windowRule)) {
    problems.push(`This run's window \`${windowRule}\` is still on the origin after the step that removes it.`);
  }
  return problems;
}

/** Exit code and Markdown lines for a parsed document. */
export function report(doc, options = {}) {
  const problems = lockProblems(doc, options);
  const allows = doc.ipSecurityRestrictions.filter(isAllow);
  const cloudflare = allows.filter((rule) => String(rule?.name ?? '').startsWith('cloudflare-')).length;
  const windows = allows
    .map((rule) => String(rule?.name ?? ''))
    .filter((name) => name.startsWith('ci-'));
  const scm = doc.scmIpSecurityRestrictionsDefaultAction ?? 'unset';

  const facts = [
    `Read from the control plane: unmatched requests \`${doc.ipSecurityRestrictionsDefaultAction ?? 'unset'}\`, ` +
      `${cloudflare} Cloudflare allow rule(s)` +
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

/** Arguments and stdin text in; exit code and stdout lines out. */
export function run({ args = [], input = '' }) {
  let windowRule;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--window-closed' && args[i + 1] && !args[i + 1].startsWith('--')) {
      windowRule = args[i + 1];
      i += 1;
    } else {
      return { code: 2, lines: [`⚠️ Origin lock: **unreadable**: unknown or incomplete argument \`${args[i]}\`.`, USAGE] };
    }
  }
  let doc;
  try {
    doc = parseRestrictions(input);
  } catch (error) {
    return {
      code: 2,
      lines: [`⚠️ Origin lock: **unreadable**: ${error.message} This says nothing about the lock either way.`],
    };
  }
  return report(doc, { windowRule });
}

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
