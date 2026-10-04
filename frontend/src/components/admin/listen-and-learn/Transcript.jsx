/**
 * A chapter's transcript behind a disclosure: the accessible equivalent of
 * the audio, and what makes a chapter reviewable before approval. Shared by
 * the Library row and the Review card so the two cannot drift.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function Transcript({ transcript }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(transcript) || transcript.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {open ? 'Hide transcript' : `Read transcript (${transcript.length} turns)`}
      </button>
      {open && (
        <div className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-2">
          {transcript.map((turn, i) => (
            <p key={`${turn.speaker}-${i}`} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{turn.speaker}: </span>
              {turn.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
