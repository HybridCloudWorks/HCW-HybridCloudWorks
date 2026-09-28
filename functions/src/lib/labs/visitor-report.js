/**
 * The report a visitor reads for a public "Validate on the lab" job (owner
 * request 2026-09-28), built from the job's raw output, which stays for the
 * admin Jobs view only.
 *
 * WHY. The first public run from the Landing Zone Builder succeeded, and the
 * page printed the whole job log under it: the container runtime pulling the
 * runner image layer by layer with its registry and digests, the capability's
 * rewrite of every module source to a path under /opt/avm, `terraform init`
 * listing those paths again, and a provider line ending "(unauthenticated)",
 * which is Terraform's note for a filesystem mirror and reads as alarming to
 * a learner. None of it is for a visitor: public pages speak to visitors
 * only, with no vendors, tools or internals (public-visitor-copy.test.js).
 *
 * WHAT THE REPORT SAYS, in this order:
 *
 *   verdict      'valid' | 'invalid' | 'error', and `headline`, the verdict in
 *                plain words.
 *   errors       Terraform's own error text, one entry per error, because that
 *                is the teaching value: file names and line numbers from the
 *                learner's files stay; a path into the lab's copy of a module
 *                is cut back to `<module>@<version>/<file>`.
 *   modules      `name@version` for each module the lab supplied, from the
 *                capability's rewrite lines, never their paths, with
 *                `modulesNote` saying why the lab has its own copies.
 *   providers    `namespace/name vX.Y.Z`, without "(unauthenticated)".
 *
 * ALLOW-LIST, NOT DENY-LIST. The raw output is read section by section
 * (lab-image/bin/hcw-terraform-validate prints `== module sources`, `==
 * terraform init` and `== terraform validate`), and only three shapes of line
 * are ever taken from it: a `rewrote module` line, an `Installed` provider
 * line, and a Terraform diagnostic inside one of the two Terraform sections.
 * Everything else, including everything before the first section (the image
 * pull, or an agent error), is dropped, so noise nobody has seen yet cannot
 * reach the page. The one free text kept, a diagnostic, is scrubbed of the
 * lab's paths and then dropped whole if any LAB_INTERNALS term survives the
 * scrub; `headline` then says some detail could not be shown.
 *
 * THE VERDICT follows the job status the agent reported
 * (vps-agent/index.js): `succeeded` is exit 0 from the capability, which
 * returns `terraform validate`'s own code, so it is valid; `failed` with at
 * least one error Terraform reported is invalid; anything else that ended is
 * an error, worded by where it stopped. A job still queued or running has no
 * report yet (null).
 *
 * Pure: no I/O, no clock.
 */

