/**
 * useServiceCards — every service with its key lights attached and the
 * result that stands for it (this session's test, else the persisted
 * verdict). The Overview and the Directory both start from exactly this,
 * which is why it is one hook rather than two copies (review of #922).
 */
import { useEffect } from 'react';
import { buildIntegrationView } from './integrationView';
import { persistedVerdict } from './integrationStatus';
import { SERVICES } from './serviceRegistry';
import useSecretStatus from './useSecretStatus';

/**
 * This session's result, else the persisted record's latest verdict, as the
 * `{ ok, message, at }` the status sort reads.
 */
export function effectiveResult(result, record) {
  if (result) return result;
  const verdict = persistedVerdict(record);
  return verdict
    ? { ok: verdict.ok, message: verdict.message, at: verdict.at, recorded: true }
    : undefined;
}

export default function useServiceCards(tests) {
  const { data, loading, error, reload } = useSecretStatus();
  const { ensurePersisted } = tests;
  useEffect(() => {
    ensurePersisted?.();
  }, [ensurePersisted]);

  const { serviceCards } = buildIntegrationView({
    services: SERVICES,
    sections: data?.sections ?? [],
    secrets: data?.secrets ?? [],
  });
  const results = Object.fromEntries(
    serviceCards.map((card) => [
      card.id,
      effectiveResult(tests.results?.[card.id], tests.persisted?.[card.id]),
    ])
  );
  return { serviceCards, results, data, loading, error, reload };
}
