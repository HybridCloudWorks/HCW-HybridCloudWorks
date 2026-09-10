/**
 * Integrations — every third-party service, its live status, and its keys.
 *
 * This replaces two pages that were about the same subject from opposite ends.
 * Connections could tell you Klaviyo was refusing calls; API Keys could rotate
 * `KLAVIYO-PRIVATE-KEY`. Neither could do the other, so the fix for a dead
 * integration was two pages and a guess about whether they were talking about
 * the same thing. Here a service is one card: what it says about itself, the
 * button that asks it, and the credential rows you would change in response.
 *
 * ## Why services first and credentials second
 *
 * Not every credential belongs to a service you can call — the AI provider
 * keys, the cloud price-list keys and the site's own signing secrets have no
 * "test" that means anything from a browser. And not every service has a
 * credential in the vault: Plaud's tokens live on its `mcp_servers/plaud`
 * document, and Sessionize is a public feed keyed by a speaker id. So the page
 * leads with the services, each carrying whatever it actually has, and then
 * lists the credentials no service claimed, in the catalogue's own sections.
 *
 * ## What this page will not show you
 *
 * A credential value. Not masked, not the last four characters. The API has no
 * read path and the app's vault role has no `getSecret` action, so there is
 * nothing here to render even if someone tried. What you get is a light.
 *
 * ## Four lights, not three
 *
 * Gray, green and red were the ask. Amber exists because App Service caches
 * Key Vault references for up to 24 hours: for a little while after you paste,
 * the vault has the new value and the running worker does not. Showing green
 * there would claim a rotation had taken effect when it had not; showing gray
 * would say "never inserted" one second after inserting it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertCircle,
  Award,
  CheckCircle,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Mic,
  Plug,
  Radio,
  RefreshCw,
  Save,
  Share2,
  ShieldCheck,
  Wand2,
} from 'lucide-react';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import {
  getIntegrationSettings,
  saveIntegrationSettings,
  DEFAULT_SESSIONIZE_SPEAKER_ID,
} from '@/lib/adminSettings';

// lucide-react v1.x dropped brand icons — inline YouTube glyph (same as SocialHubPage).
const Youtube = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

// ── Service test runners ──────────────────────────────────────────────────────
// Each returns a human-readable success string or throws.

async function testPubler() {
  const accounts = await postJSON('publerProxy', { path: '/accounts', method: 'GET' });
  const count = Array.isArray(accounts) ? accounts.length : 0;
  return `Connected — ${count} social account(s).`;
}

async function testPlaud() {
  // Same path the Recording Hub's Plaud tab uses — credentials stay server-side in mcpProxy.
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

// ── The service registry ──────────────────────────────────────────────────────

/**
 * Every third-party service, and the Key Vault secrets that belong to it.
 *
 * `secrets` names entries in `functions/src/lib/secret-catalog.js`. A name that
 * is not in the catalogue simply renders nothing — the catalogue is the source
 * of truth for what exists, and `secret-catalog.test.js` already holds it
 * against `infra/main.tf`. An empty list is a real answer, not an omission:
 * Plaud and Sessionize genuinely have no vault secret, and each says why.
 */
