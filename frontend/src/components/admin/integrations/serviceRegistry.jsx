/**
 * The Integrations Hub's registry: every service, the group it sits under, and
 * the browser-side test that asks it whether it works.
 *
 * Moved unchanged out of pages/admin/IntegrationsPage.jsx (#570), which is now
 * only the tab bar. Every tab reads this one list, so the Overview grid, the
 * Services cards and the Keys tab's "used by" line cannot disagree about which
 * service owns which key.
 */

import React from 'react';
import {
  Award,
  BookOpen,
  Cloud,
  Coins,
  Globe,
  Link2,
  Mail,
  Mic,
  Radio,
  Rss,
  Send,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { postJSON } from '@/lib/api';
import { fetchCloudPricing } from '@/lib/publicApi';
import { DEFAULT_PRICING_REGION, describeAge, describeCounts } from '@/lib/cloudPricing';
import { countList, unwrapProxy } from '@/lib/proxyEnvelope';
import { extractProfiles } from '@/lib/linkie';
import { DEFAULT_SESSIONIZE_SPEAKER_ID } from '@/lib/adminSettings';

// lucide-react v1.x dropped brand icons — inline YouTube glyph (same as SocialHubPage).
const Youtube = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
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
  // mcpProxy answers `{ ok: false, error }` with HTTP 200 for a tool or upstream
  // refusal (lib/ai/mcp.js), so the envelope's `ok` is the verdict, as above.
  unwrapProxy(
    await postJSON('mcpProxy', {
      serverId: 'plaud',
      tool: 'list_files',
      arguments: { limit: 1 },
    }),
    'Plaud'
  );
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

// The services whose credentials never reach a browser (#483). Each posts a NAME
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

async function testResend() {
  // GET /domains, server-side. A sending-access-only key is refused here with
  // Resend's own sentence, which `unwrapProxy` surfaces, so a pass means the
  // key can manage contacts and broadcasts (ADR 0030).
  const body = unwrapProxy(await postJSON('connectionProbe', { probe: 'resend' }), 'Resend');
  const count = countList(body);
  if (count === null) return 'Connected to Resend.';
  // Zero is worth its own sentence: the key works, and nothing can be sent
  // until a domain is added and verified.
  return count === 0
    ? 'Connected, but no sending domain has been added to Resend yet.'
    : `Connected — ${count} sending domain(s).`;
}

async function testQlty() {
  // GET https://api.qlty.sh/user, server-side. The envelope's `data` is Qlty's
  // user object; its login says whose token this is.
  const body = unwrapProxy(await postJSON('connectionProbe', { probe: 'qlty' }), 'Qlty');
  const login = body?.login;
  return typeof login === 'string' && login.trim()
    ? `Connected as ${login.trim()}.`
    : 'Connected to Qlty.';
}

async function testCloudPricing() {
  // The public read the comparison page makes, for the default region, and
  // always FRESH: a diagnostic that could answer from the browser's copy would
  // report the cache as it was before "Refresh now" for fifteen minutes.
  const pricing = await fetchCloudPricing(DEFAULT_PRICING_REGION, { fresh: true });
  if (!pricing) throw new Error('The pricing route is missing (HTTP 404).');
  if (!pricing.refreshedAt) {
    // Not a credential failure, but the public page shows no prices until
    // the first refresh — which is the red light this card exists to show.
    throw new Error('No prices cached yet. Press Refresh now to fill the cache.');
  }
  const age = describeAge(pricing.ageMinutes) ?? 'an unknown time ago';
  const counts = describeCounts(pricing.counts);
  if (pricing.stale) {
    throw new Error(`Stale: last refreshed ${age} (${counts}). The daily refresh has missed.`);
  }
  return `Fresh: refreshed ${age} (${counts}).`;
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
    id: 'code-quality',
    title: 'Code quality',
    blurb: 'Read-only access to the repository’s scanner results, shown on the Health page.',
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
 *           origin, and the YouTube, RSS.com, Telegram and Resend keys are only
 *           ever read on the server, so a browser cannot call them directly.
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
 * Two optional fields put something the card can DO beneath the key lines,
 * and IntegrationsServices maps each to a component: `setting` for the one
 * service configured rather than credentialed (Sessionize’s speaker id), and
 * `action` for the one the site fills itself (the pricing cache’s Refresh
 * now). Both are names, not components, so this file stays free of React
 * state and the registry test can read them as data.
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
    id: 'resend',
    group: 'communication',
    icon: Mail,
    name: 'Resend',
    description: 'Holds the newsletter mailing list and sends the newsletter.',
    // Where the key is minted. It must be created with Full access.
    url: 'https://resend.com/api-keys',
    // Server-side: GET /domains, which a sending-only key cannot pass.
    test: testResend,
    secrets: ['RESEND-API-KEY'],
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
    // So "Test all" on the Overview tab leaves it out: that button is one
    // press for every service, and this one spends quota each time. It is
    // still tested from its own card, where the cost is said beside the button.
    skipInTestAll: 'Costs ~100 of 10,000 daily YouTube quota units, so it is tested on its own.',
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

  // ── Cloud ────────────────────────────────────────────────────────────────
  {
    id: 'cloud-pricing',
    group: 'cloud',
    icon: Coins,
    name: 'Cloud pricing cache',
    description:
      'The daily snapshot of AWS, Azure and Google Cloud list prices behind the public pricing comparison page.',
    // Where the cache is shown, since nothing else "lives" anywhere: the keys
    // below are minted at each provider and the Keys tab links there.
    url: 'https://hybridcloudworks.com/tools/comparison',
    // Reads what the public page reads and judges its age, not a credential.
    test: testCloudPricing,
    // The two provider keys the refresh spends. Azure's price list needs none.
    secrets: ['AWS-ACCESS-KEY-ID', 'AWS-SECRET-ACCESS-KEY', 'GCP-BILLING-API-KEY'],
    // The one service the site fills itself, so the card carries the button
    // that fills it (CloudPricingRefresh), the way Sessionize carries its id.
    action: 'refreshCloudPricing',
  },

  // ── Code quality ─────────────────────────────────────────────────────────
  {
    id: 'qlty',
    group: 'code-quality',
    icon: ShieldCheck,
    name: 'Qlty',
    description:
      'Scans the repository for maintainability and security issues. Its grades feed the Health page.',
    // Where the access token is minted.
    url: 'https://qlty.sh/user/settings/tokens',
    // Server-side: GET /user with the stored token, which never reaches a browser.
    test: testQlty,
    secrets: ['QLTY-API-TOKEN'],
  },
]);
