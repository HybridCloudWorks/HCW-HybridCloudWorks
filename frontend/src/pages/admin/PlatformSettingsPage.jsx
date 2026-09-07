/**
 * Platform settings — three `admin_config` documents that used to need a
 * Cosmos data-plane role and a hand-typed JSON body (#351, #352, #348):
 *
 *   Default covers      admin_config/default_heroes   read by ai-cover.js
 *   Social autoposting  admin_config/social_autopost  read by social-caption-trigger.js
 *   Podcast feeds       admin_config/podcast_feeds    read by timers/podcasts.js
 *
 * Each card reads and writes ONE route, `cms/platform-settings/{setting}`,
 * and the server normalizes every save to exactly the shape its consumer
 * reads — so the document cannot drift from the code, which is the reason
 * this page exists rather than a runbook step. A document that was seeded by
 * hand and does not validate is shown empty with the server's reason, and
 * saving replaces it.
 *
 * Pickers are native `<select>` elements: they are keyboard-accessible, they
 * work in the test runner without pointer-event shims, and nothing here
 * needs a search box.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertTriangle,
  Images,
  Loader2,
  Plus,
  Podcast,
  Save,
  Share2,
  SlidersHorizontal,
  Trash2,
  Wand2,
} from 'lucide-react';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import {
  describePublerFailure,
  publerAccountsStatus,
  unwrapPublerAccounts,
} from '@/lib/publerAccounts';

// The same lists the server allowlists (functions/src/lib/platform-settings.js).
export const HERO_PROVIDERS = Object.freeze([
  'Azure',
  'AWS',
  'GCP',
  'GitHub',
  'Terraform',
  'Ansible',
  'VMware',
  'Multi',
]);
export const SOCIAL_PROVIDERS = Object.freeze([
  'linkedin',
  'twitter',
  'facebook',
  'instagram',
  'youtube',
]);
export const PODCAST_PROVIDERS = Object.freeze([
  'azure',
  'aws',
  'gcp',
  'github',
  'terraform',
  'finops',
  'vmware',
  'ansible',
]);

export const settingRoute = (name) => `cms/platform-settings/${name}`;

/** The covers shipped with the site under frontend/public/images/default-heroes/. */
export const bundledDefaultHeroes = () =>
  Object.fromEntries(
    HERO_PROVIDERS.map((provider) => [
      provider,
      `/images/default-heroes/${provider.toLowerCase()}.png`,
    ])
  );

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Mirrors the server's rule (functions/src/lib/platform-settings.js
 * isAcceptableHeroUrl): a same-origin path or an https URL, nothing
 * protocol-relative, and no query string or fragment — the value is copied
 * onto published content documents, so a token in a `?` would be published.
 * The preview loads only what the server would store.
 */
