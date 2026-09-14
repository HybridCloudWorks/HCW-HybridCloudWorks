/**
 * The Sessionize speaker id, on the Sessionize card (moved from
 * IntegrationsPage, #570). The one service configured rather than
 * credentialed, so its setting IS its connection.
 *
 * Loads and saves itself. Race-safety: a generation guard on the load, so a
 * late answer cannot land after unmount; and an in-flight ref on the save, so
 * a double click sends one PUT.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Save } from 'lucide-react';
import {
  getIntegrationSettings,
  saveIntegrationSettings,
  DEFAULT_SESSIONIZE_SPEAKER_ID,
} from '@/lib/adminSettings';

/** The speaker id to show and test with, loaded once auth is ready. */
export function useSpeakerId() {
  const { authReady } = useAuthReady();
  const [speakerId, setSpeakerId] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  useEffect(() => {
    if (!authReady) return undefined;
    const mine = ++generation.current;
    // getIntegrationSettings never throws: an unreadable document reads as
    // empty, which falls back to the default id, as it always has.
    getIntegrationSettings({ force: true })
      .then((settings) => {
        if (mine !== generation.current) return;
        setSpeakerId(
          String(settings?.sessionizeSpeakerId || '').trim() || DEFAULT_SESSIONIZE_SPEAKER_ID
        );
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [authReady]);

  return { speakerId, setSpeakerId, loading };
}

export default function SessionizeSetting({ speakerId, setSpeakerId, loading }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const onSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveIntegrationSettings({ sessionizeSpeakerId: speakerId.trim() });
      toast({ title: 'Settings saved', description: 'Sessionize speaker ID updated.' });
    } catch (err) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

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
        Stored in Cosmos DB (admin_settings/integrations) and used by the test button above and by
        the Speaking Events page. Falls back to <code>{DEFAULT_SESSIONIZE_SPEAKER_ID}</code> when
        unset.
      </p>
    </div>
  );
}
