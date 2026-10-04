/**
 * actor-name.js — who a verified user is, for audit rows, `createdBy` and
 * `updatedBy` (ADR 0033: every write names its actor).
 *
 * The Entra token carries the same person under several claims, and the one
 * that is present differs between a delegated sign-in (`email`,
 * `preferred_username`) and an application identity (`oid`, `sub`). Every
 * handler used to spell the same fallback chain inline; this is that chain,
 * once, so a new claim is added in one place.
 */

/** The claims that name a person, most readable first. */
export const ACTOR_CLAIMS = Object.freeze(['email', 'preferred_username', 'oid', 'sub']);

/**
 * The first readable claim on `user`, or `fallback` when none is set (a
 * missing user included).
 *
 * @param {object|null|undefined} user the guard's verified user
 * @param {string} [fallback] what an unnamed actor is recorded as
 * @returns {string}
 */
export function actorName(user, fallback = 'admin') {
  for (const claim of ACTOR_CLAIMS) {
    const value = user?.[claim];
    if (value) return value;
  }
  return fallback;
}
