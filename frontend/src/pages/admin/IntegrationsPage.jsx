/**
 * Integrations Hub (route `/admin/integrations`) — every third-party service,
 * whether it answers, and the keys it answers with.
 *
 * It replaced two pages about one subject from opposite ends: Connections
 * could tell you Publer was refusing calls, API Keys could rotate
 * `PUBLER-API-KEY`, and neither could do the other. Until #570 the merged page
 * was one long scroll. It now has a tab per duty, at the Newsletter Hub's
 * standard (components/admin/integrations):
 *
 *   Overview  every service on one grid, broken and not-configured first, with
 *             Test all (one service at a time) and when each was last tested
 *   Services  one group at a time; each card has its test, its docs link and
 *             the names and lights of the keys it uses
 *   Keys      every Key Vault credential: its light, the services that use
 *             it, paste and generate, and "Other credentials"
 *   Identity  the Entra configuration the browser and the API run on
 *
 * Deep links are `?tab=` (and `?group=` on Services); an unknown or moved tab
 * id lands where its content went, and `/admin/connections` and
 * `/admin/api-keys` redirect to Overview and Keys (tabs.js).
 *
 * Each tab loads its own data, with its own loading and error states, so one
 * refused request never blanks another tab or the tab bar. Only the session's
 * test results live here, on the page, so they survive switching tabs.
 *
 * No tab shows a credential value, masked or otherwise: the API has no read
 * path for one and the app's vault role cannot read one.
 *
 * NO ACTIVITY TAB, ON PURPOSE. Key writes record only the latest
 * `lastWriteAt`/`lastWriteBy` per key (shown on each Keys row); nothing writes
 * an audit row for a key change and there is no admin route that reads
 * `admin_audit_logs`. A history tab needs that backend first — see #570.
 */

import React from 'react';
import { useSearchParams } from 'react-router';
import { Plug } from 'lucide-react';
import IntegrationsOverview from '@/components/admin/integrations/IntegrationsOverview';
import IntegrationsServices from '@/components/admin/integrations/IntegrationsServices';
import IntegrationsKeys from '@/components/admin/integrations/IntegrationsKeys';
import IntegrationsIdentity from '@/components/admin/integrations/IntegrationsIdentity';
import useServiceTests from '@/components/admin/integrations/useServiceTests';
import { TABS, resolveTab } from '@/components/admin/integrations/tabs';

export default function IntegrationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));
  const tests = useServiceTests();

  const setTab = (id) => setSearchParams({ tab: id });
  const openGroup = (group) => setSearchParams({ tab: 'services', group });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Plug className="h-6 w-6" /> Integrations Hub
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every third-party service, whether it is answering, and the keys it answers with. Keys are
          held in Azure Key Vault and can be written here but never read back.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Integrations Hub"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setTab(id)}
            className={`-mb-px whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'overview' && <IntegrationsOverview tests={tests} onOpenGroup={openGroup} />}
        {activeTab === 'services' && (
          <IntegrationsServices
            group={searchParams.get('group')}
            onGroupChange={openGroup}
            onOpenKeys={() => setTab('keys')}
            tests={tests}
          />
        )}
        {activeTab === 'keys' && <IntegrationsKeys />}
        {activeTab === 'identity' && <IntegrationsIdentity />}
      </div>
    </div>
  );
}
