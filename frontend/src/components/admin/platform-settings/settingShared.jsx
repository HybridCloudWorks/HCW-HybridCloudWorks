/**
 * What every Platform Settings Hub tab shares: the allowlists the server
 * enforces, the one route shape, and the load/save cycle of one setting.
 *
 * Each setting is one `admin_config` document behind
 * `cms/platform-settings/{setting}`, and the server normalizes every save to
 * exactly the shape its consumer reads (functions/src/lib/platform-settings.js).
 *
 * Race-safety, as hardened for the Newsletter Hub in #555:
 *
 *   - each load carries a generation number and only the latest may write
 *     state, so a slow first load cannot land over a retry, and an unmounted
 *     tab's load writes nothing;
 *   - a save is guarded by a ref as well as the disabled button, so a double
 *     submit sends one PUT;
 *   - a failed load clears what the card held and hides the form, so a
 *     stale or empty working copy can never be saved over the real document.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, Loader2, RefreshCw, Save } from 'lucide-react';
import { getJSON, sendJSON } from '@/lib/api';

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

/** Every setting the server's registry names, as a person reads it. */
export const SETTING_LABELS = Object.freeze({
  'default-heroes': 'Default covers',
  'social-autopost': 'Social autoposting',
  'podcast-feeds': 'Podcast feeds',
  'listen-and-learn-speech': 'Listen & Learn voice',
  'newsletter-settings': 'Newsletter settings',
});

export const settingRoute = (name) => `cms/platform-settings/${name}`;

export const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const relativeTime = (iso) => {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
};

const EMPTY_META = Object.freeze({ exists: false, stored: null, updatedAt: null, problem: null });

const metaOf = (response) => ({
  exists: Boolean(response?.exists),
  stored: response?.stored ?? null,
  updatedAt: response?.updatedAt ?? null,
  problem: response?.problem ?? null,
});

/**
 * One setting's load/save cycle. `value` is the working copy the card edits;
 * `meta` is what the server said about the stored document; `options` is
 * what the server offers to choose from, where a setting is a choice.
 */
export function useSetting(name, authReady) {
  const [value, setValue] = useState(null);
  const [meta, setMeta] = useState(EMPTY_META);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!authReady) return undefined;
    const mine = ++generation.current;
    const current = () => mine === generation.current;
    getJSON(settingRoute(name))
      .then((response) => {
        if (!current()) return;
        setValue(response?.value ?? null);
        setMeta(metaOf(response));
        setOptions(Array.isArray(response?.options) ? response.options : []);
        setError(null);
      })
      .catch((err) => {
        if (!current()) return;
        // Nothing from a previous load survives a failed one.
        setValue(null);
        setMeta(EMPTY_META);
        setOptions([]);
        setError(err?.message ?? 'Could not load this setting.');
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      // Unmounting or a newer attempt: this load may no longer write state.
      if (current()) generation.current += 1;
    };
  }, [name, authReady, attempt]);

  const reload = useCallback(() => {
    // Supersede any load still in flight at once, not on the next effect run:
    // until the effect re-runs, an older answer would still count as current.
    generation.current += 1;
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const save = useCallback(
    async (next) => {
      if (savingRef.current) return false;
      savingRef.current = true;
      setSaving(true);
      try {
        const response = await sendJSON(settingRoute(name), 'PUT', next);
        setValue(response.value);
        setMeta({ ...metaOf(response), exists: true, stored: 'valid', problem: null });
        if (Array.isArray(response.options)) setOptions(response.options);
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
        savingRef.current = false;
        setSaving(false);
      }
    },
    [name, toast]
  );

  return { value, setValue, meta, options, loading, saving, error, save, reload };
}

export function StoredState({ meta }) {
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
export function SaveRow({ saving, children }) {
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

/**
 * A setting's loading, failed or loaded state. A failure names the setting,
 * says what the server said and offers a retry; the card is not rendered, so
 * nothing can be saved from a form that never received the stored document.
 */
export function SettingSection({ setting, label, render }) {
  if (setting.loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading {label ?? 'setting'}…
      </div>
    );
  }
  if (setting.error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
      >
        <span>
          {label ? `${label}: ` : ''}
          {setting.error}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={setting.reload}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }
  return render(setting);
}
