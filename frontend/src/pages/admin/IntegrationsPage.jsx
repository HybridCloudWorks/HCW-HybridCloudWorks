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
  BookOpen,
  CheckCircle,
  Cloud,
  FlaskConical,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Mic,
  Plug,
  Radio,
  RefreshCw,
  Rss,
  Save,
  Send,
  Share2,
  ShieldCheck,
  Wand2,
} from 'lucide-react';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import { countList, unwrapProxy } from '@/lib/proxyEnvelope';
import { extractProfiles } from '@/lib/linkie';
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

// EVERY ONE OF THESE MUST READ `ok`. The three REST proxies answer HTTP 200
// for every outcome, so `authedFetch` does not throw and a refused credential
// arrives as a resolved envelope. `testPubler` used to read
// `Array.isArray(accounts)` on that envelope — an object, never an array — so
// it computed zero and said "Connected — 0 social account(s)" for a 403.
// The button reported Connected while the timer beside it had been failing for
// hours. `unwrapProxy` throws instead, with the upstream's own sentence.

async function testPubler() {
  const body = unwrapProxy(
    await postJSON('publerProxy', { path: '/accounts', method: 'GET' }),
    'Publer'
  );
  const count = countList(body, 'accounts');
  return count === null ? 'Connected to Publer.' : `Connected — ${count} social account(s).`;
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
  const res = await postJSON('linkieProxy', { path: '/profiles', method: 'GET' });
  // `unwrapProxy` for the verdict, `extractProfiles` for the count. Linkie
  // answers `{ data: { profiles: [...] } }` and `lib/linkie.js` already knows
  // that - counting it again here would be the second copy that drifts.
  unwrapProxy(res, 'Linkie');
  const profiles = extractProfiles(res);
  return `Connected — ${profiles.length} profile(s).`;
}

async function testKlaviyo() {
  // Doubly wrong before: `res.data` is the ENVELOPE's data, which is Klaviyo's
  // whole body `{ data: [...] }` rather than the array, so the count was zero
  // even on a genuine success.
  const body = unwrapProxy(
    await postJSON('klaviyoProxy', { path: '/api/lists/', method: 'GET' }),
    'Klaviyo'
  );
  const count = countList(body);
  return count === null ? 'Connected to Klaviyo.' : `Connected — ${count} list(s) visible.`;
}

// The three whose credentials never reach a browser (#483). Each posts a NAME
// to `connectionProbe`, which builds the whole outbound call server-side; none
// of them names a URL, a path or a method, because the caller supplying one is
// the confused deputy `rest-proxy.js` spends its header on. The envelope is the
// proxies' own, so `unwrapProxy` reads a refusal here exactly as it does there.

async function testTelegram() {
  const body = unwrapProxy(await postJSON('connectionProbe', { probe: 'telegram' }), 'Telegram');
  // getMe answers `{ ok, result: { username, ... } }`. The username is the
  // useful half: it says WHICH bot the token belongs to, which is the question
  // an operator holding two tokens actually has.
  const username = body?.result?.username;
  return username ? `Connected — @${username}.` : 'Connected to Telegram.';
}

async function testRssCom() {
  const body = unwrapProxy(await postJSON('connectionProbe', { probe: 'rsscom' }), 'RSS.com');
  const count = countList(body, 'podcasts');
  return count === null ? 'Connected to RSS.com.' : `Connected — ${count} show(s) visible.`;
}

async function testYouTube() {
  unwrapProxy(await postJSON('connectionProbe', { probe: 'youtube' }), 'YouTube');
  // No count: the probe asks for one result and discards it, so any number
  // here would describe the probe rather than the account. The quota cost is
  // said out loud because pressing this button spends it — about 100 of the
  // 10,000 units a day that Listen & Learn draws on for real episodes.
  return 'Connected — the Data API answered. This check costs ~100 of 10,000 daily quota units.';
}

// ── Groups and services ───────────────────────────────────────────────────────

/**
 * The groups everything on this page is sorted into — services AND the
 * credentials underneath them.
 *
 * ONE TAXONOMY, not two. The page used to show a flat list of service cards
 * and then a separate "Other credentials" bucket organised on different lines,
 * so Publer’s card and Publer’s keys could sit under different words. These
 * ids match `SECRET_SECTIONS` in `functions/src/lib/secret-catalog.js`, which
 * is what lets a group show its services and its loose keys together.
 *
 * `education` is the one id with no secrets behind it — those services are
 * public profiles with nothing to store — and the catalogue deliberately does
 * not declare it, because a section there with no secrets renders as an empty
 * heading and its own test refuses that.
 */