export function isAcceptableHeroUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 2048) return false;
  if (/[\s<>"'`\\?#]/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  return /^https:\/\/[^/]+/.test(value);
}

/**
 * Thumbnail for one cover. Rendered with `key={src}` by the caller, so a
 * changed value is a fresh instance: a URL that failed to load hides only
 * until the field changes, and a corrected one shows again.
 */
export function HeroPreview({ src, provider }) {
  const [failed, setFailed] = useState(false);
  if (!isAcceptableHeroUrl(src) || failed) return null;
  return (
    <img
      src={src}
      alt={`${provider} cover preview`}
      className="h-10 w-16 shrink-0 rounded border object-cover"
      onLoad={() => setFailed(false)}
      onError={() => setFailed(true)}
    />
  );
}

/** Publer reports a network name in its own casing; the trigger keys on lowercase. */
const providerOf = (account) => String(account?.provider || '').toLowerCase();

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

/**
 * One setting's load/save cycle. `value` is the working copy the card edits;
 * `meta` is what the server said about the stored document.
 */
export function useSetting(name, authReady) {
  const [value, setValue] = useState(null);
  const [meta, setMeta] = useState({ exists: false, stored: null, updatedAt: null, problem: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    getJSON(settingRoute(name))
      .then((response) => {
        if (cancelled) return;
        setValue(response.value);
        setMeta({
          exists: Boolean(response.exists),
          stored: response.stored ?? null,
          updatedAt: response.updatedAt ?? null,
          problem: response.problem ?? null,
        });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Could not load this setting.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, authReady]);

  const save = useCallback(
    async (next) => {
      setSaving(true);
      try {
        const response = await sendJSON(settingRoute(name), 'PUT', next);
        setValue(response.value);
        setMeta({
          exists: true,
          stored: 'valid',
          updatedAt: response.updatedAt ?? null,
          problem: null,
        });
        toast({ title: 'Saved', description: `${name} is stored.` });
        return true;
      } catch (err) {
        toast({
          title: 'Not saved',
          description: err?.message ?? 'The write was refused.',
          variant: 'destructive',
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [name, toast]
  );

  return { value, setValue, meta, loading, saving, error, save };
}

function StoredState({ meta }) {
  if (meta.stored === 'invalid') {
    return (
      <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span>
          The stored document does not match the shape the code reads
          {meta.problem ? ` (${meta.problem})` : ''}. What is shown is empty; saving replaces it.
        </span>
      </p>
    );
  }
  if (!meta.exists) {
    return <p className="text-xs text-muted-foreground">Not stored yet — the feature is off.</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      Stored{meta.updatedAt ? ` · updated ${relativeTime(meta.updatedAt)}` : ''}
    </p>
  );
}

/** Sits inside each card's form: the submit is the form's, so one click is one save. */
function SaveRow({ saving, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="mr-2 h-3.5 w-3.5" />
        )}
        Save
      </Button>
    </div>
  );
}

// ── Default covers ─────────────────────────────────────────────────────────

export function DefaultCoversCard({ value, onChange, onSave, saving, meta }) {
  const heroes = value?.heroes ?? {};
  const setHero = (provider, url) => onChange({ heroes: { ...heroes, [provider]: url } });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Images className="h-5 w-5" /> Default covers
        </CardTitle>
        <CardDescription>
          The cover a post gets when AI generation is off or fails, chosen by its cloud provider
          (Google Cloud maps to GCP; anything unmatched uses Multi). A same-origin path such as{' '}
          <code>/images/default-heroes/azure.png</code>, a gallery URL under{' '}
          <code>/api/public/media/…</code>, or an https URL. Blank means no default for that
          provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <StoredState meta={meta} />
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          {HERO_PROVIDERS.map((provider) => (
            <div key={provider} className="space-y-1">
              <Label htmlFor={`hero-${provider}`}>{provider}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`hero-${provider}`}
                  value={heroes[provider] ?? ''}
                  disabled={saving}
                  spellCheck={false}
                  placeholder={`/images/default-heroes/${provider.toLowerCase()}.png`}
                  onChange={(event) => setHero(provider, event.target.value)}
                  className="font-mono text-xs"
                />
                <HeroPreview
                  key={heroes[provider] ?? ''}
                  src={heroes[provider] ?? ''}
                  provider={provider}
                />
              </div>
            </div>
          ))}
          <div className="sm:col-span-2">
            <SaveRow saving={saving}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => onChange({ heroes: bundledDefaultHeroes() })}
                title="Fill every provider with the cover shipped under /images/default-heroes/"
              >
                <Wand2 className="mr-2 h-3.5 w-3.5" /> Use bundled defaults
              </Button>
            </SaveRow>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Social autoposting ─────────────────────────────────────────────────────

export function SocialAutopostCard({
  value,
  onChange,
  onSave,
  saving,
  meta,
  publerAccounts,
  publerStatus = 'ready',
  publerError = '',
}) {
  const enabled = Boolean(value?.enabled);
  const accountIds = useMemo(() => value?.accountIds ?? [], [value]);
  const delay = value?.scheduleDelayMinutes ?? 60;
  const [pick, setPick] = useState('');

  const update = (patch) =>
    onChange({ enabled, accountIds, scheduleDelayMinutes: delay, ...patch });
  const setAccount = (index, patch) =>
    update({
      accountIds: accountIds.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  const removeAccount = (index) =>
    update({ accountIds: accountIds.filter((_row, i) => i !== index) });
  const addAccount = (row) => update({ accountIds: [...accountIds, row] });

  // Accounts the Social Hub already lists, minus the ones already chosen, and
  // minus any on a network the trigger cannot post to. Those are counted, not
  // offered: quietly rewriting an unsupported provider to another network
  // would schedule the post somewhere the owner did not choose.
  const { pickable, unsupported } = useMemo(() => {
    const listed = (publerAccounts ?? []).filter(
      (account) => account?.id && !accountIds.some((row) => row.id === String(account.id))
    );
    const supported = (account) => SOCIAL_PROVIDERS.includes(providerOf(account));
    return {
      pickable: listed.filter(supported),
      unsupported: listed.filter((account) => !supported(account)),
    };
  }, [publerAccounts, accountIds]);

  const addPicked = () => {
    const account = pickable.find((candidate) => String(candidate.id) === pick);
    if (!account) return;
    addAccount({ id: String(account.id), provider: providerOf(account) });
    setPick('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Share2 className="h-5 w-5" /> Social autoposting
        </CardTitle>
        <CardDescription>
          On a live publish, a caption is generated and one post per account is scheduled in Publer
          after the delay — the undo window, during which the post can be cancelled from Publer or
          the Social Hub. Account ids are the ones the Social Hub shows; they are identifiers, not
          secrets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <StoredState meta={meta} />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <Switch
                id="autopost-enabled"
                checked={enabled}
                disabled={saving}
                onCheckedChange={(checked) => update({ enabled: checked })}
              />
              <Label htmlFor="autopost-enabled">Autoposting {enabled ? 'on' : 'off'}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="autopost-delay">Delay (minutes)</Label>
              <Input
                id="autopost-delay"
                type="number"
                min={1}
                max={10080}
                step={1}
                value={delay}
                disabled={saving}
                onChange={(event) => update({ scheduleDelayMinutes: event.target.value })}
                className="w-24"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Accounts</p>
            {accountIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No accounts yet. Autoposting cannot be turned on until one is added.
              </p>
            ) : null}
            {accountIds.map((row, index) => (
              <div key={`${row.id}-${index}`} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={`Account id ${index + 1}`}
                  value={row.id}
                  disabled={saving}
                  spellCheck={false}
                  placeholder="Publer account id"
                  onChange={(event) => setAccount(index, { id: event.target.value })}
                  className="w-full font-mono text-xs sm:w-72"
                />
                <select
                  aria-label={`Provider ${index + 1}`}
                  className={`${SELECT_CLASS} w-40`}
                  value={row.provider}
                  disabled={saving}
                  onChange={(event) => setAccount(index, { provider: event.target.value })}
                >
                  {SOCIAL_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  aria-label={`Remove account ${index + 1}`}
                  onClick={() => removeAccount(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              {pickable.length > 0 ? (
                <>
                  <select
                    aria-label="Publer account to add"
                    className={`${SELECT_CLASS} w-full sm:w-80`}
                    value={pick}
                    disabled={saving}
                    onChange={(event) => setPick(event.target.value)}
                  >
                    <option value="">Pick a Publer account…</option>
                    {pickable.map((account) => (
                      <option key={account.id} value={String(account.id)}>
                        {account.name || account.id} · {account.provider || 'unknown'}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving || !pick}
                    onClick={addPicked}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" /> Add from Publer
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => addAccount({ id: '', provider: 'linkedin' })}
              >
                <Plus className="mr-2 h-3.5 w-3.5" /> Add account by id
              </Button>
            </div>
            {publerStatus === 'not_configured' ? (
              <p className="text-xs text-muted-foreground">
                Publer not configured — connect it in the Social Hub&apos;s Connection Settings tab
                to pick accounts here; until then, add them by id.
              </p>
            ) : null}
            {publerStatus === 'error' ? (
              <p className="text-xs text-destructive">
                Publer accounts could not be loaded — {publerError || 'the call failed'}. The picker
                is empty because the call did not succeed, not because the workspace is; add
                accounts by id, or fix the connection in the Social Hub.
              </p>
            ) : null}
            {unsupported.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {unsupported.length} Publer account{unsupported.length === 1 ? '' : 's'} hidden:
                autoposting supports {SOCIAL_PROVIDERS.join(', ')} only.
              </p>
            ) : null}
          </div>

          <SaveRow saving={saving} />
        </form>
      </CardContent>
    </Card>
  );
}

// ── Podcast feeds ──────────────────────────────────────────────────────────

export function PodcastFeedsCard({ value, onChange, onSave, saving, meta }) {
  const feeds = useMemo(() => value?.feeds ?? [], [value]);
  // The fixed rows first, then any provider the document carries beyond them.
  const providers = useMemo(() => {
    const extra = feeds
      .map((row) => row.provider)
      .filter((provider) => provider && !PODCAST_PROVIDERS.includes(provider));
    return [...PODCAST_PROVIDERS, ...new Set(extra)];
  }, [feeds]);
  // Spread the current value rather than rebuilding it: the main feed and the
  // provider rows are edited by different controls and neither may drop the
  // other's field on the way to the save.
  const update = (patch) => onChange({ ...(value ?? {}), ...patch });
  const urlFor = (provider) => feeds.find((row) => row.provider === provider)?.url ?? '';
  const setUrl = (provider, url) => {
    const present = feeds.some((row) => row.provider === provider);
    update({
      feeds: present
        ? feeds.map((row) => (row.provider === provider ? { provider, url } : row))
        : [...feeds, { provider, url }],
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Podcast className="h-5 w-5" /> Podcast feeds
        </CardTitle>
        <CardDescription>
          The main feed is the site&apos;s own show. Its episodes appear on every provider&apos;s
          audio page, at the top, and its RSS button is what a reader gets on a provider with no
          feed of its own. The per-provider feeds below are optional extras for a show that belongs
          to one provider. All are fetched every two hours, all must be https; blank means no feed.
          A feed that answers 410 Gone is reported in Ops Health and should be replaced or blanked
          here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <StoredState meta={meta} />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <Label htmlFor="feed-main" className="text-sm font-semibold">
              Main feed
            </Label>
            <Input
              id="feed-main"
              type="text"
              inputMode="url"
              value={value?.mainFeedUrl ?? ''}
              disabled={saving}
              spellCheck={false}
              placeholder="https://media.rss.com/…/feed.xml"
              onChange={(event) => update({ mainFeedUrl: event.target.value })}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              The site&apos;s show — not any one provider&apos;s.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Per-provider feeds (optional)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((provider) => (
                <div key={provider} className="space-y-1">
                  <Label htmlFor={`feed-${provider}`}>{provider}</Label>
                  <Input
                    id={`feed-${provider}`}
                    type="text"
                    inputMode="url"
                    value={urlFor(provider)}
                    disabled={saving}
                    spellCheck={false}
                    placeholder="https://…/feed.xml"
                    onChange={(event) => setUrl(provider, event.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <SaveRow saving={saving} />
        </form>
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

function SettingSection({ setting, render }) {
  if (setting.loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (setting.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {setting.error}
      </div>
    );
  }
  return render(setting);
}

export default function PlatformSettingsPage() {
  const { authReady } = useAuthReady();
  const heroes = useSetting('default-heroes', authReady);
  const autopost = useSetting('social-autopost', authReady);
  const podcasts = useSetting('podcast-feeds', authReady);
  const [publerAccounts, setPublerAccounts] = useState([]);
  // 'loading' | 'ready' | 'not_configured' | 'error' — the card says which.
  const [publerStatus, setPublerStatus] = useState('loading');
  const [publerError, setPublerError] = useState('');

  // Best effort: the same proxied call the Social Hub makes, unwrapped from
  // the proxy envelope. Not configured, or any failure, means the free-text
  // id field is the whole picker.
  //
  // The proxy answers HTTP 200 whatever happens, so Publer refusing the key
  // resolves rather than rejects; without `failed` it would land in the `ready`
  // branch and read as a workspace with no accounts.
  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    postJSON('publerProxy', { path: '/accounts', method: 'GET' })
      .then((response) => {
        if (cancelled) return;
        const unwrapped = unwrapPublerAccounts(response);
        setPublerAccounts(unwrapped.accounts);
        setPublerStatus(publerAccountsStatus(unwrapped));
        setPublerError(unwrapped.failed ? describePublerFailure(unwrapped) : '');
      })
      .catch((err) => {
        if (cancelled) return;
        setPublerAccounts([]);
        setPublerStatus('error');
        setPublerError(err?.message || 'the request failed');
      });
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <SlidersHorizontal className="h-6 w-6" /> Platform settings
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Documents the pipeline reads on every run. Each save is checked against the exact shape
          the code expects before it is stored, and replaces the document whole.
        </p>
      </div>

      <SettingSection
        setting={heroes}
        render={(s) => (
          <DefaultCoversCard
            value={s.value}
            meta={s.meta}
            saving={s.saving}
            onChange={s.setValue}
            onSave={() => s.save(s.value)}
          />
        )}
      />

      <SettingSection
        setting={autopost}
        render={(s) => (
          <SocialAutopostCard
            value={s.value}
            meta={s.meta}
            saving={s.saving}
            publerAccounts={publerAccounts}
            publerStatus={publerStatus}
            publerError={publerError}
            onChange={s.setValue}
            onSave={() => s.save(s.value)}
          />
        )}
      />

      <SettingSection
        setting={podcasts}
        render={(s) => (
          <PodcastFeedsCard
            value={s.value}
            meta={s.meta}
            saving={s.saving}
            onChange={s.setValue}
            onSave={() => s.save(s.value)}
          />
        )}
      />
    </div>
  );
}
