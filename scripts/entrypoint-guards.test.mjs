import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPAWNING EACH SCRIPT FOR REAL, because the thing under test is whether its
// "am I the main module?" guard fires at all. The import-based tests in this
// suite exercise the exports and say nothing about the guard; a guard that
// stops matching makes the process exit 0 having run nothing, which reads as
// success to an operator and to CI. The guard used to be
// `import.meta.url === \`file://${process.argv[1]}\``, which never matches on
// Windows (argv[1] is `C:\...`), so smoke-deployed.mjs run from PowerShell
// reported nothing and exited 0. Each case below asserts the script's own
// no-op path, which cannot be observed unless main() actually ran.
const SCRIPTS = dirname(fileURLToPath(import.meta.url));

function run(name, args, env) {
  try {
    const stdout = execFileSync(process.execPath, [join(SCRIPTS, name), ...args], {
      encoding: 'utf8',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('entry-point guards fire when the script is invoked directly', () => {
  it('apply-computed-sortdate.mjs prints usage for --help and exits 0', () => {
    const got = run('apply-computed-sortdate.mjs', ['--help'], process.env);
    expect(got.code).toBe(0);
    expect(got.stdout).toContain('Usage: node apply-computed-sortdate.mjs');
  });

  it('smoke-deployed.mjs refuses to run without --base and exits non-zero', () => {
    const env = { ...process.env };
    delete env.SMOKE_BASE_URL;
    const got = run('smoke-deployed.mjs', [], env);
    expect(got.code).not.toBe(0);
    expect(got.stdout + got.stderr).toContain('Usage: node smoke-deployed.mjs');
  });

  it('build-content-manifest.mjs fails loudly without FUNCTION_ORIGIN', () => {
    const env = { ...process.env };
    delete env.FUNCTION_ORIGIN;
    delete env.FORCE_RUN;
    const got = run('build-content-manifest.mjs', [], env);
    expect(got.code).toBe(1);
    expect(got.stderr).toContain('FUNCTION_ORIGIN is not set');
  });
});
