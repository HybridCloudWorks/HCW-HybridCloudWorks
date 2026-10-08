/**
 * No file the repository ships names its former owner's address.
 *
 * The repository moved from the HybridCloudWorks organisation to the
 * personal account saulpatinojr on 2026-10-07. GitHub redirects the old
 * address, so every URL under the organisation's github.com path kept
 * working and nothing failed: the lab host's clone URL, the agent's checkout, the Coder
 * workspace's sparse clone, the docs site's repository link, the links on the
 * labs pages. Each worked only for as long as the redirect does, and a
 * redirect is GitHub's to withdraw, or to hand to whoever registers the
 * organisation's name next. The review of 2026-10-08 (#1009) found them, and
 * this keeps them from coming back.
 *
 * WHAT IS SCANNED. The tracked files under GUARDED: what runs on the lab
 * host, what the site and the Function App ship, the operations scripts, the
 * workflows and the docs site's configuration. Not docs/ or CHANGELOG.md:
 * dated records say where things were when they were written, and are kept
 * as written.
 *
 * WHAT IS ALLOWED. The files in ALLOWED, each with the reason, and nothing
 * else. Both are tests whose fixtures must carry the old address; an
 * allowance no file needs any more fails the test beside this file, so the
 * list can only shrink.
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

/** GitHub owner names are case-insensitive, so the check is too. */
export const FORMER_OWNER_URL = /github\.com\/hybridcloudworks\//i;
export const CURRENT_OWNER_URL = 'https://github.com/saulpatinojr/HCW-HybridCloudWorks';

/** The tracked paths the check reads: a directory ends with `/`, a file does not. */
export const GUARDED = Object.freeze([
  'lab-host/',
  'vps-agent/',
  'frontend/src/',
  'functions/src/',
  'scripts/',
  '.github/',
  'mkdocs.yml',
]);

/** Files allowed to carry the old address, and why. Each must still need it. */
export const ALLOWED = Object.freeze({
  'scripts/no-wiki-pointers.test.mjs':
    'fixtures: a wiki URL under the former owner must still be flagged as a wiki pointer',
  'scripts/check-repo-owner-urls.test.mjs': 'fixtures: the lines this check exists to catch',
});

/** Larger files are not text this repository writes by hand. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The files under GUARDED that git tracks or would track (untracked files
 * that no .gitignore excludes, so a local run sees a new file before it is
 * committed, and node_modules never), relative to the root, with forward
 * slashes.
 */
export function listGuardedFiles(root = REPO) {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...GUARDED],
    { cwd: root, encoding: 'utf8' }
  );
  return [...new Set(out.split('\0').filter(Boolean))];
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
      if (FORMER_OWNER_URL.test(line)) findings.push({ file, line: index + 1, text: line.trim() });
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
  const findings = findFormerOwnerUrls(listGuardedFiles(), readTracked());
  if (findings.length === 0) {
    console.log(`No tracked file under ${GUARDED.join(', ')} names the former owner's GitHub address.`);
    process.exit(0);
  }
  console.error(
    `${findings.length} line(s) name the repository's former owner. It moved to ${CURRENT_OWNER_URL} on 2026-10-07, and the old address works only through GitHub's redirect (#1009):`
  );
  for (const finding of findings) console.error(`  ${describeFinding(finding)}`);
  console.error(
    'Write the current address. A test fixture that must carry the old one is listed in ALLOWED in scripts/check-repo-owner-urls.mjs, with its reason.'
  );
  process.exit(1);
}
