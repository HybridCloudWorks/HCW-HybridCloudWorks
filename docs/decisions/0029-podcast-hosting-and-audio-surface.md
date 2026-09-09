# ADR 0029: Podcast hosting is RSS.com, the podcast page is the one audio surface, and the media route serves byte ranges

**Status:** Accepted 2026-09-07; §1 and §2 amended 2026-09-08 (§1b, §2a)
**Decision date:** 2026-09-07
**Owners:** Workload owner

## Context

The show's previous host retired its feed on 2026-09-05: the feed answered
HTTP 410 (#348) and the host's CDN answered 404 for every stored episode
(#372). The ingest timer stopped polling, the public list hid rows whose
media was gone, and the site was left with two audio systems that did not
meet:

| System | Source | Storage and delivery | Reaches Spotify and Apple? |
| --- | --- | --- | --- |
| Podcast pages (`/azure/podcast` and the other providers) | `fetchPodcastFeeds` ingests a host's RSS feed into `podcasts` | Media stays on the host's CDN; the page plays the enclosure URL | Yes, through the host |
| Listen & Learn (certification pages) | `listen-and-learn/generate.js` writes a two-host script, `speech/index.js` synthesises it, `mp3.js` encodes 64 kbps mono | Blob storage, served by `GET /api/public/media/…` | No; the episodes existed only on the certification pages |

Issue #349 evaluated the replacement stack on 2026-09-05: RSS.com for
hosting, ElevenLabs for speech, StreamYard for recording. The findings that
shaped this record:

- **RSS.com** distributes to the directories on every plan. Upload is manual
  on the Free plan; API access — the only route to publishing from the site
  — is on the Max plan at USD 37 a month, and the API was in public beta with
  a warning that endpoints may change.
- **ElevenLabs** produces the dialogue format Listen & Learn already uses and
  emits the stored MP3 shape directly, at about USD 4 per certification on
  the v3 model. Commercial use requires a paid plan.
- **StreamYard** has no public API and no RSS hosting by design. It records;
  a host distributes.
- The media route buffered whole blobs and ignored `Range`, so a seek into a
  Listen & Learn episode downloaded everything before it, and a self-hosted
  feed was ruled out because Apple requires byte-range support of an
  enclosure host.

The owner's decision on 2026-09-07 was **no paid upgrades**. That held for one
day: on 2026-09-08 the owner approved both ElevenLabs and RSS.com Max. Those
amend §1 and §2 below rather than replacing this record, because the reasoning
that produced the Free-plan design is still the reasoning the paid design has to
beat — §1b and §2a say what changed and, more importantly, what did not.

## Purpose and decision drivers

- **Cost.** The platform bills in the tens of dollars a month under a USD 150
  ceiling (ADR 0015). On 2026-09-07 a podcast publishing a handful of episodes
  a month did not justify USD 37 a month for an upload the owner could do by
  hand, or a speech subscription when the configured provider was effectively
  free. The ceiling has not moved; what changed on 2026-09-08 is what is being
  weighed against it (§1b, §2a).
- **Reliability of the public surface.** Whatever the host does, a visitor to
  `/azure/podcast` should find every episode the site has and be able to
  play and seek it. Two disconnected audio systems, one of which had just
  gone dark, was the failure this repairs.
- **Reversibility.** Every choice here must be undoable by a configuration
  change or a small addition, not a migration: the host is a document in
  `admin_config`, the speech provider is an environment variable, and the
  self-hosting path is a route that does not yet exist rather than one that
  cannot.
- **Operational excellence.** The witness for ingest stays what it was — a
  fresh `updatedAt` on `podcasts` at the two-hour firing — and the page's RSS
  button and the timer's ingest read the same document, so they cannot name
  two different feeds.

## Decision

### 1. Hosting: RSS.com, and the feed is the integration boundary (plan and upload amended in §1b)

**Decided 2026-09-07; the plan, the upload and the API claim amended by §1b.**
The show lived on RSS.com's Free plan, and episodes — human recordings and
generated ones alike — were uploaded by hand in the RSS.com dashboard. Nothing
in the repository knew the host's API, and at that date nothing needed to.

**The ingest half of this decision is unchanged and §1b keeps it deliberately.**
The site ingests the show's public feed exactly as it ingested the previous
host's: `fetchPodcastFeeds` reads `admin_config/podcast_feeds`
(`{ feeds: [{ provider, url }] }`, #348) every two hours and upserts one
`podcasts` row per episode. That is still the only way an episode reaches the
site, whoever uploaded it and however.

The owner seeds the feed URL into `admin_config/podcast_feeds` through the
admin platform page. `PODCAST_FEEDS` in `timers/podcasts.js` stays empty;
the host is data, not code.

#### 1a. The show is the site's, not a provider's — amended 2026-09-07

The show that exists is **Hybrid Cloud Insights**
(`https://media.rss.com/hybrid-cloud-insights/feed.xml`), and it belongs to
hybridcloudworks.com rather than to Azure or AWS. The document had no place to
say that: every row in `feeds` is keyed by provider, so seeding the show under
one provider would have hidden it from the other seven pages and mislabelled it
on the one.

**The document grows a field, the run grows a reserved provider.**
`admin_config/podcast_feeds` becomes
`{ mainFeedUrl, feeds: [{ provider, url }] }`. `mainFeedUrl` is a separate
field, not a row, because the two are not the same kind of value and because a
document written before it existed still reads correctly — `feeds` is
untouched, and a Functions revision that predates this change ignores the new
key rather than fetching it as a provider. Inside a run, though, it is an
ordinary entry: `resolvePodcastFeeds` returns it first, under the reserved
provider `main`, so the ingest loop, the dedupe, the 410 handling and the
summary line all work on it unchanged, and the episodes it writes carry
`provider: 'main'`.

A reserved value rather than a new field on the episode, because every
consumer of `podcasts` already keys on `provider`: the container's composite
index is `provider + publishedAt`, the public list filters on it in SQL, and
the section counts read it. A row with no provider would be fetched by no query
and counted by nothing — invisible in exactly the way the empty audio pages
were.

**Consequences that had to be decided rather than discovered:**

- `GET /api/public/podcasts?provider=` returns
  `c.provider IN (@provider, @mainProvider)` — one query, so a show episode
  arrives once. It appears on every provider's page and is duplicated on none,
  because `main` is a value `c.provider` takes rather than a copy of a
  provider's row.
- The page leads with it. `mergeAudioEpisodes` orders the show first as a
  group, each group newest first, so the featured player on every provider page
  plays the newest episode of the show. Source chips and the source filter gain
  a third entry, built from the sources a page actually has rather than a fixed
  pair.
- The RSS subscribe button falls back: the provider's own feed where it has
  one, the show otherwise. `GET public/podcasts` returns both URLs and
  `useAudioEpisodes` chooses, because the hook is what knows which rows the
  list is showing.
- **The section counts had to move with it (#373, #404).** A show episode is
  counted for EVERY provider's `audio` and `audio-architecture`, because every
  provider's audio page shows it. It is not put in `_unattributed`: that bucket
  means "we do not know which pages this reaches", and here we do. So the
  sixteen audio URLs #404 dropped from the sitemap return the moment one show
  episode is ingested and the manifest is refreshed — a page with content that
  is not advertised is the mirror image of the bug #373 fixed.
- Two writes are refused rather than resolved: `main` as a provider row, and a
  provider row repeating the main feed's URL. The second matters more than it
  looks — both ingests build the same episode ids from the same guids, so each
  run would overwrite the other's `provider` and an episode would flip between
  the show and a provider every two hours.

Nothing about hosting changed with 1a. As of 2026-09-07 the upload was still
manual and the host's API still not integrated; §1b changes both. The feed being
the integration boundary is the part that outlived them, and §1b keeps it
deliberately.

#### 1b. RSS.com Max is approved; publishing becomes an API step — amended 2026-09-08

The owner approved the Max plan on 2026-09-08, meeting half of the trigger this
record wrote for itself — "only if the automated publish step is wanted and the
API has left beta". The other half is a fact about the API rather than about the
budget, so it is checked before code is written rather than assumed: #349 found
the API in public beta on 2026-09-05, warning that endpoints may change. If it
still is, that is a constraint to design against and not a blocker — an
idempotent, retryable publish whose failure does not un-approve the episode, and
the manual path left intact underneath it.

**What changes.** Approving an episode uploads it to RSS.com. The manual
dashboard upload stops being the only way an episode reaches the feed, which is
what the Consequences section below called "the cost of ownership of the Free
plan, and it is the whole cost". That was costed against one source of episodes.
#432 adds three (#433, #434, #435), and a per-episode manual step scales with
the number of things producing episodes.

*Landed 2026-09-09 for one of the three sources.* Approving a podcast
transcript — `POST cms/podcast/transcripts/review` moving a
`podcast_transcripts` document to `published` — now queues the
`publish-podcast-transcript` job, which uploads the transcript's MP3 and
creates (or, on a re-run, updates) the RSS.com episode; the outcome lives on the
document under `host.rsscom`, the retry is
`POST cms/podcast/transcripts/{id}/publish`, and a publish that fails or is
skipped (no audio, RSS.com not configured) leaves the approval as written.
Listen & Learn episodes do **not** publish yet: whether the exam-prep playlist
belongs on the show at all is the fourth decision still open on #349, and
`setEpisodeStatus` on `listen_and_learn_episodes` runs no host step until it is
made.

**What does not.** The feed is still the integration boundary. The site learns
about a published episode by ingesting the show's feed into `podcasts`, exactly
as it does for an episode uploaded by hand — not by writing the row at publish
time from what it just uploaded. That shortcut is tempting and wrong: it creates
a row the feed did not produce, and when the two disagree there is no longer a
single answer to what is published. The accepted cost is a visible lag between
approval and appearance, which the admin surface explains rather than leaving an
operator refreshing.

**Generation still does not publish.** `setEpisodeStatus` moving an episode to
`published` is the trigger, never the end of a generation run. Drafts are
AI-written content going out under the owner's name; the review gate is why the
Consequences section says episodes land as drafts, and an automated publish path
must not route around it.

Tracked by #437.

### 2. Speech: providers selected by key presence, in a stated preference order (order amended in §2a)

**Decided 2026-09-07; superseded by §2a below.** `speech/index.js` keeps its
order: Gemini TTS when the `GEMINI_API_KEY` app setting is present — a Key Vault
reference to the `GEMINI-API-KEY` secret, which is why the two spellings differ
(`infra/functionapp.tf`) — Azure AI Speech as the fallback, pinnable with
`LISTEN_AND_LEARN_TTS_PROVIDER`. ElevenLabs was not
added: its commercial licence requires a paid plan, and at that date the owner
had declined paid services. The provider switch rejects `elevenlabs` by name in
its tests, so the shape a third provider takes was recorded and the trial was a
bounded piece of work for when a plan was approved.

#### 2a. ElevenLabs is selected — amended 2026-09-08

The owner approved a paid ElevenLabs plan on 2026-09-08. The trigger this record
wrote for itself — "Revisit ElevenLabs when a paid plan is approved" — is met
literally, so the deferral above is superseded rather than argued with.

**What changes.** A third entry in `PROVIDERS`, selected when its key is
present, under the same contract as its siblings: MP3 out, so the blob path, the
stored `contentType` and the player are untouched and the provider stays an
implementation detail of that directory. The test asserting `elevenlabs` is not
a configured provider was the record of the deferral; it is replaced by tests of
the provider rather than deleted quietly.

**What the preference order has to answer.** Gemini is first today because it
costs nothing beyond a key already seeded, and Azure AI Speech is kept because
every Gemini TTS model is a *preview* model and preview endpoints get retired on
notice. Paying for ElevenLabs changes the first half of that reasoning and none
of the second. So it runs when configured — it is what the owner is paying for
and chose — and Gemini remains the fallback for a state a paid provider has and
a free one does not: out of credit. The estimated cost of a run is stated before
the run starts, because roughly USD 4 per certification is a number an operator
should see beforehand rather than find in the usage table afterwards.

Tracked by #436.

### 3. The podcast page is the single audio surface

A provider's podcast page lists **both** sources — the host's ingested
episodes and the published Listen & Learn episodes for that provider — in one
date-sorted list, each row labelled with where it came from, played by one
component that supports seeking:

- `GET /api/public/listen-and-learn/episodes?platform=` is the provider-wide
  twin of the per-certification read: the same `status === 'published'`
  equality gate, rows projected to a listing allowlist (no transcript, no
  videos) and joined to their certification's title and slug. An episode
  without audio is omitted, because a podcast row that plays nothing is the
  defect #372 hid on the host side.
- `GET /api/public/podcasts` now returns `feedUrl`, the provider's row in
  `admin_config/podcast_feeds`. The page's RSS subscribe button reads it, so
  the button and the ingest cannot disagree. Spotify, Apple and Amazon stay
  in the provider configuration and each button appears only when its URL is
  configured.
- The aws, azure and gcp copies of the podcast page were the shared page with
  colours inlined. They are gone; every provider routes to the shared page
  and `provider-coverage.test.js` demands a metadata row for each.
- The player is a native `<audio>` element with `preload="metadata"`, driven
  by a keyboard-operable slider. It seeks because of the next decision.

### 4. The media route honours byte ranges

`GET /api/public/media/{container}/{*blobPath}` answers a single
`Range: bytes=…` with `206 Partial Content` and a `Content-Range`, reading
only the requested bytes from blob storage through the SDK's ranged download
rather than buffering the file; a start past the end answers `416` with
`bytes */size`; multi-range requests are ignored and served in full, as RFC
9110 permits; every success carries `Accept-Ranges: bytes`. `HEAD` is
registered alongside `GET` and answers the 200's headers with
`Content-Length` from blob properties alone. Caching is unchanged: the URL
carries the content's timestamp, so `immutable` and the ETag conditional
apply to partial responses as they did to full ones.

This is what a seek needs. It is also what a podcast directory requires of an
enclosure host, which is why option 3 on #349 — a self-hosted feed — is now
open rather than blocked (see revisit triggers).

### 5. StreamYard is a manual studio

No code. StreamYard records; the recording is uploaded to the host like any
other episode, and the feed carries it to the site. A live session, if one is
ever run, is a YouTube embed on a page, not an integration.

## Consequences and accepted risks

- **One manual upload per episode — accepted 2026-09-07, ended by §1b.** That was
  the cost of ownership of the Free plan, and it was the whole cost. Generated
  Listen & Learn episodes were not on the public feed unless the owner uploaded
  them; on the site they were already on the podcast page, which is where a
  visitor looks. §1b is what made that cost worth removing rather than bearing.
- **No download analytics beyond the host's.** RSS.com's dashboard reports
  plays of feed episodes; Listen & Learn plays through the media route are
  visible only as Function invocations.
- **Media bytes still pass through Function invocations.** Ranged reads make
  a seek cheap rather than free; ADR 0014's note that a CDN can be layered in
  front of the origin later, without application change, still holds and is
  now more useful, since a CDN forwards `Range` as-is.
- **`If-Range` is not evaluated.** Safe only because a media URL never changes
  content — the path carries the timestamp. If that ever stops being true the
  route must evaluate `If-Range` before answering 206.
- **Two copies of four names.** `public-reads.js` has no imports by design,
  so the feed-config container, document id and partition are copied there —
  and, with 1a, the reserved provider `main`; `public-reads.test.js` asserts
  the copies agree with `timers/podcasts.js` and `cosmos-client.js`, the same
  guard the Listen & Learn container names already had. The browser holds a
  copy of the reserved provider too (`frontend/src/lib/audioEpisodes.js`),
  which no test can tie to the server's: it travels on every episode row
  instead, and the page tests pin what a row carrying it renders as.

## Alternatives considered

- **RSS.com Max with an API publish step (option 2 on #349).** `publish.js`
  would push a finished MP3 to the host and the feed would round-trip it into
  `podcasts`. USD 37 a month for automating something that happens a handful of
  times a month, on a beta API whose endpoints may change. Declined on
  2026-09-07 and **approved on 2026-09-08** (§1b, #437); the site side was
  built so that adding it later is a publish step and a configuration change,
  not a redesign, which is what that issue now does. As considered here the
  push was described per finished MP3, which reads as generation-time
  publishing; **§1b settles it the other way** — approval is the trigger and
  generation never publishes, because a draft must not reach a public feed.
- **Self-host the feed (option 3 on #349).** A new `GET
  /api/public/podcast/{provider}/feed.xml` built from `podcasts` plus
  published Listen & Learn episodes and submitted to the directories
  directly. No vendor and no upload step, but it was blocked on byte-range
  support and it forfeits the host's analytics. The blocker is removed by
  this record; the option is the revisit path below.
- **ElevenLabs now, on a Starter plan.** About USD 4 per certification and a
  dialogue endpoint that matches the stored format. Deferred on 2026-09-07
  because a paid plan is required for commercial use and the configured provider
  costs nothing; **approved on 2026-09-08** (§2a, #436).
- **Serve Listen & Learn audio straight from blob storage.** Requires
  reversing `allow_nested_items_to_be_public` and the account's network
  deny, which ADR 0014 and T-105 chose not to do; the media route with
  ranges gives the same seek behaviour without opening the account.
- **Keep the certification pages as the only place Listen & Learn plays.**
  Leaves the podcast page empty whenever the host is dark, which is exactly
  the state the site was in.

## Validation and revisit triggers

- Validated in code on 2026-09-07: `functions` 1648 tests, `frontend` 494
  tests, `mkdocs build --strict` and the redaction gate green on the change.
- Validated in production when: the RSS.com show exists and its feed URL is
  in `admin_config/podcast_feeds`; `podcasts.updatedAt` is fresh within two
  hours of the seed; `/azure/podcast` lists feed and Listen & Learn rows
  together; a seek into a Listen & Learn episode produces a 206 in the
  Function App's request log rather than a 200 of the whole file.
- Validated for the main feed (1a) when: the Main feed field on
  `/admin/platform` holds the show's URL; within two hours `podcasts` carries
  rows with `provider: 'main'`; every provider's `/…/audio` page leads with a
  show episode and offers an RSS button pointing at the show; and the next
  `publish-content-manifest` run reports non-zero `audio` counts for all eight
  providers, which is what returns those URLs to `sitemap.xml`.
- **Revisit toward self-hosting (option 3)** when any of these holds: the
  manual upload is missed for more than one episode; the owner wants
  generated episodes on the public feed without the upload step; RSS.com's
  plan changes what it distributes. The media route is ready; the work
  is the feed route, the directory submissions, and deciding what replaces
  the host's analytics.
  **The second condition fired on 2026-09-08 and was answered by §1b instead**,
  which buys the same outcome without leaving the directories or giving up the
  host's analytics. Self-hosting stays the fallback if the host's API does not
  hold up; it is no longer the only route to publishing without an upload.
- **Revisit ElevenLabs** when a paid plan is approved. **Met 2026-09-08**
  (§2a, #436). The trial the issue describes — one certification through both
  providers, compared on cost and listenability — is the evidence that issue
  records.
- **Revisit RSS.com Max** only if the automated publish step is wanted and
  the API has left beta. **The first condition was met 2026-09-08** (§1b, #437);
  the second is a fact about the API today, verified on that issue before the
  client is written.

## Related decisions and references

- [ADR 0014](0014-storage-and-media.md) — the closed storage account the
  media route exists to serve from; ranged delivery keeps it closed.
- [ADR 0013](0013-ai-provider-strategy.md) — providers selected by key
  presence, which is the shape the speech order follows.
- [ADR 0015](0015-cost-governance.md) — the ceiling every "no paid upgrade"
  above is measured against.
- Issue #432 (the audio pipeline project §1b and §2a are the spend decisions
  for), #433, #434, #435 (the three source paths that made a per-episode manual
  upload expensive), #436 (ElevenLabs), #437 (RSS.com publish).
- Issue #349 (the evaluation and the owner's decisions), #348 (the feed list
  moved to `admin_config`), #372 (retired media hidden from the list); PR
  #363 removed the previous host's remaining references.
- `functions/src/lib/public-media.js`, `functions/src/lib/blob-storage.js`,
  `functions/src/lib/public-reads.js`, `frontend/src/lib/audioEpisodes.js`,
  `frontend/src/components/podcast/EpisodePlayer.jsx`.
- RFC 9110 §14 (Range requests) and Apple Podcasts' requirement that
  enclosure hosts support byte-range requests.