export const SERVICE_GROUPS = Object.freeze([
  {
    id: 'communication',
    title: 'Communication',
    blurb: 'Anything that speaks to an audience \u2014 posts, newsletters, links and alerts.',
  },
  {
    id: 'content',
    title: 'Content',
    blurb: 'Where episodes, videos and recordings are published and read from.',
  },
  {
    id: 'education',
    title: 'Education',
    blurb: 'The public profiles behind the certifications and Learn pages. Nothing to store here.',
  },
  {
    id: 'gen-ai',
    title: 'Gen AI',
    blurb:
      'Language models. The site tries them in order when something needs writing. Each row says what it is used for.',
  },
  {
    id: 'ai-services',
    title: 'AI services',
    blurb:
      'Called for one job each — narration, cover images, and reading a web page well enough to summarise it.',
  },
  {
    id: 'cloud',
    title: 'Cloud',
    blurb: 'Public price lists for the cost comparison tools. None of these bills this site.',
  },
  {
    id: 'platform',
    title: 'Site platform',
    blurb: 'Values the site runs on. Each one says what changing it breaks.',
  },
]);

/**
 * Every service, and the credentials that belong to it.
 *
 * `secrets` names entries in the catalogue. A name that is not there renders
 * nothing — the catalogue is the source of truth for what exists.
 *
 * THREE FIELDS DRIVE THE CARD, and each may be absent for a reason:
 *
 *   `url`   Where this service lives, as specifically as possible: the page
 *           that holds the credential when there is one, and the owner’s own
 *           profile when there is not. EVERY service has one, and a test says
 *           so — a card with no key, no test and no link is a dead end.
 *   `test`  A GET that proves the credential works, or `null` where a browser
 *           cannot make one. `null` is honest rather than lazy: the education
 *           profiles are public HTML that a browser cannot fetch from another
 *           origin, and the YouTube, RSS.com and Telegram keys are only ever
 *           read on the server, so there is nothing here that could call them.
 *
 *           NO BEAKER MEANS THE GLOBE HAS TO WORK HARDER. When a service holds
 *           credentials and offers no test, the only thing this page can do
 *           about a red light is send you where the credential is managed — so
 *           `url` must be that page, not the vendor’s front door. `t.me/BotFather`,
 *           `dashboard.rss.com/api-access/`, the Google credentials console.
 *           A test below holds it: such a service must point at a specific
 *           page rather than a bare host.
 *   `group` Which heading it sits under.
 *
 * DESCRIPTIONS ARE FOR SOMEONE WHO HAS NEVER SEEN THIS REPOSITORY. One line,
 * saying what the service is and what it does for the site. No issue numbers,
 * no function names, no file paths.
 */
