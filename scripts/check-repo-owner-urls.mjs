/**
 * No live file names the repository's former owner.
 *
 * The repository moved from the HybridCloudWorks organisation to the
 * personal account saulpatinojr on 2026-10-07. GitHub redirects the old
 * address, so every reference under the organisation kept working and
 * nothing failed: the lab host's clone URL, the agent's checkout, the Coder
 * workspace's sparse clone, the docs site's repository link, the labs pages,
 * the runbooks' `gh --repo` lines and their raw.githubusercontent.com
 * download. Each worked only for as long as the redirect does, and a redirect
 * is GitHub's to withdraw, or to hand to whoever registers the organisation's
 * name next. The review of 2026-10-08 (#1009) found them, and this keeps
 * them from coming back.
 *
 * WHAT COUNTS. The repository's web and git address under the old owner
 * (`github.com/<old>/`, `github.com:<old>/`), and its owner/name, which is the
 * form raw.githubusercontent.com, the REST API's /repos/ path and
 * `gh --repo` all use. Not the organisation itself: it still exists, by the
 * owner's decision of 2026-10-08, so its project boards and the image
 * namespace `<old>/hcw-lab*` are not stale (review of #1018).
 *
 * WHAT IS SCANNED. Every tracked text file — code, workflows, runbooks, the
 * session instructions, infra-lab — except the dated records in HISTORICAL,
 * which say where things were when they were written and are kept as
 * written. A new file is scanned from the moment it exists; the list of
 * places it may say the old name is the short one.
 *
 * WHAT IS ALLOWED. The files in ALLOWED, each with the reason, and nothing
 * else. An allowance no file needs any more fails the test beside this file,
 * so the list can only shrink.
 *
 * Dependency-free and runnable on its own for check-oidc-owner.mjs's reason:
 * the change that brings an old address back can touch any path, and the
 * scripts suite runs only when its path filter matches, so ci.yml runs this
 * on every pull request and the test imports the same functions.
 *
 *   node scripts/check-repo-owner-urls.mjs
 *
 * Exit 0 and one line when clean; exit 1 with `file:line: text` for every
 * occurrence otherwise.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// Joined from parts so this file, which the check also reads, never contains
// what it looks for.
const OLD_OWNER = ['hybrid', 'cloud', 'works'].join('');
const REPO_NAME = 'hcw-hybridcloudworks';

/**
 * The forms of the former owner's repository, lower-cased: owner names are
 * case-insensitive, and so is the search.
 */
export const FORMER_OWNER_FORMS = Object.freeze([
  `github.com/${OLD_OWNER}/`,
  `github.com:${OLD_OWNER}/`,
  `${OLD_OWNER}/${REPO_NAME}`,
]);

const NAME_CHAR = /[a-z0-9-]/;

/**
 * Whether a line names one of FORMER_OWNER_FORMS. A substring search on
 * purpose: this scans text for an occurrence, it does not validate a URL, so
 * there is nothing to anchor (CodeQL js/regex/missing-regexp-anchor flagged
 * the earlier regex form on #1018). The owner/name form must start a name,
 * so `<someone>-<old>/…` is not the old owner.
 */
export function namesFormerOwner(text) {
  const line = String(text).toLowerCase();
  return FORMER_OWNER_FORMS.some((form) => {
    for (let at = line.indexOf(form); at !== -1; at = line.indexOf(form, at + 1)) {
      if (form.startsWith('github.com') || at === 0 || !NAME_CHAR.test(line[at - 1])) return true;
    }
    return false;
  });
}

export const CURRENT_OWNER_URL = 'https://github.com/saulpatinojr/HCW-HybridCloudWorks';

/**
 * Dated records, not scanned: a directory ends with `/`, a file does not.
 * They say where things were when they were written.
 */
export const HISTORICAL = Object.freeze([
  'CHANGELOG.md',
  'docs/history/',
  'docs/decisions/',
  'docs/architecture/architecture-review-2026-08.md',
  'docs/architecture/resource-validation-report.md',
]);

/** Files allowed to carry the old name, and why. Each must still need it. */
export const ALLOWED = Object.freeze({
  'scripts/no-wiki-pointers.test.mjs':
    'fixtures: a wiki URL under the former owner must still be flagged as a wiki pointer',
  'scripts/check-repo-owner-urls.test.mjs': 'fixtures: the lines this check exists to catch',
  'functions/src/lib/cms/repo-draft.js':
    'an id seed, not an address: every imported draft id hashes the name the repository had when drafts were first imported',
  'functions/src/lib/cms/repo-draft.test.js':
    'pins that id seed, and an id computed under it before the move',
});

/** Larger files are not text this repository writes by hand. */
const MAX_BYTES = 2 * 1024 * 1024;

const isHistorical = (file) =>
  HISTORICAL.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * The files git tracks or would track (untracked files that no .gitignore
 * excludes, so a local run sees a new file before it is committed, and
 * node_modules never), outside HISTORICAL, relative to the root, with
 * forward slashes.
 */
export function listGuardedFiles(root = REPO) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split('\0').filter(Boolean))].filter((file) => !isHistorical(file));
}

/**
 * Every occurrence in `files` outside ALLOWED, as `{ file, line, text }`.
 *
 * @param {string[]} files - paths relative to the root
 * @param {(file: string) => string | Buffer | null} read - null to skip a file
 */
export function findFormerOwnerUrls(files, read) {
  const findings = [];
  for (const file of files) {
    if (Object.hasOwn(ALLOWED, file)) continue;
    const content = read(file);
    if (content === null || content === undefined) continue;
    const text = String(content);
    if (text.includes('\0')) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (namesFormerOwner(line)) findings.push({ file, line: index + 1, text: line.trim() });
    });
  }
  return findings;
}

/** A file's content, or null when it is gone, unreadable or too large to be source. */
export function readTracked(root = REPO) {
  return (file) => {
    try {
      const buffer = readFileSync(join(root, file));
      return buffer.length > MAX_BYTES ? null : buffer.toString('utf8');
    } catch {
      return null;
    }
  };
}

/** `file:line: text`, the line cut to 200 characters. */
export function describeFinding({ file, line, text }) {
  return `${file}:${line}: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = listGuardedFiles();
  const findings = findFormerOwnerUrls(files, readTracked());
  if (findings.length === 0) {
    console.log(
      `No tracked file outside the dated records (${HISTORICAL.join(', ')}) names the former owner's repository; ${files.length} files read.`
    );
    process.exit(0);
  }
  console.error(
    `${findings.length} line(s) name the repository's former owner. It moved to ${CURRENT_OWNER_URL} on 2026-10-07, and the old name works only through GitHub's redirect (#1009):`
  );
  for (const finding of findings) console.error(`  ${describeFinding(finding)}`);
  console.error(
    'Write the current owner. A file that must carry the old name is listed in ALLOWED in scripts/check-repo-owner-urls.mjs, with its reason; a dated record belongs in HISTORICAL.'
  );
  process.exit(1);
}
