/**
 * Identity tab — the Entra configuration the site runs on (#570).
 *
 * Exactly what the Integrations page showed before it had tabs: the Microsoft
 * Entra ID panel comparing this browser's build-time values with what
 * `getAuthExpectations` says the API enforces (#519). Nothing was added.
 *
 * OVERLAP WITH HEALTH, LEFT FOR #569 TO DECIDE. Health > Checks
 * (pages/admin/health/probes.jsx) also reads `getAuthExpectations`, but uses
 * it for a different job: it decodes the caller's own token and reports a
 * verdict per claim, plus the admin registry comparison. This tab shows the
 * configuration; Health checks a live token against it. The token claims and
 * the admin registry were deliberately NOT pulled in here.
 *
 * Loads on its own, with a generation guard so a late answer cannot land after
 * the tab closes and reopens. A refusal clears the values rather than
 * leaving the previous answer beside a banner saying the API did not answer —
 * the refusal is itself the audience-drift signal the panel exists to show.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { getJSON } from '@/lib/api';
import { EntraConfigurationCard } from './EntraConfigurationCard';
import { TabLoading } from './TabNotice';

export const AUTH_EXPECTATIONS_ROUTE = 'getAuthExpectations';

export default function IntegrationsIdentity() {
  const { authReady } = useAuthReady();
  const [expectations, setExpectations] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  useEffect(() => {
    if (!authReady) return undefined;
    const mine = ++generation.current;
    const current = () => mine === generation.current;
    getJSON(AUTH_EXPECTATIONS_ROUTE)
      .then((response) => {
        if (!current()) return;
        setExpectations(response);
        setError(null);
      })
      .catch((err) => {
        if (!current()) return;
        setExpectations(null);
        setError(err?.message ?? 'Could not read the API config.');
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [authReady]);

  return (
    <div className="space-y-4">
      {loading ? <TabLoading>Reading what the API enforces…</TabLoading> : null}
      <EntraConfigurationCard expectations={expectations} error={error} />
    </div>
  );
}
