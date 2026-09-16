/**
 * Settings — the connection, and where the things set once are set (#575).
 *
 * The connected profiles moved to the Accounts tab; what stays here is the one
 * question an operator asks of this tab: can the proxy use its credentials? The
 * accounts call answers it, which is why this tab still makes it.
 *
 * It cannot answer any other way. FINDING-04 moved the key into Key Vault and
 * the proxy never returns it, so the accounts call is the only evidence this
 * page has. The card used to claim otherwise by calling `publerKey()` and
 * `publerWsId()`, which are defined nowhere in the bundle — reaching this tab
 * threw a ReferenceError before it could render (found while fixing #397).
 */
import React from 'react';
import { Link } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExternalLink } from 'lucide-react';
import usePublerAccounts from './usePublerAccounts';
import { tabHref } from './tabs';

const PUBLER_CONNECTION = {
  loading: { dot: 'bg-muted-foreground/40', detail: 'Checking…' },
  ready: {
    dot: 'bg-emerald-500',
    detail: 'Connected — the proxy resolved its credentials and Publer answered.',
  },
  not_configured: {
    // One code covers a missing key and a missing workspace id, so the tile
    // names neither; the notice below reports whichever the server named.
    dot: 'bg-amber-500',
    detail: 'Not configured — a required app setting is missing.',
  },
  error: { dot: 'bg-destructive', detail: 'The accounts call failed' },
};

export default function SettingsTab() {
  const { status, error, reason } = usePublerAccounts();
  const connection = PUBLER_CONNECTION[status] ?? PUBLER_CONNECTION.loading;

  return (
    <div className="max-w-2xl space-y-6">
      {/* API Connection status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publer API Connection</CardTitle>
          <CardDescription>
            The API key and workspace id live in Key Vault and are injected by the publerProxy
            function; the browser never sees them, so this card reports whether the proxy could use
            them rather than what they are.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <div className={`h-2.5 w-2.5 rounded-full ${connection.dot}`} />
            <div>
              <p className="text-xs font-semibold">Credentials</p>
              <p className="text-xs text-muted-foreground">
                {connection.detail}
                {status === 'error' ? ` — ${error || 'no reason given'}.` : ''}
                {status === 'not_configured' && reason ? ` ${reason}.` : ''}
              </p>
            </div>
          </div>

          <a
            href="https://app.publer.com/#/settings/access"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Manage API Keys in Publer <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>

      {/* Where the rest of it is set */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where the rest is set</CardTitle>
          <CardDescription>
            Nothing on this tab is stored by the hub. The credentials are function-app settings, and
            the profiles a post can reach are a Publer workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            <strong className="text-foreground">Credentials</strong> — PUBLER_API_KEY and
            PUBLER_WORKSPACE_ID on the function app, as Key Vault references. Seed them on the{' '}
            <Link to="/admin/integrations" className="text-primary hover:underline">
              Integrations page
            </Link>
            .
          </p>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Connected profiles</strong> — the{' '}
            <Link to={tabHref('accounts')} className="text-primary hover:underline">
              Accounts tab
            </Link>
            , which reads them from the Publer workspace.
          </p>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Scheduling defaults</strong> — Publer&apos;s own
            workspace settings. This hub sends an explicit time, or none at all for an immediate
            post, and never a default of its own.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
