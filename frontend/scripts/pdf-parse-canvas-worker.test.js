// @vitest-environment node
/**
 * pdf-parse's native canvas addon lets a worker thread exit (#720).
 *
 * Importing pdf-parse evaluates pdfjs-dist's Node build, which `require`s
 * @napi-rs/canvas at load time. On Windows, @napi-rs/canvas 0.1.80 — the
 * version pdf-parse 2.4.5 pins — kills the whole process with 0xC0000005 when
 * a worker thread that loaded it exits. Vitest's `vmThreads` pool runs test
 * files in worker threads and update-applied-skills.test.js imports pdf-parse,
 * so on Windows `npm test` died partway through, under Node 24 and 26 alike,
 * and looked like a vmThreads bug. The fork pools never crashed because they
 * load the addon on a process's main thread. Linux does not crash at all,
 * which is why CI never saw it.
 *
 * package.json overrides @napi-rs/canvas to ^1.0.9. Measured on Windows 11
 * with Node 26.10.0 and the probe below: 0.1.80 crashed 17 runs of 17, 1.0.5
 * crashed 8 of 30, 1.0.6 none of 30 and 1.0.9 none of 90. Under Node 24.21.0,
 * 0.1.80 crashed 12 of 12.
 * pdf-parse's text for both catalogue posters is byte-identical under 0.1.80
 * and 1.0.9.
 *
 * The first test holds the override on every platform, including CI's Linux,
 * which cannot observe the crash. The second reproduces the mechanism in a
 * child process, so on Windows a regression fails here with its cause named
 * instead of only taking the run down. On Linux it passes either way.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Resolve from pdfjs-dist, because that is the copy it loads.
const fromPdfjs = createRequire(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const canvasEntry = fromPdfjs.resolve('@napi-rs/canvas');
const canvasVersion = JSON.parse(
  readFileSync(fromPdfjs.resolve('@napi-rs/canvas/package.json'), 'utf8')
).version;

const atLeast = (version, floor) => {
  const [a, b] = [version, floor].map((v) => v.split(/[.-]/).slice(0, 3).map(Number));
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

// Ten rounds of eight workers, each loading the addon and exiting: the probe
// behind the numbers above, and about half a second's work.
const churn = `
const { Worker } = require('node:worker_threads');
(async () => {
  for (let round = 0; round < 10; round += 1) {
    await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const worker = new Worker('require(require("node:worker_threads").workerData)', {
        eval: true,
        workerData: process.argv[1],
      });
      worker.on('error', reject);
      worker.on('exit', resolve);
    })));
  }
})();
`;

describe('@napi-rs/canvas, as pdfjs-dist loads it (#720)', () => {
  it('is 1.0.9 or newer, the override in package.json', () => {
    expect(atLeast(canvasVersion, '1.0.9'), `@napi-rs/canvas ${canvasVersion}`).toBe(true);
  });

  it('lets worker threads that loaded it exit without killing the process', () => {
    const run = spawnSync(process.execPath, ['-e', churn, canvasEntry], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    const status = run.status === null ? 'none' : `0x${(run.status >>> 0).toString(16)}`;
    expect(
      { status: run.status, signal: run.signal },
      `exit status ${status}, signal ${run.signal}; stderr: ${run.stderr}`
    ).toEqual({ status: 0, signal: null });
  }, 60_000);
});
