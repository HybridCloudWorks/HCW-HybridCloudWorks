/**
 * The schema walker behind the three ambassador validators (ADR 0033 §4):
 * unknown keys refused first, a required field cleaned on a full write even
 * when absent, only present fields touched on a partial patch, and a
 * refusal naming the field it came from. The handler-level behaviour is
 * pinned in ../ambassador.test.js; this pins the walker's own rules.
 */
import { describe, it, expect } from 'vitest';
import { validateApplication, validateEvidence, validateProgram } from './validate.js';

describe('full writes', () => {
  it('a required field missing from a full write is refused by its own rule', () => {
    expect(validateProgram({})).toEqual({ error: 'name is required' });
    expect(validateApplication({})).toEqual({ error: 'programId is required' });
    expect(validateEvidence({ title: 'T' })).toEqual({ error: 'date is required (YYYY-MM-DD)' });
  });

  it('a required field present but empty is refused the same way', () => {
    expect(validateProgram({ name: '   ' }).error).toBe('name is required');
    expect(validateEvidence({ title: 'T', date: '' }).error).toBe('date is required (YYYY-MM-DD)');
  });

  it('defaults sourceModule to manual and refuses one off the list', () => {
    expect(validateEvidence({ title: 'T', date: '2026-01-02' }).value.sourceModule).toBe('manual');
    expect(validateEvidence({ title: 'T', date: '2026-01-02', sourceModule: 'x' }).error).toMatch(
      /sourceModule must be one of/
    );
  });

  it('unknown keys are refused before any field rule runs, and only own keys count as known', () => {
    expect(validateProgram({ toString: 1 }).error).toMatch(/Unknown program field\(s\): toString/);
    expect(validateApplication({ programId: '', nope: 1 }).error).toMatch(/Unknown application/);
  });
});

describe('partial patches', () => {
  it('touch only the fields present, required ones included', () => {
    expect(validateProgram({ provider: ' Microsoft ' }, { partial: true })).toEqual({
      value: { provider: 'Microsoft' },
    });
    expect(validateEvidence({ notes: 'n' }, { partial: true })).toEqual({ value: { notes: 'n' } });
  });

  it('let a patch clear the evidence date but not send a bad one', () => {
    expect(validateEvidence({ date: null }, { partial: true })).toEqual({ value: { date: null } });
    expect(validateEvidence({ date: 'soon' }, { partial: true }).error).toBe(
      'date must be a YYYY-MM-DD date'
    );
  });

  it('clear an application date with null or an empty string, and name a bad one', () => {
    expect(validateApplication({ decisionDate: '' }, { partial: true }).value).toEqual({
      decisionDate: null,
    });
    expect(validateApplication({ renewalDate: 'x' }, { partial: true }).error).toBe(
      'renewalDate must be a YYYY-MM-DD date'
    );
  });
});

describe('field rules', () => {
  it('program: URLs must be http(s), requirements are checked row by row, numbers are whole', () => {
    expect(validateProgram({ name: 'P', applicationUrl: 'ftp://x' }).error).toBe(
      'applicationUrl must be an http(s) URL'
    );
    expect(validateProgram({ name: 'P', requirements: 'no' }).error).toBe(
      'requirements must be an array'
    );
    expect(validateProgram({ name: 'P', requirements: [{}] }).error).toBe(
      'requirements[0].label is required'
    );
    expect(
      validateProgram({ name: 'P', order: '3.7', reminders: { daysBeforeDeadline: -2 } }).value
    ).toMatchObject({ order: 3, reminders: { daysBeforeDeadline: 0, daysBeforeRenewal: 0 } });
  });

  it('application: a badge may be a site path, custom values are trimmed strings, flags default on', () => {
    const ok = validateApplication({
      programId: 'p',
      badgeImageUrl: '/api/public/media/badge.png',
      customValues: { ' a ': 1 },
      private: 'yes',
    });
    expect(ok.value).toMatchObject({
      badgeImageUrl: '/api/public/media/badge.png',
      customValues: { a: '' },
      private: true,
    });
    expect(validateApplication({ programId: 'p', badgeImageUrl: 'nope' }).error).toBe(
      'badgeImageUrl must be an http(s) URL or a site path'
    );
    expect(validateApplication({ programId: 'p', status: 'won' }).error).toMatch(
      /status must be one of/
    );
  });

  it('evidence: verification status is from the list and a snapshot keeps only an http(s) URL', () => {
    expect(
      validateEvidence({ title: 'T', date: '2026-01-02', verificationStatus: 'maybe' }).error
    ).toMatch(/verificationStatus must be one of/);
    expect(
      validateEvidence({
        title: 'T',
        date: '2026-01-02',
        snapshot: { title: 'S', date: '2026-01-02T10:00:00Z', url: 'javascript:x' },
      }).value.snapshot
    ).toEqual({ title: 'S', date: '2026-01-02', url: null, capturedAt: null });
  });
});