/** The terms the report must never carry: the runner, its image, its paths and the host. */
export const LAB_INTERNALS = Object.freeze([
  // The word, not the host: this scans text, and a host-shaped pattern here
  // reads to CodeQL as an unanchored URL check (js/regex/missing-regexp-anchor).
  ['the image registry', /\bghcr\b/i],
  ['an image digest', /sha256:/i],
  ['the container runtime', /\bdocker\b/i],
  ['an image pull', /\bpulling\b|\bpull complete\b|\bdownload complete\b|\bfs layer\b/i],
  ['a path on the runner', /\/opt\/|\/tmp\/run\b|\/workspace\b/],
  ['a path out of the run directory', /\.\.\/\.\.\/\.\.\//],
  ['the runner image', /hcw-lab|hcw-terraform-validate/i],
  ['a container image', /\bimage\b/i],
  ['a registry', /\bregistry\b/i],
  ['the lab host', /hostinger|\bsrv\d+|\bvps\b|\blabjob-/i],
]);

/** The LAB_INTERNALS terms a text contains, as `why: "match"`. */
export function labInternalsIn(text) {
  const found = [];
  for (const [why, pattern] of LAB_INTERNALS) {
    const match = String(text).match(pattern);
    if (match) found.push(`${why}: "${match[0]}"`);
  }
  return found;
}

export const VERDICTS = Object.freeze({ valid: 'valid', invalid: 'invalid', error: 'error' });

/** At most this many errors are carried; Terraform reports every one, and a page needs the first few. */
export const MAX_REPORTED_ERRORS = 20;

/** The visitor's sentences. Plain words, no internals; public-visitor-copy.test.js holds each one. */
export const REPORT_LINES = Object.freeze({
  valid: 'The configuration is valid: Terraform found no errors.',
  invalidOne: 'Terraform found an error in this configuration.',
  invalidMany: 'Terraform found errors in this configuration.',
  hidden:
    'Some of what Terraform reported could not be shown here. Download the files and run terraform validate to see all of it.',
  timeout:
    'The lab ran out of time before Terraform finished. Try again in a few minutes, or download the files and validate locally.',
  cancelled: 'This check was cancelled before it ran. Try again when you are ready.',
  initStopped:
    "Terraform couldn't set up this configuration on the lab, which works offline. It may need a module or provider version the lab doesn't have. Download the files and validate locally.",
  validateStopped:
    "Terraform stopped before it could finish checking this configuration. Download the files and run terraform validate to see why.",
  notRun:
    "The lab couldn't run the check this time. Try again in a few minutes, or download the files and validate locally.",
  modulesNote:
    'The lab uses offline copies of the Azure Verified Modules, so validation needs no internet.',
});

const SECTION_HEADERS = Object.freeze([
  [/^== module sources\b/, 'modules'],
  [/^== terraform init\b/, 'init'],
  [/^== terraform validate\b/, 'validate'],
]);

/** A capability rewrite line: `rewrote module "alz" (Azure/avm-ptn-alz/azurerm 0.21.0) -> <path>`. */
const REWRITE = /^\s*rewrote module "[^"]*" \([^)]*\) -> (\S+)\s*$/;
/** The `<name>@<version>` directory a rewritten source points at, anywhere in its path. */
const VENDORED_DIR = /(?:^|\/)([a-z0-9][a-z0-9-]*)@(\d[0-9A-Za-z.+-]*)(?=\/|$)/;
/** `- Installed hashicorp/azurerm v4.81.0 (unauthenticated)`, and the reused form. */
const PROVIDER =
  /^- (?:Installed|Using previously-installed) ([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*) v(\d[0-9A-Za-z.+-]*)\b/;
/** The first line of a Terraform diagnostic, plain (-no-color) or framed. */
const DIAGNOSTIC_START = /^(Error|Warning): \S/;
/** Lines that end a diagnostic without starting another. */
const DIAGNOSTIC_END = [
  /^Success! The configuration is valid/,
  /^Terraform has been successfully initialized/,
  /^\[output truncated/,
];
/** The box Terraform draws around a diagnostic when colour is on; -no-color draws none. */
const FRAME = /^[╷│╵] ?/;
const FRAME_END = /^╵/;

/**
 * The lab's paths inside a diagnostic, cut back to what a learner can read:
 * a path into a vendored module keeps `<module>@<version>/<file>`, and the
 * run directory and the provider registry's host drop out. The host is a
 * plain string, replaced wherever it appears, rather than a host-shaped
 * pattern.
 */
const SCRUBS = Object.freeze([
  [/(?:\.\.\/)+opt\/avm\//g, ''],
  [/\/opt\/avm\//g, ''],
  [/\/tmp\/run\/src\//g, ''],
  [/\/workspace\//g, ''],
  ['registry.terraform.io/', ''],
]);

const scrub = (text) => SCRUBS.reduce((out, [pattern, to]) => out.replaceAll(pattern, to), text);

function sectionOf(line) {
  for (const [pattern, name] of SECTION_HEADERS) if (pattern.test(line)) return name;
  return null;
}

const trimBlankLines = (lines) => {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
};

/** Collects one Terraform section's diagnostics, line by line. */
function diagnosticCollector() {
  const done = [];
  let open = null;
  const close = () => {
    if (open) done.push({ ...open, text: trimBlankLines(open.lines).join('\n') });
    open = null;
  };
  return {
    line(raw) {
      if (FRAME_END.test(raw)) return close();
      const line = raw.replace(FRAME, '');
      const start = line.match(DIAGNOSTIC_START);
      if (start) {
        close();
        open = { severity: start[1], lines: [line] };
      } else if (DIAGNOSTIC_END.some((pattern) => pattern.test(line))) {
        close();
      } else if (open) {
        open.lines.push(line.replace(/\s+$/, ''));
      }
      return undefined;
    },
    finish() {
      close();
      return done;
    },
  };
}

const pushUnique = (list, value) => {
  if (!list.includes(value)) list.push(value);
};

/**
 * What the raw output shows, by the allow-list above: the sections reached,
 * the modules and providers, and every diagnostic in the Terraform sections.
 */
export function parseValidateOutput(output) {
  const lines = String(output ?? '').replace(/\r\n?/g, '\n').split('\n');
  const reached = new Set();
  const modules = [];
  const providers = [];
  const diagnostics = [];
  let section = null;
  let collector = null;
  const endSection = () => {
    if (collector) diagnostics.push(...collector.finish());
    collector = null;
  };

  for (const line of lines) {
    const next = sectionOf(line);
    if (next) {
      endSection();
      section = next;
      reached.add(next);
      if (next !== 'modules') collector = diagnosticCollector();
      continue;
    }
    if (section === 'modules') {
      const rewrite = line.match(REWRITE);
      const dir = rewrite?.[1].match(VENDORED_DIR);
      if (dir) pushUnique(modules, `${dir[1]}@${dir[2]}`);
    } else if (collector) {
      const provider = section === 'init' ? line.match(PROVIDER) : null;
      if (provider) pushUnique(providers, `${provider[1]} v${provider[2]}`);
      else collector.line(line);
    }
  }
  endSection();
  return { reached, modules, providers, diagnostics };
}

/** Terraform's errors, scrubbed, and how many could not be made safe to show. */
function learnerErrors(diagnostics) {
  const shown = [];
  let hidden = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'Error') continue;
    const text = scrub(diagnostic.text);
    if (labInternalsIn(text).length) hidden += 1;
    else shown.push(text);
  }
  return { shown, hidden };
}

/** Why a job that ended without a verdict from Terraform stopped, in the visitor's words. */
function stoppedLine(status, reached) {
  if (status === 'timeout') return REPORT_LINES.timeout;
  if (status === 'cancelled') return REPORT_LINES.cancelled;
  if (reached.has('validate')) return REPORT_LINES.validateStopped;
  if (reached.has('init')) return REPORT_LINES.initStopped;
  return REPORT_LINES.notRun;
}

const TERMINAL = new Set(['succeeded', 'failed', 'timeout', 'cancelled']);

/** The verdict and its headline, from the status and what Terraform reported. */
function verdictOf(status, parsed, errors) {
  if (status === 'succeeded') return { verdict: VERDICTS.valid, headline: REPORT_LINES.valid };
  if (status === 'failed' && errors.shown.length) {
    const found = errors.shown.length === 1 ? REPORT_LINES.invalidOne : REPORT_LINES.invalidMany;
    const headline = errors.hidden ? `${found} ${REPORT_LINES.hidden}` : found;
    return { verdict: VERDICTS.invalid, headline };
  }
  return { verdict: VERDICTS.error, headline: stoppedLine(status, parsed.reached) };
}

/**
 * The visitor report for one job document, or null while it has not ended.
 *
 * @param {{ status?: string, output?: unknown }} job
 * @returns {null | {
 *   verdict: 'valid'|'invalid'|'error',
 *   headline: string,
 *   errors: string[],
 *   modules: string[],
 *   modulesNote: string|null,
 *   providers: string[],
 * }}
 */
export function buildVisitorReport(job) {
  const status = job?.status;
  if (!TERMINAL.has(status)) return null;
  const parsed = parseValidateOutput(typeof job.output === 'string' ? job.output : '');
  const errors = learnerErrors(parsed.diagnostics);
  const { verdict, headline } = verdictOf(status, parsed, errors);
  return {
    verdict,
    headline,
    errors: verdict === VERDICTS.invalid ? errors.shown.slice(0, MAX_REPORTED_ERRORS) : [],
    modules: parsed.modules,
    modulesNote: parsed.modules.length ? REPORT_LINES.modulesNote : null,
    providers: parsed.providers,
  };
}
