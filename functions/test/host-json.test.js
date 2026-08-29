/**
 * host.json is a production configuration file that nothing validated.
 *
 * On 2026-08-22 a change added explanatory comments to `logging.logLevel` as
 * `"//"` keys whose values were English sentences. Every key under logLevel is
 * a log CATEGORY and every value must be a LogLevel; the host could not parse
 * the file, refused to start, and answered 503 to every request. The whole
 * test suite passed, because no test had ever opened this file.
 *
 * The deploy caught it — `deploy-functions.yml` asserts SyncTriggers succeeds
 * and it did not — but a deploy is an expensive place to learn that a JSON file
 * is malformed, and the failure arrives after the package is already live.
 *
 * These assertions are deliberately about SHAPE, not policy. They do not care
 * which level a category is set to; they care that it is a level at all, that
 * the file parses, and that the two settings with known teeth are not silently
 * turned off again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOST_JSON = fileURLToPath(new URL('../host.json', import.meta.url));
const raw = readFileSync(HOST_JSON, 'utf8');

/** The only values Microsoft.Extensions.Logging accepts. */
const LOG_LEVELS = ['Trace', 'Debug', 'Information', 'Warning', 'Error', 'Critical', 'None'];

describe('host.json', () => {
  it('is valid JSON — it has no comment syntax, whatever the temptation', () => {
    // JSON.parse is what the host effectively does. A `//` key is legal JSON
    // and illegal configuration, which is why this file needs the assertions
    // below and not just a parse.
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  const config = JSON.parse(raw);

  it('declares the schema version the host expects', () => {
    expect(config.version).toBe('2.0');
  });

  it('every logLevel value is an actual log level', () => {
    const levels = config.logging?.logLevel ?? {};
    const invalid = Object.entries(levels)
      .filter(([, value]) => !LOG_LEVELS.includes(value))
      .map(([category, value]) => `${category} = ${JSON.stringify(value)}`);
    expect(invalid, `not a LogLevel (expected one of ${LOG_LEVELS.join(', ')})`).toEqual([]);
  });

  it('every logLevel key is a plausible category, not a smuggled comment', () => {
    // A category is a .NET namespace-ish token. Anything with whitespace or a
    // leading slash is prose that has wandered in.
    const bad = Object.keys(config.logging?.logLevel ?? {}).filter(
      (category) => !/^[A-Za-z][\w.]*$/.test(category)
    );
    expect(bad, 'logLevel keys must be log categories').toEqual([]);
  });

  it('keeps Host.Results at Information, or AppRequests is empty', () => {
    // Request telemetry is emitted at Information. Setting this category above
    // it does not quieten the table — it empties it, permanently and silently.
    // That is the table Migration-Plan §7's scheduled-job gate reads to answer
    // "did the timer fire", so raising this makes the gate unobservable
    // (TODO.md T-514).
    expect(config.logging?.logLevel?.['Host.Results']).toBe('Information');
  });

  it('keeps the Azure SDK categories quiet, or the ingestion cap goes to noise', () => {
    // Azure.Core logs every SDK HTTP request and response, and the host polls
    // blob leases continuously: 39.3 MB across 76,125 messages in 24 hours
    // against a 0.25 GB/day workspace cap, with Azure.Identity adding 4.4 MB.
    // At Information these two alone exhaust the budget and every application
    // log after that is discarded at ingestion — which is exactly how two
    // investigations went blind on 2026-08-22 (T-514).
    for (const category of ['Azure.Core', 'Azure.Identity']) {
      const level = config.logging?.logLevel?.[category];
      expect(LOG_LEVELS.indexOf(level), `${category} must be Warning or quieter`).toBeGreaterThanOrEqual(
        LOG_LEVELS.indexOf('Warning')
      );
    }
  });
});
