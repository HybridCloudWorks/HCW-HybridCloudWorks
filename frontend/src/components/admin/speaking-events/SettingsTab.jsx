/**
 * Settings (#573): everything set once — the Sessionize profile the hub reads,
 * and the rules that decide what the public page shows.
 *
 * THE SPEAKER ID IS SHOWN HERE, NOT EDITED HERE, ON PURPOSE. It has one write
 * path: the Sessionize card on the Integrations Hub (SessionizeSetting.jsx),
 * which is also where its connection test lives, because for Sessionize the
 * setting IS the connection (#570). A second editor here would be a second
 * save of the same `admin_settings/integrations` field with its own in-flight
 * guard and its own idea of the current value. So this tab reads the value
 * through the same hook that card uses (`useSpeakerId`, generation-guarded)
 * and links to the card to change or test it.
 */

import React from 'react';
import { Link } from 'react-router';
import { Card, CardContent } from '@/components/ui/card';
import { ExternalLink } from 'lucide-react';
import { useSpeakerId } from '@/components/admin/integrations/SessionizeSetting';
import { tabHref as integrationsTabHref } from '@/components/admin/integrations/tabs';
import { TabLoading } from '@/components/admin/integrations/TabNotice';
import { sessionizeUrl } from './eventModel';

export const SESSIONIZE_CARD_HREF = `${integrationsTabHref('services')}&group=content`;

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
            Only rows with <strong>Show on site</strong> ticked are published; a row without the
            flag is withheld.
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
    </div>
  );
}
