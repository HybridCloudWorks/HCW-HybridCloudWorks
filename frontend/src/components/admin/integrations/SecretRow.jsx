/**
 * One credential on the Keys tab: its light, its name, and somewhere to paste
 * a new value or generate one. Moved unchanged out of IntegrationsPage (#570).
 *
 * ## What this row will not show you
 *
 * A credential value. Not masked, not the last four characters. The API has no
 * read path and the app's vault role has no `getSecret` action, so there is
 * nothing here to render even if someone tried. What you get is a light.
 */

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Wand2 } from 'lucide-react';
import { STATE_PRESENTATION, StateDot, relativeTime } from './StateDot';

/** One credential: its light, its name, and somewhere to paste a new value. */
export function SecretRow({ item, onSubmit, busy }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const presentation = STATE_PRESENTATION[item.state] ?? STATE_PRESENTATION.never;

  const submit = async (payload) => {
    const ok = await onSubmit(item.secret, payload);
    // Clear on success only. On a rejection the operator usually wants to see
    // what they pasted — minus the value never having been rendered back, this
    // is their own input in their own field.
    if (ok) {
      setValue('');
      inputRef.current?.blur();
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-1.5">
          <StateDot state={item.state} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{item.label}</span>
            <code className="text-xs text-muted-foreground">{item.secret}</code>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.help}</p>
          {item.usedBy?.length > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Used by <span className="font-medium">{item.usedBy.join(', ')}</span>
            </p>
          ) : null}
          <p className="mt-1 text-xs">
            {/*
              A WRITE IS SLOW AND THE PAGE MUST SAY SO. A spinner inside one
              small button is easy to miss on a phone, and nothing else on the
              row moved, so an operator had no way to tell a save in progress
              from a dead page. While `busy`, the state label is replaced by
              "Saving…" and the rest of the line is suppressed: the old status
              is about to stop being true, and showing it beside a spinner
              invites reading it as the new one.
            */}
            {busy ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </span>
            ) : (
              <>
                <span className="font-medium">{presentation.label}</span>
                {item.lastWriteAt ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · updated {relativeTime(item.lastWriteAt)}
                  </span>
                ) : null}
                {item.state === 'failing' && item.lastFailStatus ? (
                  <span className="text-muted-foreground"> · HTTP {item.lastFailStatus}</span>
                ) : null}
                {item.state === 'failing' && item.lastFailDetail ? (
                  // The provider's own words. `HTTP 401` alone sent two days
                  // into reminting a key that a sentence would have exonerated
                  // or condemned outright (#463 item 4, #358).
                  <span className="text-muted-foreground"> — {item.lastFailDetail}</span>
                ) : null}
                {!item.hasLivenessCheck && item.state === 'live' ? (
                  // Otherwise green would imply "verified", which for these
                  // means only "the reference resolved to something".
                  <span className="text-muted-foreground"> · no liveness check for this one</span>
                ) : null}
              </>
            )}
          </p>
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // The SAME guard the Save button carries. Disabling the button only
          // closes one of two doors: Enter still reaches this handler, so
          // without this an empty or whitespace-only write goes out from the
          // keyboard while the button sits disabled beside it. The server
          // refuses it either way, but a control that is inert and a control
          // that fires a doomed request are not the same thing to whoever is
          // pressing them.
          if (!value.trim()) return;
          submit({ value });
        }}
      >
        <Input
          ref={inputRef}
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          placeholder={item.state === 'never' ? 'Paste key' : 'Paste to rotate'}
          onChange={(event) => setValue(event.target.value)}
          className="w-full font-mono text-xs sm:w-64"
          aria-label={`New value for ${item.label}`}
        />
        {/*
          A REAL SUBMIT BUTTON, because Enter is not a control on a phone.
          This form had none: the only way to store a pasted value was to press
          Enter in the field, and the placeholder only said so on a row that
          had never been set — a rotation just read "Paste to rotate". On a
          mobile keyboard the return key is not reliably a form submit, so
          pasting a value and finding no way to save it is the whole
          interaction. Reported from a phone while trying to correct
          PUBLER-WORKSPACE-ID, which is not `generatable` and so had no button
          of any kind beside it.

          Disabled until there is something to send, so it cannot fire an empty
          write, and it carries the same spinner the rest of the page uses.
        */}
        {/*
          ICON ONLY, and the icon itself becomes the spinner. The first version
          kept the word "Save" beside it, so the only thing that changed during
          a write was a 14px glyph — against a save that takes several seconds
          (a Key Vault write, then an ARM call to refresh the app's references,
          then a reload of this page) that reads as the page having frozen.

          `aria-label` carries the name now that no visible text does.
        */}
        <Button
          type="submit"
          size="sm"
          disabled={busy || !value.trim()}
          aria-label={busy ? `Saving ${item.label}` : `Save ${item.label}`}
          title={busy ? 'Saving…' : `Save this value to ${item.secret}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
        {item.generatable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => submit({ generate: true })}
            title="Generate a random value — this one is invented here, not issued by anyone"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </form>
    </div>
  );
}