export const SERVICES = Object.freeze([
  // ── Communication ────────────────────────────────────────────────────────
  {
    id: 'publer',
    group: 'communication',
    icon: Share2,
    name: 'Publer',
    description: 'Schedules and publishes posts to LinkedIn, X, Facebook, Instagram and YouTube.',
    url: 'https://app.publer.com/#/settings/access',
    test: testPubler,
    secrets: ['PUBLER-API-KEY', 'PUBLER-WORKSPACE-ID'],
  },
  {
    id: 'klaviyo',
    group: 'communication',
    icon: Mail,
    name: 'Klaviyo',
    description: 'Holds the newsletter list and sends the campaigns.',
    url: 'https://www.klaviyo.com/settings/account/api-keys',
    test: testKlaviyo,
    secrets: ['KLAVIYO-PRIVATE-KEY', 'KLAVIYO-LIST-ID'],
  },
  {
    id: 'linkie',
    group: 'communication',
    icon: Link2,
    name: 'Linkie',
    description: 'The link-in-bio page and the links on it.',
    url: 'https://app.linkie.bio',
    test: testLinkie,
    secrets: ['LINKIE-API-KEY'],
  },
  {
    id: 'telegram',
    group: 'communication',
    icon: Send,
    name: 'Telegram',
    description: 'Sends the approve-or-reject message when new content is ready.',
    // Where the token is minted and re-minted.
    url: 'https://t.me/BotFather',
    // getMe runs on the SERVER (#483), which is how the token is tested
    // without ever reaching a browser. It judges the token alone — getMe does
    // not read the chat id, so a green light here says nothing about it.
    test: testTelegram,
    secrets: ['TELEGRAM-BOT-TOKEN', 'TELEGRAM-CHAT-ID'],
  },

  // ── Content ──────────────────────────────────────────────────────────────
  {
    id: 'rsscom',
    group: 'content',
    icon: Rss,
    name: 'RSS.com',
    description: 'Hosts the podcast and receives approved episodes.',
    // Where the key is minted, not the dashboard front door. The card gained a
    // beaker in #483 and the globe still points here, because the page a red
    // light sends you to is worth keeping either way.
    url: 'https://dashboard.rss.com/api-access/',
    // Server-side (#483): GET /v4/podcasts, the same call that discovers the
    // show id, so the test works before RSSCOM-PODCAST-ID is seeded.
    test: testRssCom,
    secrets: ['RSSCOM-API-KEY', 'RSSCOM-PODCAST-ID'],
  },
  {
    id: 'youtube',
    group: 'content',
    icon: Youtube,
    name: 'YouTube',
    description:
      'Finds the \u201cwatch next\u201d videos shown beside each Listen & Learn episode.',
    url: 'https://console.cloud.google.com/apis/credentials',
    // Server-side (#483). COSTS ~100 OF 10,000 DAILY QUOTA UNITS per press,
    // because the Data API prices search.list per call — so this is a button
    // and must never become an automatic check.
    test: testYouTube,
    secrets: ['YOUTUBE-API-KEY'],
  },
  {
    id: 'plaud',
    group: 'content',
    icon: Radio,
    name: 'Plaud',
    description: 'Voice recorder. Its recordings become podcast episodes.',
    url: 'https://app.plaud.ai',
    test: testPlaud,
    secrets: ['PLAUD-EMBEDDED-CLIENT-ID', 'PLAUD-EMBEDDED-API-KEY'],
    credentialNote:
      'Reading recordings from the recorder uses a separate sign-in that renews itself every 12 hours \u2014 reconnect from Recording Hub \u2192 Plaud \u2192 Connect. The two values above are only for turning uploaded audio into text.',
  },
  {
    id: 'sessionize',
    group: 'content',
    icon: Mic,
    name: 'Sessionize',
    description: 'The list of speaking events behind the Speaking Events page.',
    url: 'https://sessionize.com/app/speaker',
    test: (speakerId) => testSessionize(speakerId),
    secrets: [],
    // The one service configured rather than credentialed. Its setting is
    // rendered on this card because the setting IS its connection.
    setting: 'sessionizeSpeakerId',
  },

  // ── Education ────────────────────────────────────────────────────────────
  {
    id: 'credly',
    group: 'education',
    icon: Award,
    name: 'Credly',
    description: 'The badge wallet behind the certifications page.',
    url: 'https://www.credly.com/users/saul-patino/badges',
    test: null,
    secrets: [],
  },
  {
    id: 'microsoft-learn',
    group: 'education',
    icon: BookOpen,
    name: 'Microsoft Learn',
    description: 'The certification transcript behind the Azure Learn pages.',
    url: 'https://learn.microsoft.com/en-us/users/saulpatinojr/transcript/d4993ir4gpz8g40',
    test: null,
    secrets: [],
  },
  {
    id: 'aws-skill-builder',
    group: 'education',
    icon: Cloud,
    name: 'AWS Skill Builder',
    description: 'The certification badges behind the AWS Learn pages.',
    url: 'https://skillsprofile.skillbuilder.aws/user/saulpatino/certification-badges',
    test: null,
    secrets: [],
  },
  {
    id: 'google-developer',
    group: 'education',
    icon: Globe,
    name: 'Google Developer',
    description: 'The developer profile behind the Google Cloud Learn pages.',
    url: 'https://developers.google.com/profile/u/105048864698113573023',
    test: null,
    secrets: [],
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
            {/*
              A WRITE IS SLOW AND THE PAGE MUST SAY SO. A spinner inside one
              small button is easy to miss on a phone, and nothing else on the
              row moved, so an operator had no way to tell a save in progress
              from a dead page. While `busy`, the state label is replaced by
              "Saving…" and the rest of the line is suppressed: the old status
              is about to stop being true, and showing it beside a spinner
              invites reading it as the new one.
            */}
            {busy ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </span>
            ) : (
              <>
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
                  // The provider's own words. `HTTP 401` alone sent two days
                  // into reminting a key that a sentence would have exonerated
                  // or condemned outright (#463 item 4, #358).
                  <span className="text-muted-foreground"> — {item.lastFailDetail}</span>
                ) : null}
                {!item.hasLivenessCheck && item.state === 'live' ? (
                  // Otherwise green would imply "verified", which for these
                  // means only "the reference resolved to something".
                  <span className="text-muted-foreground"> · no liveness check for this one</span>
                ) : null}
              </>
            )}
          </p>
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // The SAME guard the Save button carries. Disabling the button only
          // closes one of two doors: Enter still reaches this handler, so
          // without this an empty or whitespace-only write goes out from the
          // keyboard while the button sits disabled beside it. The server
          // refuses it either way, but a control that is inert and a control
          // that fires a doomed request are not the same thing to whoever is
          // pressing them.
          if (!value.trim()) return;
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
        {/*
          ICON ONLY, and the icon itself becomes the spinner. The first version
          kept the word "Save" beside it, so the only thing that changed during
          a write was a 14px glyph — against a save that takes several seconds
          (a Key Vault write, then an ARM call to refresh the app's references,
          then a reload of this page) that reads as the page having frozen.

          `aria-label` carries the name now that no visible text does.
        */}
        <Button
          type="submit"
          size="sm"
          disabled={busy || !value.trim()}
          aria-label={busy ? `Saving ${item.label}` : `Save ${item.label}`}
          title={busy ? 'Saving…' : `Save this value to ${item.secret}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
 * @param {{ services?: ReadonlyArray<object>, groups?: ReadonlyArray<object>, sections?: ReadonlyArray<object>, secrets?: ReadonlyArray<object> }} input
 * @returns {{ serviceCards: Array<object>, serviceGroups: Array<object>, orphanSections: Array<object> }}
 *   `serviceCards` is every card in registry order; `serviceGroups` is the
 *   same cards under their headings, which is what the page renders.
 */
export function buildIntegrationView({
  services = SERVICES,
  groups = SERVICE_GROUPS,
  sections = [],
  secrets = [],
} = {}) {
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

  // The safety net, and normally empty. Every credential is shown under its
  // group below; this catches one whose section matches NO group at all,
  // which would otherwise disappear from the page entirely. A key nobody can
  // see is a key nobody can rotate, so it gets a heading of its own rather
  // than silence. `sections` supplies the titles when it can.
  const groupIds = new Set((groups ?? []).map((group) => group.id));
  const byId = new Map((sections ?? []).map((section) => [section.id, section]));
  const orphanSections = [
    ...new Set(
      (secrets ?? [])
        .filter((item) => !claimed.has(item.secret) && !groupIds.has(item.section))
        .map((item) => item.section)
    ),
  ].map((id) => ({
    id,
    title: byId.get(id)?.title ?? id,
    blurb: byId.get(id)?.blurb ?? 'These have no group on this page yet.',
    items: (secrets ?? []).filter((item) => item.section === id && !claimed.has(item.secret)),
  }));

  // Cards, sorted into their headings. A group with no cards is dropped
  // rather than rendered as an empty heading, and a service whose `group` is
  // not in SERVICE_GROUPS falls into the last one rather than vanishing -
  // silently dropping a card is the failure mode worth avoiding here.
  const known = new Set(groups.map((group) => group.id));
  const fallback = groups.length ? groups[groups.length - 1].id : null;
  //
  // Each group carries BOTH its service cards and the credentials in that
  // group that no card claimed. The page used to render every card in one
  // flat list and then sweep the remaining keys into a separate "Other
  // credentials" bucket organised on different lines, so Publer's card and
  // Publer's keys could appear under two different words. One taxonomy, one
  // pass, and a credential is always under the same heading as the service it
  // belongs to.
  const serviceGroups = groups
    .map((group) => ({
      ...group,
      cards: serviceCards.filter((card) =>
        known.has(card.group) ? card.group === group.id : group.id === fallback
      ),
      loose: (secrets ?? []).filter(
        (item) => item.section === group.id && !claimed.has(item.secret)
      ),
    }))
    // `platform` survives an empty result on purpose (#519): it carries the
    // Entra configuration panel, which is not a credential and so is never in
    // `secrets`. Dropping the group when the API returns nothing would hide the
    // configuration exactly when a reader most wants it — the API failing to
    // answer is itself a configuration symptom.
    .filter((group) => group.id === 'platform' || group.cards.length > 0 || group.loose.length > 0);

  return { serviceCards, serviceGroups, orphanSections };
}

// ── Service card ──────────────────────────────────────────────────────────────

/**
 * One service: what it is, where it lives, whether it answers, and the values
 * it runs on.
 *
 * THE LAYOUT IS THE POINT OF THIS COMPONENT. It used to put a full-width "Test
 * Connection" button and an "Open" link in a right-hand column, which pushed
 * the description into a narrow ragged strip beside them and left the name,
 * the sentence and the controls on three different baselines. On a phone that
 * reads as three unrelated things.
 *
 * Now: identity on the left, actions as two icon buttons pinned to the top
 * right, and the values in their own bordered subgroup below. A card has one
 * heading row, one sentence, and one block of values.
 *
 * Both action icons are universal rather than captioned. A globe is a link out
 * and a beaker is a test; neither needs a word, and words were what made the
 * row wrap.
 */
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
          <div className="flex flex-wrap items-center gap-2">
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
        </div>

        {/*
          Actions, top right, always in the same place. `shrink-0` so a long
          description never squeezes them, and a fixed order so the beaker is
          in the same spot on every card that has one.
        */}
        <div className="flex shrink-0 items-center gap-1">
          {service.url && (
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title={`Open ${service.name} \u2014 ${service.url}`}
            >
              <a href={service.url} target="_blank" rel="noopener noreferrer">
                <Globe className="h-4 w-4" />
                <span className="sr-only">{`Open ${service.name}`}</span>
              </a>
            </Button>
          )}
          {service.test && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={handleTest}
              disabled={testing}
              title={testing ? 'Testing\u2026' : `Test the ${service.name} connection`}
              aria-label={testing ? `Testing ${service.name}` : `Test ${service.name}`}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FlaskConical className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/*
        The test's answer gets the full width under the header rather than the
        narrow right-hand column it used to share with the button. Upstream
        error sentences are long, and this is the one place on the page that
        prints them verbatim.
      */}
      {result && (
        <p
          className={`mt-3 flex items-start gap-1.5 text-xs ${
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

      {service.items.length > 0 && (
        <div className="mt-3 rounded-md border border-border/60 bg-muted/20 px-3">
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
        <p className="mt-3 text-xs text-muted-foreground">{service.credentialNote}</p>
      )}
    </Card>
  );
}

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

