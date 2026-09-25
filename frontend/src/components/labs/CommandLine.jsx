/**
 * One pasteable command, labelled with the shell it is written for (#681,
 * #676). The `<code>` carries `data-shell` so a test can check that a card or
 * section prints PowerShell first and bash second, and that each line is
 * exactly the command and nothing else — the line holds the command only;
 * explanation lives in prose beside it.
 */
import React from 'react';

const MUTED = 'text-slate-600 dark:text-slate-400';

export default function CommandLine({ shell, command }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[10px] uppercase tracking-wider ${MUTED}`}>{shell}</span>
      <pre className="overflow-x-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-950 text-slate-100 px-3 py-2 text-xs">
        <code data-shell={shell}>{command}</code>
      </pre>
    </div>
  );
}
