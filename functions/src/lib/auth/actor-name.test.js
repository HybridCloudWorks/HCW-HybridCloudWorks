/**
 * actorName: the first readable claim wins, in a fixed order, and a user
 * with none (or no user at all) is recorded under the caller's fallback.
 */
import { describe, it, expect } from 'vitest';
import { ACTOR_CLAIMS, actorName } from './actor-name.js';

describe('actorName', () => {
  it('prefers email, then preferred_username, then the object ids', () => {
    expect(actorName({ email: 'a@example.test', preferred_username: 'b', oid: 'c' })).toBe(
      'a@example.test'
    );
    expect(actorName({ preferred_username: 'b', oid: 'c', sub: 'd' })).toBe('b');
    expect(actorName({ oid: 'c', sub: 'd' })).toBe('c');
    expect(actorName({ sub: 'd' })).toBe('d');
  });

  it('skips empty claims and falls back for an unnamed or missing user', () => {
    expect(actorName({ email: '', oid: 'c' })).toBe('c');
    expect(actorName({})).toBe('admin');
    expect(actorName(null)).toBe('admin');
    expect(actorName(undefined, 'editor')).toBe('editor');
  });

  it('names every claim it reads, so a new one is added here and nowhere else', () => {
    expect(ACTOR_CLAIMS).toEqual(['email', 'preferred_username', 'oid', 'sub']);
  });
});
