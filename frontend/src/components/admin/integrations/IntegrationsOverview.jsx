/**
 * Overview tab — every service on one compact grid, worst first (#570).
 *
 * A tile's status comes from two things: the lights of the keys it uses (from
 * `cms/secrets`, read by this tab) and this session's test of it, if any. A
 * broken service sorts first, then one nobody has set up, so the tile to look
 * at is the top-left one.
 *
 * "Test all" runs each service's own test, one after another — never in
 * parallel — so it sends each provider the single request its card's beaker
 * would. YouTube is left out because its test spends quota; its tile says so.
 * The results are the page's (useServiceTests), so they are still there on the
 * Services tab, each with the time it ran. None of it is stored.
 */

import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { getSessionizeSpeakerId } from '@/lib/adminSettings';
import { buildIntegrationView, sortByStatus, SERVICE_STATUS } from './integrationView';
import { SERVICES } from './serviceRegistry';
import { StateDot, relativeTime } from './StateDot';
import useSecretStatus from './useSecretStatus';
import { TabError, TabLoading } from './TabNotice';

/** Sessionize takes its speaker id; every other test takes nothing. */
export const testArgFor = (service) =>
  service.setting === 'sessionizeSpeakerId' ? getSessionizeSpeakerId() : undefined;

function StatusLine({ status, result, testing }) {
  const presentation = SERVICE_STATUS[status];
  if (testing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Testing…
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {presentation.tone ? (
        <StateDot state={presentation.tone} />
      ) : (
        <span className="inline-block h-2.5 w-2.5 rounded-full border border-muted-foreground/40" />
      )}
      <span className="font-medium" data-testid="service-status">
        {presentation.label}
      </span>
      {result?.at ? (
        <span className="text-muted-foreground">tested {relativeTime(result.at)}</span>
      ) : null}
    </span>
  );
}

function ServiceTile({ service, result, testing, onOpen }) {
  const Icon = service.icon;
  return (
    <Card className="p-3" data-service={service.id}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <button
            type="button"
            onClick={() => onOpen(service.group)}
            className="text-left text-sm font-semibold hover:underline"
            title={`Open ${service.name} on the Services tab`}
          >
            {service.name}
          </button>
          <div>
            <StatusLine status={service.status} result={result} testing={testing} />
          </div>
          {result?.ok === false ? (
            <p className="break-words text-xs text-destructive">{result.message}</p>
          ) : null}
          {service.skipInTestAll ? (
            <p className="text-[11px] text-muted-foreground">
              Not in Test all. {service.skipInTestAll}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default function IntegrationsOverview({ tests, onOpenGroup }) {
  const { data, loading, error, reload } = useSecretStatus();
  const { serviceCards } = buildIntegrationView({
    services: SERVICES,
    sections: data?.sections ?? [],
    secrets: data?.secrets ?? [],
  });
  const tiles = sortByStatus(serviceCards, tests.results);
  const testable = SERVICES.filter((service) => service.test && !service.skipInTestAll);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every service, broken and not-configured first. Test all asks each of the{' '}
          {testable.length} testable services in turn, one at a time. Results last for this session.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => tests.runAll(SERVICES, testArgFor)}
            disabled={tests.runningAll}
          >
            {tests.runningAll ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="mr-2 h-3.5 w-3.5" />
            )}
            {tests.runningAll ? 'Testing…' : 'Test all'}
          </Button>
        </div>
      </div>

      {loading && !data ? <TabLoading>Reading key status…</TabLoading> : null}
      <TabError
        message={error && `Key status could not be read, so only test results are shown: ${error}`}
        onRetry={reload}
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Services">
        {tiles.map((service) => (
          <li key={service.id}>
            <ServiceTile
              service={service}
              result={tests.results[service.id]}
              testing={tests.testing.has(service.id)}
              onOpen={onOpenGroup}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
