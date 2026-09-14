/**
 * Services tab — one group at a time (#570).
 *
 * A row of group buttons (Communication, Content, Education, …) picks which
 * group's cards show. The group is in the URL as `?group=`, so a link can open
 * straight onto one. Each card carries its description, its docs link, its
 * test, and the names and lights of the keys it uses; the keys themselves are
 * changed on the Keys tab.
 *
 * Loads its own credential status. When that read fails the cards still
 * render — every one has a link and most have a test, and neither needs the
 * lights — and the error says why the key lines are missing.
 */

import React from 'react';
import { buildIntegrationView } from './integrationView';
import { SERVICES, SERVICE_GROUPS } from './serviceRegistry';
import ServiceCard from './ServiceCard';
import SessionizeSetting, { useSpeakerId } from './SessionizeSetting';
import useSecretStatus from './useSecretStatus';
import { TabError, TabLoading } from './TabNotice';

/**
 * A filter, not a second tab widget: a group of toggle buttons (aria-pressed).
 * The hub's tab bar is the page's one tabs pattern.
 */
function GroupPicker({ groups, active, onChange }) {
  return (
    <div role="group" aria-label="Service groups" className="flex flex-wrap gap-2">
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          aria-pressed={active === group.id}
          onClick={() => onChange(group.id)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            active === group.id
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {group.title}
          <span className="ml-1.5 text-muted-foreground">{group.cards.length}</span>
        </button>
      ))}
    </div>
  );
}

function LooseKeysNote({ count, onOpenKeys }) {
  if (!count) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {count} more key{count === 1 ? '' : 's'} in this group belong to no single service.{' '}
      <button
        type="button"
        onClick={onOpenKeys}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        See them on the Keys tab
      </button>
      .
    </p>
  );
}

export default function IntegrationsServices({ group, onGroupChange, onOpenKeys, tests }) {
  const { data, loading, error, reload } = useSecretStatus();
  const { speakerId, setSpeakerId, loading: loadingSpeaker } = useSpeakerId();

  const { serviceGroups } = buildIntegrationView({
    services: SERVICES,
    groups: SERVICE_GROUPS,
    sections: data?.sections ?? [],
    secrets: data?.secrets ?? [],
  });
  // A group only counts if it has a card; loose keys alone live on Keys.
  const pickable = serviceGroups.filter((entry) => entry.cards.length > 0);
  const active = pickable.find((entry) => entry.id === group) ?? pickable[0];

  return (
    <div className="space-y-4">
      {loading && !data ? <TabLoading>Reading key status…</TabLoading> : null}
      <TabError
        message={error && `Key status could not be read, so the cards show no key lines: ${error}`}
        onRetry={reload}
      />

      <GroupPicker groups={pickable} active={active?.id} onChange={onGroupChange} />

      {active ? (
        <section className="space-y-3" aria-label={active.title}>
          <div>
            <h2 className="text-lg font-semibold">{active.title}</h2>
            <p className="text-sm text-muted-foreground">{active.blurb}</p>
          </div>
          {active.cards.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              result={tests.results[service.id]}
              testing={tests.testing.has(service.id)}
              onTest={() => tests.runTest(service, speakerId)}
            >
              {service.setting === 'sessionizeSpeakerId' ? (
                <SessionizeSetting
                  speakerId={speakerId}
                  setSpeakerId={setSpeakerId}
                  loading={loadingSpeaker}
                />
              ) : null}
            </ServiceCard>
          ))}
          <LooseKeysNote count={active.loose.length} onOpenKeys={onOpenKeys} />
        </section>
      ) : null}
    </div>
  );
}
