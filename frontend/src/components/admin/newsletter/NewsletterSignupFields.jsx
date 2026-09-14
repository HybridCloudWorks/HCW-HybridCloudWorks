/**
 * NewsletterSignupFields — the Signup form part of Newsletter settings (#557):
 * where the public signup box appears, and its heading and blurb.
 *
 * Presentational only, like NewsletterContentFields: it edits the settings
 * object the card holds and the card saves the whole document.
 *
 * The preview is the site's own NewsletterSignup in its preview mode, so what
 * the owner sees is the real box with the real styling, and it cannot
 * subscribe anyone: its input and button are disabled and it sends nothing.
 */
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import NewsletterSignup from '@/components/shared/NewsletterSignup';
import {
  MAX_SIGNUP_BLURB_LENGTH,
  MAX_SIGNUP_HEADING_LENGTH,
  SIGNUP_PLACEMENTS,
  SIGNUP_PLACEMENT_LABELS,
} from '@/lib/newsletterSignup';

const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

/** Why the signup form cannot be saved as it stands, or null. */
export function signupProblem(value) {
  if (!String(value.signupHeading ?? '').trim()) return 'Enter a heading for the signup form.';
  return null;
}

function Counter({ id, length, max }) {
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {length}/{max} characters
    </p>
  );
}

export default function NewsletterSignupFields({ value, onChange }) {
  const heading = value.signupHeading ?? '';
  const blurb = value.signupBlurb ?? '';
  const hidden = value.signupPlacement === 'none';
  return (
    <fieldset className="space-y-4 rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold">Signup form</legend>
      <p className="text-sm text-muted-foreground">
        The newsletter signup box on the public site: where it appears and what it says. Plain text
        only. Changes reach visitors within about five minutes of saving.
      </p>
      <div className="space-y-1.5 md:w-1/2">
        <Label htmlFor="nl-signup-placement">Where it appears</Label>
        <select
          id="nl-signup-placement"
          className={SELECT_CLASS}
          value={value.signupPlacement}
          onChange={(event) => onChange({ signupPlacement: event.target.value })}
        >
          {SIGNUP_PLACEMENTS.map((placement) => (
            <option key={placement} value={placement}>
              {SIGNUP_PLACEMENT_LABELS[placement]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nl-signup-heading">Heading</Label>
            <Input
              id="nl-signup-heading"
              maxLength={MAX_SIGNUP_HEADING_LENGTH}
              aria-describedby="nl-signup-heading-count"
              value={heading}
              onChange={(event) => onChange({ signupHeading: event.target.value })}
            />
            <Counter
              id="nl-signup-heading-count"
              length={heading.length}
              max={MAX_SIGNUP_HEADING_LENGTH}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nl-signup-blurb">Blurb</Label>
            <Textarea
              id="nl-signup-blurb"
              rows={3}
              maxLength={MAX_SIGNUP_BLURB_LENGTH}
              aria-describedby="nl-signup-blurb-count"
              value={blurb}
              onChange={(event) => onChange({ signupBlurb: event.target.value })}
            />
            <Counter
              id="nl-signup-blurb-count"
              length={blurb.length}
              max={MAX_SIGNUP_BLURB_LENGTH}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Preview</p>
          {hidden && (
            <p className="text-xs text-muted-foreground">
              Hidden on the site. This is how it would look.
            </p>
          )}
          <NewsletterSignup preview source="preview" heading={heading} blurb={blurb} />
        </div>
      </div>
    </fieldset>
  );
}
