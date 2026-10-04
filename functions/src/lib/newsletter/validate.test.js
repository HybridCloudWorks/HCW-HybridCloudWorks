/**
 * The newsletter admin routes' request parsers (PR #841): each answers the
 * value a handler needs or the sentence the page shows, judged against a
 * clock the test holds.
 */
import { describe, it, expect } from 'vitest';
import {
  RESCHEDULE_LEAD_MS,
  parseAddContactBody,
  parseConsentRecordedOn,
  parseScheduledAt,
  parseSenderBody,
} from './validate.js';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

describe('parseScheduledAt', () => {
  it('normalises an instant at least a minute ahead and refuses the rest', () => {
    expect(parseScheduledAt('2026-10-07T14:00:00+02:00', NOW)).toEqual({
      value: '2026-10-07T12:00:00.000Z',
    });
    expect(parseScheduledAt(undefined, NOW).error).toMatch(/ISO instant/);
    expect(parseScheduledAt('soon', NOW).error).toMatch(/ISO instant/);
    expect(parseScheduledAt(new Date(NOW + RESCHEDULE_LEAD_MS).toISOString(), NOW).error).toMatch(
      /a minute ahead/
    );
    expect(parseScheduledAt('2020-01-01T00:00:00Z', NOW).error).toMatch(/a minute ahead/);
  });
});

describe('parseSenderBody', () => {
  it('settles the shape and trims; the address itself is judged elsewhere', () => {
    expect(parseSenderBody({ from: '  Weekly <w@example.com> ' })).toEqual({
      from: 'Weekly <w@example.com>',
    });
    expect(parseSenderBody({})).toEqual({ from: '' });
    expect(parseSenderBody(null).error).toMatch(/JSON object/);
    expect(parseSenderBody([]).error).toMatch(/JSON object/);
    expect(parseSenderBody({ from: 3 }).error).toMatch(/must be a string/);
  });
});

describe('parseConsentRecordedOn', () => {
  it('needs a date that is not in the future', () => {
    expect(parseConsentRecordedOn('2026-09-01', NOW)).toEqual({
      value: '2026-09-01T00:00:00.000Z',
    });
    expect(parseConsentRecordedOn(undefined, NOW).error).toMatch(/required for a confirmed add/);
    expect(parseConsentRecordedOn('2999-01-01', NOW).error).toMatch(/in the future/);
  });
});

describe('parseAddContactBody', () => {
  it('an invite needs only an address; a confirmed add needs the consent date', () => {
    expect(parseAddContactBody({ email: 'jane@example.com', mode: 'invite' }, NOW)).toEqual({
      email: 'jane@example.com',
      mode: 'invite',
      consentRecordedOn: null,
    });
    expect(
      parseAddContactBody(
        { email: 'jane@example.com', mode: 'confirmed', consentRecordedOn: '2026-09-01' },
        NOW
      )
    ).toEqual({
      email: 'jane@example.com',
      mode: 'confirmed',
      consentRecordedOn: '2026-09-01T00:00:00.000Z',
    });
  });

  it.each([
    ['no body', null, /Send a JSON body/],
    [
      'an unknown field',
      { email: 'j@example.com', mode: 'invite', unsubscribed: false },
      /Unknown field/,
    ],
    ['a bad address', { email: 'not-an-address', mode: 'invite' }, /valid address/],
    ['an unknown mode', { email: 'j@example.com', mode: 'later' }, /mode must be/],
    ['a confirmed add without the date', { email: 'j@example.com', mode: 'confirmed' }, /required/],
  ])('refuses %s with the first rule it breaks', (_name, body, message) => {
    expect(parseAddContactBody(body, NOW).error).toMatch(message);
  });
});
