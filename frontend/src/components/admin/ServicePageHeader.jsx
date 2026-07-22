import React from 'react';

/**
 * ServicePageHeader — standardized header for service-integrated admin pages.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ [icon] Title                                  [Powered by X pill]│
 *   │        ● {service} connected | disconnected                      │
 *   │        Description of what this service does.                    │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Props:
 *   icon         — Lucide icon component (required)
 *   title        — Page title (required)
 *   service      — Service name shown in status line, e.g. "Publer" or "Plaud"
 *   connected    — boolean | 'checking'  (controls dot color + text)
 *   description  — Short paragraph under the status line
 *   poweredBy    — Service brand name for the top-right pill (defaults to `service`)
 *   accent       — Tailwind color stem for the pill border/text, e.g. 'pink' | 'violet'
 *                  Defaults to 'slate'.
 */
export default function ServicePageHeader({
  icon: Icon,
  title,
  service,
  connected,
  description,
  poweredBy,
  accent = 'slate',
}) {
  let dotClass = 'bg-rose-400';
  let statusText = `${service} disconnected`;
  if (connected === 'checking') {
    dotClass = 'bg-slate-300 animate-pulse';
    statusText = `Checking ${service}…`;
  } else if (connected) {
    dotClass = 'bg-emerald-500';
    statusText = `${service} connected`;
  }
  const hasPowerSource = poweredBy || service;

  // Tailwind needs literal class names. Whitelist the common accent colors.
  const ACCENTS = {
    pink: 'border-pink-300 text-pink-600 dark:border-pink-700 dark:text-pink-400',
    violet: 'border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400',
    indigo: 'border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400',
    sky: 'border-sky-300 text-sky-600 dark:border-sky-700 dark:text-sky-400',
    emerald: 'border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400',
    amber: 'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400',
    slate: 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400',
  };
  const pillClasses = ACCENTS[accent] || ACCENTS.slate;
  const iconColorClass =
    accent === 'slate' ? 'text-slate-500' : `text-${accent}-500 dark:text-${accent}-400`;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          {Icon && <Icon className={`h-6 w-6 ${iconColorClass}`} />}
          {title}
        </h1>
        <p className="text-xs mt-1 flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
          {statusText}
        </p>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl">{description}</p>
        )}
      </div>
      {hasPowerSource && (
        <span
          className={`shrink-0 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${pillClasses}`}
        >
          Powered by {hasPowerSource}
        </span>
      )}
    </div>
  );
}
