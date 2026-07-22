/**
 * Connections — unified status page for all 3rd-party integrations.
 *
 * One card per service with a Test Connection button where a server-side
 * test endpoint exists. Also owns editable integration settings (currently
 * the Sessionize speaker ID, stored in Firestore admin_settings/integrations).
 */

import React, { useEffect, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  Plug,
  Loader2,
  CheckCircle,
  AlertCircle,
  Share2,
  Radio,
  Mic,
  Award,
  Link2,
  Mail,
  Save,
} from 'lucide-react';

// lucide-react v1.x dropped brand icons — inline YouTube glyph (same as SocialHubPage).
const Youtube = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);
import { postJSON } from '@/lib/api';
import {
  getIntegrationSettings,
  saveIntegrationSettings,
  DEFAULT_SESSIONIZE_SPEAKER_ID,
} from '@/lib/adminSettings';

// ── Service test runners ──────────────────────────────────────────────────────
// Each returns a human-readable success string or throws.

async function testPubler() {
  const accounts = await postJSON('publerProxy', { path: '/accounts', method: 'GET' });
  const count = Array.isArray(accounts) ? accounts.length : 0;
  return `Connected — ${count} social account(s).`;
}

async function testPlaud() {
  // Same path the Recordings Hub uses — credentials stay server-side in mcpProxy.
  await postJSON('mcpProxy', {
    serverId: 'plaud',
    tool: 'list_files',
    arguments: { limit: 1 },
  });
  return 'Connected — Plaud MCP responded.';
}

async function testSessionize(speakerId) {
  const id = speakerId || DEFAULT_SESSIONIZE_SPEAKER_ID;
  const res = await fetch(`https://sessionize.com/api/speaker/json/${id}`);
  if (!res.ok) throw new Error(`Sessionize HTTP ${res.status}`);
  const data = await res.json();
  return `Connected — ${(data.events || []).length} event(s) for speaker ${id}.`;
}

async function testLinkie() {
  await postJSON('linkieProxy', { path: '/profiles', method: 'GET' });
  return 'Connected to the Linkie API.';
}

async function testKlaviyo() {
  const res = await postJSON('klaviyoProxy', { path: '/api/lists/', method: 'GET' });
  const count = Array.isArray(res?.data) ? res.data.length : 0;
  return `Connected — ${count} list(s) visible.`;
}

// ── Connection card ───────────────────────────────────────────────────────────

function ConnectionCard({ icon: Icon, name, description, manageHref, test, placeholder }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const message = await test();
      setResult({ ok: true, message });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{name}</p>
            {placeholder && (
              <Badge variant="outline" className="text-[10px]">
                Placeholder
              </Badge>
            )}
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
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          {result && (
            <p
              className={`flex items-start gap-1.5 text-xs mt-2 ${
                result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
              }`}
            >
              {result.ok ? (
                <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              )}
              <span className="min-w-0 break-words">{result.message}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {test ? (
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test Connection'}
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground">No test available</span>
          )}
          {manageHref && (
            <a
              href={manageHref}
              className="text-xs text-primary hover:underline"
              {...(manageHref.startsWith('http')
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
            >
              Open
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();
  const [speakerId, setSpeakerId] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    getIntegrationSettings({ force: true })
      .then((settings) => {
        if (!cancelled) {
          setSpeakerId(
            String(settings?.sessionizeSpeakerId || '').trim() || DEFAULT_SESSIONIZE_SPEAKER_ID
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await saveIntegrationSettings({ sessionizeSpeakerId: speakerId.trim() });
      toast({ title: 'Settings saved', description: 'Sessionize speaker ID updated.' });
    } catch (err) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingSettings(false);
    }
  };

  const services = [
    {
      icon: Share2,
      name: 'Publer',
      description: 'Social media scheduling (LinkedIn, X, Facebook, Instagram, YouTube).',
      manageHref: '/admin/social?tab=settings',
      test: testPubler,
    },
    {
      icon: Radio,
      name: 'Plaud',
      description: 'Voice recordings sync for the Recordings Hub.',
      manageHref: '/admin/recordings',
      test: testPlaud,
    },
    {
      icon: Mic,
      name: 'Sessionize',
      description: 'Speaking events feed for the Speaking Events page.',
      manageHref: '/admin/speaking-events',
      test: () => testSessionize(speakerId),
    },
    {
      icon: Award,
      name: 'Credly',
      description: 'Certification badges. Synced via badge image download — no test endpoint.',
      manageHref: '/admin/certifications',
      test: null,
    },
    {
      icon: Link2,
      name: 'Linkie',
      description: 'Link-in-bio management via the linkieProxy function.',
      manageHref: '/admin/linkie',
      test: testLinkie,
    },
    {
      icon: Mail,
      name: 'Klaviyo',
      description: 'Newsletter lists, subscribers, and campaigns via klaviyoProxy.',
      manageHref: '/admin/mailing-list',
      test: testKlaviyo,
    },
    {
      icon: Youtube,
      name: 'YouTube',
      description: 'Direct YouTube Data API integration is not wired up yet (posts go via Publer).',
      manageHref: null,
      test: null,
      placeholder: true,
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Plug className="h-6 w-6 text-muted-foreground" />
          Connections
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          One place to check every 3rd-party integration. API keys live in Google Secret Manager
          and are only used server-side.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {services.map((service) => (
          <ConnectionCard key={service.name} {...service} />
        ))}
      </div>

      {/* Integration settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integration Settings</CardTitle>
          <CardDescription>
            Stored in Firestore (admin_settings/integrations) — editable here instead of being
            hard-coded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-md">
            <Label className="text-xs">Sessionize Speaker ID</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={speakerId}
                disabled={loadingSettings}
                onChange={(e) => setSpeakerId(e.target.value)}
                placeholder={DEFAULT_SESSIONIZE_SPEAKER_ID}
              />
              <Button
                size="sm"
                onClick={handleSaveSettings}
                disabled={savingSettings || loadingSettings || !speakerId.trim()}
                className="gap-1.5 shrink-0"
              >
                {savingSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Used by the Speaking Events page to pull your sessions from
              sessionize.com/api/speaker/json/&lt;id&gt;. Falls back to{' '}
              <code>{DEFAULT_SESSIONIZE_SPEAKER_ID}</code> when unset.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
