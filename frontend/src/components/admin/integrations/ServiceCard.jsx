/**
 * One service on the Services tab: what it is, where it lives, whether it
 * answers, and the names of the keys it runs on.
 *
 * THE LAYOUT IS THE POINT OF THIS COMPONENT. Identity on the left, actions as
 * two icon buttons pinned to the top right, and the keys in their own bordered
 * subgroup below. A globe is a link out and a beaker is a test; neither needs
 * a word, and words were what made the row wrap.
 *
 * KEYS ARE NAMES AND LIGHTS HERE, NOTHING MORE (#570). Pasting, rotating and
 * generating moved to the Keys tab, which is where every key lives; a card
 * saying "PUBLER-API-KEY — Rejected" and linking there is the whole job. That
 * keeps one write path per key rather than two that look like different keys.
 *
 * The test result is held by the page (useServiceTests), so it is still there
 * after a trip to another tab and shows on the Overview grid too.
 */

import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, FlaskConical, Globe, Loader2 } from 'lucide-react';
import { STATE_PRESENTATION, StateDot, relativeTime } from './StateDot';

export function TestResultLine({ result }) {
  if (!result) return null;
  return (
    <p
      className={`mt-3 flex items-start gap-1.5 text-xs ${
        result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
      }`}
    >
      {result.ok ? (
        <CheckCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">{result.message}</span>
    </p>
  );
}

export function ServiceActions({ service, testing, onTest }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {service.url && (
        <Button
          asChild
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title={`Open ${service.name} — ${service.url}`}
        >
          <a href={service.url} target="_blank" rel="noopener noreferrer">
            <Globe className="h-4 w-4" />
            <span className="sr-only">{`Open ${service.name}`}</span>
          </a>
        </Button>
      )}
      {service.test && (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onTest}
          disabled={testing}
          title={testing ? 'Testing…' : `Test the ${service.name} connection`}
          aria-label={testing ? `Testing ${service.name}` : `Test ${service.name}`}
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FlaskConical className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}

function KeyNames({ items }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 divide-y divide-border/60 rounded-md border border-border/60 bg-muted/20 px-3 text-xs">
      {items.map((item) => (
        <li key={item.secret} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
          <StateDot state={item.state} />
          <code className="text-muted-foreground">{item.secret}</code>
          <span className="font-medium">
            {(STATE_PRESENTATION[item.state] ?? STATE_PRESENTATION.never).label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ServiceCard({ service, result, testing, onTest, children }) {
  const Icon = service.icon;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{service.name}</p>
            {result && (
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  result.ok
                    ? 'border-emerald-300 text-emerald-600'
                    : 'border-destructive/50 text-destructive'
                }`}
              >
                {result.ok ? 'Connected' : 'Failed'}
              </Badge>
            )}
            {result?.at && (
              <span className="text-[11px] text-muted-foreground">
                tested {relativeTime(result.at)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{service.description}</p>
        </div>
        <ServiceActions service={service} testing={testing} onTest={onTest} />
      </div>

      <TestResultLine result={result} />
      <KeyNames items={service.items ?? []} />

      {service.credentialNote && (
        <p className="mt-3 text-xs text-muted-foreground">{service.credentialNote}</p>
      )}
      {children}
    </Card>
  );
}
