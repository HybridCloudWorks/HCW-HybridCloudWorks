/**
 * Mailing List — the weekly newsletter and its provider, Resend (ADR 0030).
 *
 * Resend replaced Klaviyo, which this page used to read through `klaviyoProxy`:
 * lists, profiles and campaigns, and nothing was ever written. What remains
 * here is what worked — drafting the weekly digest — and a connection test for
 * the Resend key. The subscriber list returns once the signup form writes to
 * Resend; until then there is no list to show, and an empty table would read as
 * "nobody subscribed" rather than "nothing collects subscribers yet".
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
import {
  Mail,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Megaphone,
  Eye,
  PenTool,
} from 'lucide-react';
import { postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';
import { countList, unwrapProxy } from '@/lib/proxyEnvelope';

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

// ── Weekly digest (a platform job, T-322) ───────────────────────────────────
// Site-Main called generateWeeklyDigest over HTTP with a 20 s client abort the
// 300 s handler never met. Here the drafting runs as the
// `generate-weekly-digest` job and the page polls; dryRun returns the preview
// without saving to `newsletters`.
const runWeeklyDigest = async (dryRun) => {
  const job = await runJob('generate-weekly-digest', { dryRun, days: 7 });
  if (job.status !== 'succeeded') {
    throw new Error(job.error || `Digest ${job.status}`);
  }
  return job.result || {};
};

// ── Newsletter Tab ────────────────────────────────────────────────────────────

function NewsletterTab() {
  const [drafting, setDrafting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [digestNotice, setDigestNotice] = useState(null);
  const [preview, setPreview] = useState(null);

  const handleDraftWeeklyDigest = async () => {
    setDrafting(true);
    setDigestNotice(null);
    try {
      const res = await runWeeklyDigest(false);
      setDigestNotice({
        ok: res.success === true,
        message: res.success
          ? `Weekly digest drafted from ${res.sourceItemsCount} item(s). Draft id: ${res.draftId}`
          : res.message || 'No action taken.',
      });
    } catch (err) {
      setDigestNotice({ ok: false, message: err.message });
    } finally {
      setDrafting(false);
    }
  };

  const handlePreviewDigest = async () => {
    setPreviewing(true);
    setDigestNotice(null);
    try {
      const res = await runWeeklyDigest(true);
      if (res.success) {
        setPreview(res);
      } else {
        setDigestNotice({ ok: false, message: res.message || 'No content to preview.' });
      }
    } catch (err) {
      setDigestNotice({ ok: false, message: err.message });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Megaphone className="h-4 w-4" /> Weekly digest
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreviewDigest}
            disabled={previewing || drafting}
            className="gap-1.5 h-7"
          >
            {previewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            Preview Digest
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDraftWeeklyDigest}
            disabled={drafting || previewing}
            className="gap-1.5 h-7"
          >
            {drafting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PenTool className="h-3.5 w-3.5" />
            )}
            Draft Weekly Digest
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Drafts a newsletter from the last seven days of published content. Drafts are saved on the
        site; sending them through Resend is not switched on yet.
      </p>
      {digestNotice && (
        <p
          className={`text-sm flex items-center gap-2 ${digestNotice.ok ? 'text-emerald-600' : 'text-destructive'}`}
        >
          {digestNotice.ok ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {digestNotice.message}
        </p>
      )}
      {preview && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{preview.title}</p>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setPreview(null)}>
              Close
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Preview only, nothing saved. {preview.sourceItemsCount} source item(s).
          </p>
          <pre className="text-xs whitespace-pre-wrap max-h-96 overflow-auto rounded-md bg-muted p-3">
            {preview.content}
          </pre>
        </Card>
      )}
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
        description="The weekly newsletter, and the Resend account that will hold the list and send it."
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
