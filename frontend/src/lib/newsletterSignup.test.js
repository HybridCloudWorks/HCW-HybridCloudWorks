/**
 * The defensive reader for GET public/newsletter/signup-config: a malformed or
 * partial answer changes nothing the server did not clearly mean.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SIGNUP_CONFIG, readSignupConfig } from './newsletterSignup';

describe('readSignupConfig', () => {
  it('takes well-formed fields as the server sent them', () => {
    expect(readSignupConfig({ placement: 'footer', heading: 'Hi', blurb: 'Weekly.' })).toEqual({
      placement: 'footer',
      heading: 'Hi',
      blurb: 'Weekly.',
    });
  });

  it('trims the heading and blurb, and treats a whitespace-only blurb as empty', () => {
    expect(readSignupConfig({ placement: 'both', heading: '  Hi  ', blurb: '   ' })).toEqual({
      placement: 'both',
      heading: 'Hi',
      blurb: '',
    });
  });

  it('falls back to the defaults for a missing, blank or wrongly typed field', () => {
    expect(readSignupConfig({ placement: 'sidebar', heading: '   ', blurb: 7 })).toEqual(
      DEFAULT_SIGNUP_CONFIG
    );
    expect(readSignupConfig(null)).toEqual(DEFAULT_SIGNUP_CONFIG);
  });
});