/**
 * The Entra configuration this site runs on (#519).
 *
 * Belongs in the "Site platform" group for the reason that group's own blurb
 * gives — these are values the site runs on, and each one says what changing it
 * breaks. They are not Key Vault secrets, so they never appear in
 * `secret-catalog.js` and had no surface anywhere in the admin UI: a scope that
 * disagrees with the audience, or a SPA pointed at a different tenant from the
 * API, was invisible until every call started returning 401.
 *
 * WHAT IS SHOWN, AND WHY IT IS SAFE. Identifiers only — a tenant id, an
 * application id, an App Role name, a scope name. Every one of them is already
 * in the SPA's own bundle or in this repository, and the page's rule about
 * never rendering a credential is untouched: there is no credential here.
 *
 * BOTH HALVES, SIDE BY SIDE, WHICH IS THE POINT. The left column is what this
 * browser was built with; the right is what the API says it enforces, fetched
 * from `getAuthExpectations`. A page that compared the frontend against itself
 * would prove only that it agrees with itself.
 *
 * @param {{expectations: object|null, error: string|null}} props
 */
export function EntraConfigurationCard({ expectations, error }) {
  const rows = [
    {
      label: 'Tenant',
      browser: import.meta.env.VITE_ENTRA_TENANT_ID || null,
      api: expectations?.tenantId ?? null,
      breaks: 'Sign-in goes to the wrong directory, or to none.',
    },
    {
      label: 'API audience',
      browser: null,
      api: expectations?.expectedAudience ?? null,
      breaks: 'Every authenticated call returns 401.',
    },
    {
      label: 'SPA client id',
      browser: import.meta.env.VITE_ENTRA_CLIENT_ID || null,
      api: null,
      breaks: 'Sign-in fails at the authority, before any token exists.',
    },
    {
      label: 'Requested scope',
      browser: import.meta.env.VITE_ENTRA_API_SCOPE || null,
      api: expectations?.requiredScope ?? null,
      breaks: 'Tokens arrive without `scp` and the guard refuses them.',
    },
    {
      label: 'Admin App Role',
      browser: null,
      api: expectations?.adminAppRole ?? null,
      breaks: 'Nobody satisfies gate 1, whatever the registry says.',
    },
    {
      label: 'Agent App Role',
      browser: null,
      api: expectations?.labAgentAppRole ?? null,
      breaks: 'The Labs VPS agent cannot authenticate.',
    },
    {
      label: 'Token version',
      browser: null,
      api: expectations?.requiredTokenVersion ?? null,
      breaks: 'Changing it changes the shape of `aud`, so every token is rejected.',
    },
    {
      label: 'Registry container',
      browser: null,
      api: expectations?.registryContainer ?? null,
      breaks: 'Gate 2 reads the wrong container and every admin is unknown.',
    },
  ];

  return (
    <Card className="p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Microsoft Entra ID</h3>
        <p className="text-xs text-muted-foreground">
          Identifiers, not credentials. The API column comes from <code>getAuthExpectations</code>,
          so this compares the browser against the API as deployed rather than against itself.
        </p>
      </div>

      {error ? (
        <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          The API did not answer, so only the browser column is filled in: {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border/60 bg-muted/20">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Value
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                In this browser
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Enforced by the API
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                What changing it breaks
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border/60 align-top">
                <th scope="row" className="px-3 py-2 font-medium">
                  {row.label}
                </th>
                <td className="px-3 py-2 font-mono break-all">{row.browser ?? '—'}</td>
                <td className="px-3 py-2 font-mono break-all">{row.api ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.breaks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        A live token is checked against these on{' '}
        {/*
          A plain anchor, not a router Link: this card is rendered by tests that
          mount the page without a Router, and one full navigation on an admin
          page is a smaller cost than a Router in every one of those tests.
        */}
        <a href="/admin/health" className="underline underline-offset-2">
          Health
        </a>
        , which decodes the caller&apos;s own token and reports a verdict per claim.
      </p>
    </Card>
  );
}

export default function IntegrationsPage() {
  // Every cms/secrets route is super_admin, so a fetch before the token exists
  // is a guaranteed 401 that renders as "could not load".
  const { authReady } = useAuthReady();
  const { toast } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busySecret, setBusySecret] = useState(null);
  const [error, setError] = useState(null);

  // What the API says it enforces (#519). Kept beside the credential status
  // rather than on its own page, because "is this configured correctly" and
  // "is this credential live" are the same question asked twice.
  const [authExpectations, setAuthExpectations] = useState(null);
  const [authExpectationsError, setAuthExpectationsError] = useState(null);

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
      // Deliberately not awaited alongside the secrets read: a refusal here is
      // information (it is the audience-drift signal), not a reason to leave
      // the credential list unrendered.
      getJSON('getAuthExpectations')
        .then((response) => {
          if (cancelled) return;
          setAuthExpectations(response);
          setAuthExpectationsError(null);
        })
        .catch((err) => {
          if (!cancelled) {
            setAuthExpectations(null);
            setAuthExpectationsError(err?.message ?? 'Could not read the API config.');
          }
        });

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

  const { serviceGroups, orphanSections } = buildIntegrationView({
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

      {serviceGroups.map((group) => (
        <section key={group.id} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <p className="text-sm text-muted-foreground">{group.blurb}</p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {group.cards.map((service) => (
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

            {/*
              Credentials in this group that no service card claimed. Same
              heading, same card shape, so a key is never somewhere else on the
              page from the thing it unlocks.
            */}
            {group.id === 'platform' ? (
              <EntraConfigurationCard
                expectations={authExpectations}
                error={authExpectationsError}
              />
            ) : null}

            {group.loose.length > 0 && (
              <Card className="p-4">
                <div className="rounded-md border border-border/60 bg-muted/20 px-3">
                  {group.loose.map((item) => (
                    <SecretRow
                      key={item.secret}
                      item={item}
                      onSubmit={submitSecret}
                      busy={busySecret === item.secret}
                    />
                  ))}
                </div>
              </Card>
            )}
          </div>
        </section>
      ))}

      {orphanSections.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Other credentials</h2>
            <p className="text-sm text-muted-foreground">
              Keys whose group this page does not know about yet.
            </p>
          </div>
          {orphanSections.map((section) => (
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