export const SERVICES = Object.freeze([
  {
    id: 'publer',
    icon: Share2,
    name: 'Publer',
    description: 'Social media scheduling (LinkedIn, X, Facebook, Instagram, YouTube).',
    manageHref: '/admin/social?tab=settings',
    test: testPubler,
    secrets: ['PUBLER-API-KEY', 'PUBLER-WORKSPACE-ID'],
  },
  {
    id: 'plaud',
    icon: Radio,
    name: 'Plaud',
    description: 'Voice recordings sync for the Recording Hub’s Plaud tab.',
    manageHref: '/admin/recording-hub',
    test: testPlaud,
    secrets: [],
    // Not an omission: the OAuth pair lives on the mcp_servers/plaud document
    // and refreshPlaudToken rotates it every 12 hours. There is no vault
    // secret to paste, and a row here would imply there was one.
    credentialNote:
      'No Key Vault secret for the MCP. The OAuth token pair lives on the mcp_servers/plaud document and refreshes every 12 hours — reconnect from the Recording Hub → Plaud tab → Connect. Plaud Embedded (audio upload transcription) is a separate pair, PLAUD-EMBEDDED-CLIENT-ID / PLAUD-EMBEDDED-API-KEY, seeded on the API Keys page.',
  },
  {
    id: 'sessionize',
    icon: Mic,
    name: 'Sessionize',
    description: 'Speaking events feed for the Speaking Events page.',
    manageHref: '/admin/speaking-events',
    test: (speakerId) => testSessionize(speakerId),
    secrets: [],
    // The one service configured rather than credentialed. Its setting is
    // rendered on this card because the setting IS its connection.
    setting: 'sessionizeSpeakerId',
  },
  {
    id: 'credly',
    icon: Award,
    name: 'Credly',
    description: 'Certification badges, synced by downloading the badge images.',
    manageHref: '/admin/certifications',
    test: null,
    secrets: [],
    credentialNote: 'A public badge feed — no credential and no test endpoint.',
  },
  {
    id: 'linkie',
    icon: Link2,
    name: 'Linkie',
    description: 'Link-in-bio management via the linkieProxy function.',
    manageHref: '/admin/linkie',
    test: testLinkie,
    secrets: ['LINKIE-API-KEY'],
  },
  {
    id: 'klaviyo',
    icon: Mail,
    name: 'Klaviyo',
    description: 'Newsletter lists, subscribers, and campaigns via klaviyoProxy.',
    manageHref: '/admin/mailing-list',
    test: testKlaviyo,
    secrets: ['KLAVIYO-PRIVATE-KEY', 'KLAVIYO-LIST-ID'],
  },
  {
    id: 'youtube',
    icon: Youtube,
    name: 'YouTube',
    // This card used to read "not wired up yet" behind a Placeholder badge.
    // It is wired up: lib/listen-and-learn/videos.js calls the Data API v3
    // with YOUTUBE_API_KEY to pick the "watch next" videos beside every
    // episode. Posting is what goes through Publer, and that is a different
    // API from the one this key opens.
    description:
      'Data API v3 search for the “watch next” links beside Listen & Learn episodes. Posting to YouTube goes through Publer.',
    manageHref: '/admin/listen-and-learn',
    test: null,
    secrets: ['YOUTUBE-API-KEY'],
  },
]);

// ── Presentation ──────────────────────────────────────────────────────────────

/**
 * How each credential state reads to someone scanning the page.
 *
 * `tone` drives the dot; `label` is the words. Both matter — a colour alone is
 * no use to anyone reading this without colour vision, and the dot carries a
 * title attribute for the same reason.
 */
export const STATE_PRESENTATION = Object.freeze({
  live: {
    tone: 'bg-emerald-500',
    ring: 'ring-emerald-500/30',
    label: 'Live',
    hint: 'Resolved and working.',
  },
  pending: {
    tone: 'bg-amber-500',
    ring: 'ring-amber-500/30',
    label: 'Stored — going live',
    hint: 'In the vault. This worker still holds the previous value until it recycles.',
  },
  failing: {
    tone: 'bg-red-500',
    ring: 'ring-red-500/30',
    label: 'Rejected',
    hint: 'A real value is configured and the upstream service refused it.',
  },
  never: {
    tone: 'bg-slate-400',
    ring: 'ring-slate-400/20',
    label: 'Not set',
    hint: 'Never seeded, or the Key Vault reference is not resolving.',
  },
});

const relativeTime = (iso) => {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
};

