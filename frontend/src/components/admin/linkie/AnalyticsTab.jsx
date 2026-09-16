/**
 * Analytics — the traffic Linkie reports for the profile (#577).
 *
 * Read-only, and its own read: a failed stats call must not take the Links tab
 * with it, and the two are asked of different Linkie endpoints anyway.
 */
import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, BarChart3, Loader2 } from 'lucide-react';
import {
  describeLinkieFailure,
  extractTrafficStats,
  trafficStatCards,
  unwrapLinkie,
} from '@/lib/linkie';
import { ltGetTrafficStats } from './linkieApi';

export default function AnalyticsTab({ profileId, profileNotice }) {
  const [reloadToken, setReloadToken] = useState(0);
  // Same shape as the Links tab, for the same reason: loading is derived from
  // the settled request's key, never set synchronously in the effect body.
  const [result, setResult] = useState({ key: '', analytics: null, error: '' });

  useEffect(() => {
    if (!profileId) return undefined;
    let cancelled = false;
    const key = `${profileId}#${reloadToken}`;
    // Linkie's analytics endpoint takes a `link_in_bio_id`. The profile's own
    // `_id` is what Site-Main sends for it, and is the closest identifier this
    // API exposes — see the note in the PR: it is the one shape here that
    // repository evidence does not fully settle.
    ltGetTrafficStats(profileId)
      .then((response) => {
        if (cancelled) return;
        const unwrapped = unwrapLinkie(response);
        if (unwrapped.notConfigured || unwrapped.failed) {
          const reason = unwrapped.notConfigured
            ? unwrapped.reason
            : describeLinkieFailure(unwrapped);
          setResult({ key, analytics: null, error: reason });
          return;
        }
        // The whole envelope is kept, not just the body: the "Raw analytics
        // response" panel is the operator's only view of what Linkie actually
        // sent, and the upstream status belongs in it.
        setResult({ key, analytics: response, error: '' });
      })
      .catch((err) => {
        if (!cancelled) setResult({ key, analytics: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, reloadToken]);

  const requestKey = profileId ? `${profileId}#${reloadToken}` : '';
  const loading = Boolean(profileId) && result.key !== requestKey;
  const analytics = loading ? null : result.analytics;
  const error = loading ? '' : result.error;

  if (!profileId) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{profileNotice || 'No Linkie profile selected — check the Connection tab.'}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setReloadToken((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  const stats = trafficStatCards(extractTrafficStats(analytics));

  return (
    <div className="space-y-4 max-w-3xl">
      {stats.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map(({ label, value }) => (
            <Card key={label} className="p-4 text-center">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <BarChart3 className="h-6 w-6 mx-auto mb-2 opacity-60" />
          Analytics connected, but no summary metrics were returned.
        </Card>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Raw analytics response</summary>
        <pre className="mt-2 p-3 rounded-lg bg-muted overflow-auto max-h-80">
          {JSON.stringify(analytics, null, 2)}
        </pre>
      </details>
    </div>
  );
}
