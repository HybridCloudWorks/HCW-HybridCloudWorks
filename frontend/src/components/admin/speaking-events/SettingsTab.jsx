/**
 * Settings (#573, ADR 0033 Spotlight slice): everything set once — the
 * Sessionize profile the hub reads, the speaker profile the public page
 * shows, and the rules that decide what the public page shows.
 *
 * THE SPEAKER ID IS SHOWN HERE, NOT EDITED HERE, ON PURPOSE. It has one write
 * path: the Sessionize card on the Integrations Hub (SessionizeSetting.jsx),
 * which is also where its connection test lives, because for Sessionize the
 * setting IS the connection (#570). A second editor here would be a second
 * save of the same `admin_settings/integrations` field with its own in-flight
 * guard and its own idea of the current value. So this tab reads the value
 * through the same hook that card uses (`useSpeakerId`, generation-guarded)
 * and links to the card to change or test it.
 *
 * THE SPEAKER PROFILE IS EDITED HERE. Bio, headshot and links live beside the
 * speaker id on `admin_settings/integrations` as `speakerProfile`; a publish
 * copies both into the public snapshot's `meta`, which is where the public
 * widget reads its speaker id from — never a hard-coded one.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { ExternalLink, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { getIntegrationSettings, saveIntegrationSettings } from '@/lib/adminSettings';
import { useSpeakerId } from '@/components/admin/integrations/SessionizeSetting';
import { tabHref as integrationsTabHref } from '@/components/admin/integrations/tabs';
import { TabLoading } from '@/components/admin/integrations/TabNotice';
import { sessionizeUrl } from './eventModel';

export const SESSIONIZE_CARD_HREF = `${integrationsTabHref('services')}&group=content`;

const INPUT = 'w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background';
const EMPTY_PROFILE = Object.freeze({ name: '', bio: '', headshotUrl: '', links: [] });

/** The stored profile as the form holds it; unknown shapes read as empty. */
export function profileForm(stored) {
  const profile = stored && typeof stored === 'object' ? stored : {};
  return {
    name: profile.name || '',
    bio: profile.bio || '',
    headshotUrl: profile.headshotUrl || '',
    links: Array.isArray(profile.links)
      ? profile.links.map((l) => ({ label: l?.label || '', url: l?.url || '' }))
      : [],
  };
}

/** What a save writes: trimmed, links without an http(s) URL dropped. */
export function profilePayload(form) {
  return {
    name: form.name.trim(),
    bio: form.bio.trim(),
    headshotUrl: form.headshotUrl.trim(),
    links: form.links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => /^https?:\/\//i.test(l.url))
      .map((l) => ({ label: l.label || l.url, url: l.url })),
  };
}

function SpeakerProfile() {
  const { speakerId, loading } = useSpeakerId();
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <h3 className="font-semibold text-sm">Sessionize profile</h3>
        {loading ? (
          <TabLoading>Loading the speaker ID…</TabLoading>
        ) : (
          <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Speaker ID</dt>
            <dd>
              <code>{speakerId}</code>
            </dd>
            <dt className="text-muted-foreground">Read from</dt>
            <dd className="break-all">
              <code>{sessionizeUrl(speakerId)}</code>
            </dd>
          </dl>
        )}
        <p className="text-sm">
          Change or test it on the{' '}
          <Link to={SESSIONIZE_CARD_HREF} className="underline">
            Sessionize card in the Integrations Hub
          </Link>
          , the one place it is saved.{' '}
          <a
            href="https://sessionize.com/app/speaker"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            Open Sessionize <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

function PublicProfileCard() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!authReady) return undefined;
    const mine = ++generation.current;
    getIntegrationSettings({ force: true })
      .then((settings) => {
        if (mine === generation.current) setForm(profileForm(settings?.speakerProfile));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [authReady]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const setLink = (index, key, value) =>
    setForm((f) => ({
      ...f,
      links: f.links.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
    }));

  const save = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveIntegrationSettings({ speakerProfile: profilePayload(form) });
      toast({
        title: 'Speaker profile saved',
        description: 'Publish a snapshot to make it public.',
      });
    } catch (err) {
      toast({ title: 'Save failed', description: err?.message, variant: 'destructive' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Card className="md:col-span-2">
      <CardContent className="pt-5 space-y-3">
        <h3 className="font-semibold text-sm">Speaker profile</h3>
        <p className="text-sm text-muted-foreground">
          Reused by every event: the bio, headshot and links the public speaking section shows and
          the Ambassador hub quotes in applications. Saved beside the speaker ID; a publish copies
          it into the public snapshot.
        </p>
        {loading ? (
          <TabLoading>Loading the speaker profile…</TabLoading>
        ) : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={save} aria-label="Speaker profile">
            <div className="space-y-1">
              <label
                htmlFor="speaker-profile-name"
                className="text-xs font-medium text-muted-foreground"
              >
                Display name
              </label>
              <input
                id="speaker-profile-name"
                className={INPUT}
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="speaker-profile-headshot"
                className="text-xs font-medium text-muted-foreground"
              >
                Headshot URL
              </label>
              <input
                id="speaker-profile-headshot"
                type="url"
                className={INPUT}
                placeholder="https://..."
                value={form.headshotUrl}
                onChange={(e) => set('headshotUrl')(e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label
                htmlFor="speaker-profile-bio"
                className="text-xs font-medium text-muted-foreground"
              >
                Bio
              </label>
              <textarea
                id="speaker-profile-bio"
                rows={4}
                className={`${INPUT} resize-none`}
                value={form.bio}
                onChange={(e) => set('bio')(e.target.value)}
              />
            </div>
            <fieldset className="md:col-span-2 space-y-2 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Links</legend>
              {form.links.length === 0 && (
                <p className="text-xs text-muted-foreground">None yet.</p>
              )}
              {form.links.map((link, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[1fr_2fr_auto] items-end">
                  <div className="space-y-1">
                    <label
                      htmlFor={`speaker-link-${index}-label`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Label
                    </label>
                    <input
                      id={`speaker-link-${index}-label`}
                      className={INPUT}
                      value={link.label}
                      onChange={(e) => setLink(index, 'label', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`speaker-link-${index}-url`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      URL
                    </label>
                    <input
                      id={`speaker-link-${index}-url`}
                      type="url"
                      className={INPUT}
                      placeholder="https://..."
                      value={link.url}
                      onChange={(e) => setLink(index, 'url', e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-destructive"
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() => set('links')(form.links.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set('links')([...form.links, { label: '', url: '' }])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add link
              </Button>
            </fieldset>
            <div className="md:col-span-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save profile
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DisplayRules() {
  return (
    <Card>
      <CardContent className="pt-5 space-y-2 text-sm">
        <h3 className="font-semibold">Display rules for the public page</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Sessionize is fetched live — ID, name, and date are always taken from the API and saved
            through the Azure API when you click Save.
          </li>
          <li>
            Any field you leave blank on an override falls back to the Sessionize value on the
            public site.
          </li>
          <li>
            Only rows with <strong>Show on site</strong> ticked are published. Unticking it on a
            Sessionize event hides that event publicly too; a manual entry without the flag is
            withheld.
          </li>
          <li>
            Dates are calendar days: an event on the 14th shows as the 14th in every time zone.
          </li>
          <li>Visitors see changes after the next publish, from the Publishing tab.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

export default function SettingsTab() {
  return (
    <div className="grid gap-4 pt-4 md:grid-cols-2">
      <SpeakerProfile />
      <DisplayRules />
      <PublicProfileCard />
    </div>
  );
}
