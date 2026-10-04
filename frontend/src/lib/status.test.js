import { describe, it, expect } from 'vitest';
import { CONTENT_STATUS, SYSTEM_STATUS, contentStatusInfo, toSystemStatus } from './status';

describe('toSystemStatus', () => {
  it('maps the words five surfaces used onto five shared states', () => {
    for (const word of ['PASS', 'ok', 'connected', 'Working', 'OPERATIONAL', 'live'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.healthy);
    for (const word of ['degraded', 'REGIONAL', 'Going live', 'pending'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.degraded);
    for (const word of ['Not configured', 'never', 'misconfigured'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.misconfigured);
    for (const word of ['FAIL', 'error', 'Broken', 'failing', 'offline'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.unavailable);
    for (const word of ['', null, undefined, 'untested', 'something-else'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.unknown);
  });

  it('gives every state a tone, a label and a help sentence', () => {
    for (const state of Object.values(SYSTEM_STATUS)) {
      expect(['ok', 'warn', 'bad', 'muted']).toContain(state.tone);
      expect(state.help).toMatch(/\w+/);
      expect(state.label).toMatch(/^[A-Z]/);
    }
  });
});

describe('contentStatusInfo', () => {
  it('knows every stored status and reads the legacy spellings', () => {
    for (const id of Object.keys(CONTENT_STATUS)) expect(contentStatusInfo(id).id).toBe(id);
    expect(contentStatusInfo('approved_blog').id).toBe('approved');
    expect(contentStatusInfo('published_blog').id).toBe('published');
    expect(contentStatusInfo('approved_news').label).toBe('Approved');
  });

  it('calls an item Live when its Live flag is set, whatever the status says', () => {
    expect(contentStatusInfo({ contentStatus: 'published', Live: true }).label).toBe('Live');
    expect(contentStatusInfo({ contentStatus: 'editing', Live: true }).id).toBe('live');
    expect(contentStatusInfo({ contentStatus: 'rejected', Live: true }).id).toBe('rejected');
  });

  it('shows an unknown status as words rather than throwing', () => {
    expect(contentStatusInfo('some_new_state').label).toBe('some new state');
    expect(contentStatusInfo({}).id).toBe('ingested');
  });
});
