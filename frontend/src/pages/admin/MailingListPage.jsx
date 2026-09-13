/**
 * Mailing List — the weekly newsletter and its provider, Resend (ADR 0030).
 *
 * Resend replaced Klaviyo, which this page used to read through `klaviyoProxy`:
 * lists, profiles and campaigns, and nothing was ever written. The Newsletter
 * tab now builds weekly issues from what the site published, shows each email
 * exactly as it would send, lets a draft be edited or rejected, and schedules
 * it through Resend only when a publisher approves and confirms
 * (components/admin/newsletter). The subscriber list itself is managed in
 * Resend's Audience view.
 *
 * The test posts a NAME to `connectionProbe` and the server builds the call,
 * so `RESEND_API_KEY` never reaches the browser.
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import { Mail, Loader2, RefreshCw, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { postJSON } from '@/lib/api';
import { countList, unwrapProxy } from '@/lib/proxyEnvelope';
import NewsletterIssues from '@/components/admin/newsletter/NewsletterIssues';
import NewsletterSettingsCard from '@/components/admin/newsletter/NewsletterSettingsCard';

const TABS = [
  { id: 'newsletter', label: 'Newsletter' },
  { id: 'connection', label: 'Connection' },
];
const TAB_IDS = new Set(TABS.map((tab) => tab.id));

// ── Resend connection ─────────────────────────────────────────────────────────

/**
 * A human sentence for a working key, or a thrown Error with Resend's own.
 *
 * GET /domains on the server. A key minted with sending access only is refused
 * there, which is the failure worth catching before anything is built on it.
 */
export async function checkResend() {
  const body = unwrapProxy(await postJSON('connectionProbe', { probe: 'resend' }), 'Resend');
  const count = countList(body);
  if (count === null) return 'Connected to Resend.';
  return count === 0
    ? 'Connected, but no sending domain has been added to Resend yet.'
    : `Connected to Resend — ${count} sending domain(s).`;
}

// ── Newsletter Tab ────────────────────────────────────────────────────────────

function NewsletterTab() {
  // Bumped when settings save, so the open issue re-reads whether it can send.
  const [settingsVersion, setSettingsVersion] = useState(0);
  return (
    <div className="space-y-6">
      <NewsletterIssues settingsVersion={settingsVersion} />
      <NewsletterSettingsCard onSaved={() => setSettingsVersion((v) => v + 1)} />
    </div>
  );
}

// ── Connection Tab ────────────────────────────────────────────────────────────

function ConnectionTab({ onStatusChange }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult({ ok: true, message: await checkResend() });
      onStatusChange?.(true);
    } catch (err) {
      setResult({ ok: false, message: err.message });
      onStatusChange?.(false);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resend API Connection</CardTitle>
          <CardDescription>
            The Resend API key is stored in Azure Key Vault and used only on the server — it is
            never sent to the browser. It must be created with Full access; a key with Sending
            access only cannot manage the mailing list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/*
            THE BUTTON AND THE LINKS SHARE A FLEX ROW, because `space-y-4` on
            this CardContent cannot separate them: it sets margin-top on a
            following sibling, and inline-flex siblings land on one line.
            `flex-wrap` lets the links drop below the button on a narrow card.
            The result panel stays outside the row as its own block.
          */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button onClick={handleTest} disabled={testing} className="gap-2">
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Test Connection
            </Button>
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              API keys in Resend <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <a
              href="https://resend.com/domains"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              Sending domains <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          {result && (
            <div
              className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                result.ok
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'border-destructive/40 bg-destructive/10 text-destructive'
              }`}
            >
              {result.ok ? (
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <p>{result.message}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MailingListPage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  // A bookmark to a tab that no longer exists (`lists`, `campaigns`) lands on
  // the newsletter rather than on a blank page.
  const requested = searchParams.get('tab');
  const activeTab = TAB_IDS.has(requested) ? requested : 'newsletter';
  const [connected, setConnected] = useState('checking');

  useEffect(() => {
    if (!authReady) return;
    // The header dot uses the same check as Test Connection, so the two cannot
    // disagree. GET /domains spends nothing on either Resend meter.
    checkResend()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  }, [authReady]);

  const setTab = (id) => setSearchParams({ tab: id });

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Mail}
        title="Mailing List"
        service="Resend"
        connected={connected}
        description="Build, review and approve the weekly newsletter, sent through Resend."
        accent="violet"
      />

      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
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
        {activeTab === 'newsletter' && <NewsletterTab />}
        {activeTab === 'connection' && <ConnectionTab onStatusChange={setConnected} />}
      </div>
    </div>
  );
}
