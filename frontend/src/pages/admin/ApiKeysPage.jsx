/**
 * API Keys — seed and rotate every credential the estate declares.
 *
 * Rotating a key used to mean opening the production Key Vault's firewall to
 * your own IP, running a PowerShell script, and closing it again. The app is
 * already inside the vault's integration subnet, so it can do the write with
 * no network change at all — this page is that.
 *
 * ## What this page will not show you
 *
 * A value. Not masked, not the last four characters. The API has no read path
 * and the app's vault role has no `getSecret` action, so there is nothing here
 * to render even if someone tried. What you get is a light.
 *
 * ## Four lights, not three
 *
 * Gray, green and red were the ask. Amber exists because App Service caches
 * Key Vault references for up to 24 hours: for a little while after you paste,
 * the vault has the new value and the running worker does not. Showing green
 * there would claim a rotation had taken effect when it had not; showing gray
 * would say "never inserted" one second after inserting it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { KeyRound, Loader2, RefreshCw, ShieldCheck, Wand2 } from 'lucide-react';
import { getJSON, sendJSON } from '@/lib/api';

/**
 * How each state reads to someone scanning the page.
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
          placeholder={item.state === 'never' ? 'Paste key, press Enter' : 'Paste to rotate'}
          onChange={(event) => setValue(event.target.value)}
          className="w-full font-mono text-xs sm:w-64"
          aria-label={`New value for ${item.label}`}
        />
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

export default function ApiKeysPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busySecret, setBusySecret] = useState(null);
  const [error, setError] = useState(null);
  const { toast } = useToast();
  // Every route here is super_admin, so a fetch before the token exists is a
  // guaranteed 401 that renders as "could not load".
  const { authReady } = useAuthReady();

  const load = useCallback(async () => {
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
  }, []);

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

  const submit = useCallback(
    async (secret, payload) => {
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
    },
    [load, toast]
  );

  const grouped = useMemo(() => {
    if (!data?.sections) return [];
    return data.sections
      .map((section) => ({
        ...section,
        items: (data.secrets ?? []).filter((item) => item.section === section.id),
      }))
      .filter((section) => section.items.length > 0);
  }, [data]);

  const counts = useMemo(() => {
    const tally = { live: 0, pending: 0, failing: 0, never: 0 };
    for (const item of data?.secrets ?? []) tally[item.state] = (tally[item.state] ?? 0) + 1;
    return tally;
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading credential status…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <KeyRound className="h-6 w-6" /> API Keys
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Paste a key and press Enter. It goes straight to Key Vault — it is never stored in this
            site, never written to Terraform, and cannot be read back out here or anywhere else.
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

      {grouped.map((section) => (
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
                onSubmit={submit}
                busy={busySecret === item.secret}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Terraform declares which credentials exist and how the app finds them; Key Vault holds the
          values. This page only writes values, so nothing you paste here reaches Terraform state or
          a plan. Names come from <code>infra/main.tf</code> — to add a new one, add its reference
          there in the same change that teaches the code to read it.
        </span>
      </p>
    </div>
  );
}