export function StateDot({ state }) {
  const presentation = STATE_PRESENTATION[state] ?? STATE_PRESENTATION.never;
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${presentation.tone} ${presentation.ring}`}
      role="img"
      aria-label={presentation.label}
      title={`${presentation.label} — ${presentation.hint}`}
    />
  );
}

/** One credential: its light, its name, and somewhere to paste a new value. */
export function SecretRow({ item, onSubmit, busy }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const presentation = STATE_PRESENTATION[item.state] ?? STATE_PRESENTATION.never;

  const submit = async (payload) => {
    const ok = await onSubmit(item.secret, payload);
    // Clear on success only. On a rejection the operator usually wants to see
    // what they pasted — minus the value never having been rendered back, this
    // is their own input in their own field.
    if (ok) {
      setValue('');
      inputRef.current?.blur();
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-1.5">
          <StateDot state={item.state} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{item.label}</span>
            <code className="text-xs text-muted-foreground">{item.secret}</code>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.help}</p>
          <p className="mt-1 text-xs">
            <span className="font-medium">{presentation.label}</span>
            {item.lastWriteAt ? (
              <span className="text-muted-foreground">
                {' '}
                · updated {relativeTime(item.lastWriteAt)}
              </span>
            ) : null}
            {item.state === 'failing' && item.lastFailStatus ? (
              <span className="text-muted-foreground"> · HTTP {item.lastFailStatus}</span>
            ) : null}
            {item.state === 'failing' && item.lastFailDetail ? (
              // The provider's own words. `HTTP 401` alone sent two days into
              // reminting a key that a sentence would have exonerated or
              // condemned outright (#463 item 4, #358).
              <span className="text-muted-foreground"> — {item.lastFailDetail}</span>
            ) : null}
            {!item.hasLivenessCheck && item.state === 'live' ? (
              // Otherwise green would imply "verified", which for these means
              // only "the reference resolved to something".
              <span className="text-muted-foreground"> · no liveness check for this one</span>
            ) : null}
          </p>
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ value });
        }}
      >
        <Input
          ref={inputRef}
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          placeholder={item.state === 'never' ? 'Paste key' : 'Paste to rotate'}
          onChange={(event) => setValue(event.target.value)}
          className="w-full font-mono text-xs sm:w-64"
          aria-label={`New value for ${item.label}`}
        />
        {/*
          A REAL SUBMIT BUTTON, because Enter is not a control on a phone.
          This form had none: the only way to store a pasted value was to press
          Enter in the field, and the placeholder only said so on a row that
          had never been set — a rotation just read "Paste to rotate". On a
          mobile keyboard the return key is not reliably a form submit, so
          pasting a value and finding no way to save it is the whole
          interaction. Reported from a phone while trying to correct
          PUBLER-WORKSPACE-ID, which is not `generatable` and so had no button
          of any kind beside it.

          Disabled until there is something to send, so it cannot fire an empty
          write, and it carries the same spinner the rest of the page uses.
        */}
        <Button
          type="submit"
          size="sm"
          disabled={busy || !value.trim()}
          title={`Save this value to ${item.secret}`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">Save</span>
        </Button>
        {item.generatable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => submit({ generate: true })}
            title="Generate a random value — this one is invented here, not issued by anyone"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </form>
    </div>
  );
}

// ── Joining the two halves ────────────────────────────────────────────────────

/**
 * Give every credential to the service that owns it, and keep the rest.
 *
 * Pure, so the join can be tested without a network or a DOM. A secret named
 * by a service but absent from the API response is skipped rather than
 * rendered as an empty row — the catalogue can grow a name this page has not
 * been taught yet, and the honest rendering of that is nothing.
 *
 * @param {{ services?: ReadonlyArray<object>, sections?: ReadonlyArray<object>, secrets?: ReadonlyArray<object> }} input
 * @returns {{ serviceCards: Array<object>, otherSections: Array<object> }}
 */
export function buildIntegrationView({ services = SERVICES, sections = [], secrets = [] } = {}) {
  const bySecretName = new Map((secrets ?? []).map((item) => [item.secret, item]));
  const claimed = new Set();

  const serviceCards = services.map((service) => {
    const items = (service.secrets ?? [])
      .map((name) => {
        const item = bySecretName.get(name);
        if (item) claimed.add(name);
        return item;
      })
      .filter(Boolean);
    return { ...service, items };
  });

  const otherSections = (sections ?? [])
    .map((section) => ({
      ...section,
      items: (secrets ?? []).filter(
        (item) => item.section === section.id && !claimed.has(item.secret)
      ),
    }))
    // A section whose every secret was claimed by a service above would
    // otherwise render as a heading with nothing under it.
    .filter((section) => section.items.length > 0);

  return { serviceCards, otherSections };
}

// ── Service card ──────────────────────────────────────────────────────────────

function ServiceCard({ service, speakerId, onSubmitSecret, busySecret }) {
  const Icon = service.icon;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const message = await service.test(speakerId);
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
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{service.name}</p>
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
          <p className="mt-0.5 text-xs text-muted-foreground">{service.description}</p>
          {result && (
            <p
              className={`mt-2 flex items-start gap-1.5 text-xs ${
                result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
              }`}
            >
              {result.ok ? (
                <CheckCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 break-words">{result.message}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {service.test ? (
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test Connection'}
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground">No test available</span>
          )}
          {service.manageHref && (
            <a
              href={service.manageHref}
              className="text-xs text-primary hover:underline"
              {...(service.manageHref.startsWith('http')
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
            >
              Open
            </a>
          )}
        </div>
      </div>

      {service.items.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-1">
          {service.items.map((item) => (
            <SecretRow
              key={item.secret}
              item={item}
              onSubmit={onSubmitSecret}
              busy={busySecret === item.secret}
            />
          ))}
        </div>
      )}

      {service.credentialNote && (
        <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {service.credentialNote}
        </p>
      )}
    </Card>
  );
}

/**
 * Sessionize's speaker id, on Sessionize's card.
 *
 * It used to sit in an "Integration Settings" card at the bottom of a
 * different page, three scroll-lengths from the Test Connection button that
 * uses it. It is the only thing that decides which speaker the test reads.
 */
function SessionizeSetting({ speakerId, setSpeakerId, loading, saving, onSave }) {
  return (
    <div className="mt-3 max-w-md border-t border-border/60 pt-3">
      <Label className="text-xs" htmlFor="sessionize-speaker-id">
        Sessionize Speaker ID
      </Label>
      <div className="mt-1 flex gap-2">
        <Input
          id="sessionize-speaker-id"
          value={speakerId}
          disabled={loading}
          onChange={(e) => setSpeakerId(e.target.value)}
          placeholder={DEFAULT_SESSIONIZE_SPEAKER_ID}
        />
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || loading || !speakerId.trim()}
          className="shrink-0 gap-1.5"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Stored in Cosmos DB (admin_settings/integrations) and used by the Test Connection button
        above and by the Speaking Events page. Falls back to{' '}
        <code>{DEFAULT_SESSIONIZE_SPEAKER_ID}</code> when unset.
      </p>
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  // Every cms/secrets route is super_admin, so a fetch before the token exists
  // is a guaranteed 401 that renders as "could not load".
  const { authReady } = useAuthReady();
  const { toast } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busySecret, setBusySecret] = useState(null);
  const [error, setError] = useState(null);

  const [speakerId, setSpeakerId] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = async () => {
    try {
      const response = await getJSON('cms/secrets');
      setData(response);
      setError(null);
      return response;
    } catch (err) {
      setError(err?.message ?? 'Could not load credential status.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await getJSON('cms/secrets');
        if (!cancelled) {
          setData(response);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message ?? 'Could not load credential status.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return undefined;
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

  const submitSecret = async (secret, payload) => {
    setBusySecret(secret);
    try {
      const response = await sendJSON('cms/secrets', 'PUT', { secret, ...payload });
      toast({ title: `${secret} stored`, description: response?.message });
      await load();
      return true;
    } catch (err) {
      toast({
        title: `${secret} was not stored`,
        description: err?.message ?? 'The write was refused.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setBusySecret(null);
    }
  };

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

  const { serviceCards, otherSections } = buildIntegrationView({
    services: SERVICES,
    sections: data?.sections ?? [],
    secrets: data?.secrets ?? [],
  });

  const counts = { live: 0, pending: 0, failing: 0, never: 0 };
  for (const item of data?.secrets ?? []) counts[item.state] = (counts[item.state] ?? 0) + 1;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading integration status…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Plug className="h-6 w-6" /> Integrations
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every third-party service, whether it is answering, and the keys it answers with. Paste
            a key and press Enter — it goes straight to Key Vault, is never stored in this site,
            never written to Terraform, and cannot be read back out here or anywhere else.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <StateDot state="live" /> {counts.live} live
        </span>
        <span className="flex items-center gap-2">
          <StateDot state="pending" /> {counts.pending} going live
        </span>
        <span className="flex items-center gap-2">
          <StateDot state="failing" /> {counts.failing} rejected
        </span>
        <span className="flex items-center gap-2">
          <StateDot state="never" /> {counts.never} not set
        </span>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {error}
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Services</h2>
          <p className="text-sm text-muted-foreground">
            Test the connection, then rotate the credential it uses without leaving the card.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {serviceCards.map((service) => (
            <div key={service.id}>
              <ServiceCard
                service={service}
                speakerId={speakerId}
                onSubmitSecret={submitSecret}
                busySecret={busySecret}
              />
              {service.setting === 'sessionizeSpeakerId' ? (
                <div className="-mt-px rounded-b-lg border border-t-0 px-4 pb-4">
                  <SessionizeSetting
                    speakerId={speakerId}
                    setSpeakerId={setSpeakerId}
                    loading={loadingSettings}
                    saving={savingSettings}
                    onSave={handleSaveSettings}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {otherSections.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Other credentials</h2>
            <p className="text-sm text-muted-foreground">
              Keys with no service card of their own — nothing here has a connection test that would
              mean anything from a browser.
            </p>
          </div>
          {otherSections.map((section) => (
            <Card key={section.id}>
              <CardHeader>
                <CardTitle className="text-lg">{section.title}</CardTitle>
                <CardDescription>{section.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {section.items.map((item) => (
                  <SecretRow
                    key={item.secret}
                    item={item}
                    onSubmit={submitSecret}
                    busy={busySecret === item.secret}
                  />
                ))}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Terraform declares which credentials exist and how the app finds them; Key Vault holds the
          values. This page only writes values, so nothing you paste here reaches Terraform state or
          a plan. Names come from <code>infra/main.tf</code> — to add a new one, add its reference
          there in the same change that teaches the code to read it.
        </span>
      </p>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          A credential showing <strong>Not set</strong> is either one nobody has seeded or one whose
          Key Vault reference is not resolving — the two are indistinguishable from inside the
          worker, which is why they share a light.
        </span>
      </p>
    </div>
  );
}
