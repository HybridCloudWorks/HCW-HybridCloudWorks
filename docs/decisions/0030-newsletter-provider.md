# ADR 0030: The newsletter provider is Resend, and the site owns the schedule

**Status:** Accepted 2026-09-12; §3 amended 2026-09-13 (§3a); §2 amended 2026-09-13 (§2a)
**Decision date:** 2026-09-12
**Owners:** Workload owner

## Context

Issue #504 set out to compare the mailing-list setup against Resend for a
newsletter carrying recent blogs, a "state of IT" note and important news.
Reviewing it first found that the capture side does not work at all.

`NewsletterSignup.jsx` POSTs to `newsletterSubscribe`. That name is registered
nowhere: `functions/src/functions/integrations-http.js` registers
`publerProxy`, `klaviyoProxy` and `linkieProxy` and nothing else, and the name
appears in no entry of `.azure/api-surface.json`. `digest.js` says the same
thing in its own header — the Klaviyo proxy and the public subscribe endpoint
"are separate ports (still notImplemented)".

The component is mounted twice, despite its docstring still claiming it is
"not mounted anywhere by default": `Footer.jsx:20`, so every page on the site,
and `BlogDetailTemplate.jsx:547`, so every blog post.

**The issue's diagnosis of the failure mode is wrong, and the record is
corrected here rather than repeated.** #504 described this as "a control that
looks like it worked" and compared it to the Publer button that reported
success for a 403. It is not that. `NewsletterSignup.jsx:46` checks `res.ok`
and throws, so a 404 sets the error state and renders a visible
"Subscription failed. Please try again." No address is silently discarded and
no visitor is told they subscribed when they did not. What is live is a
**visibly broken control on every page**, which is a different defect with a
different urgency — it is embarrassing rather than lossy, and it does not
justify rushing the provider decision to clear it.

What the estate has today:

| Piece | State |
| --- | --- |
| Public subscribe | **Missing.** The form calls a route that does not exist |
| Klaviyo integration | **Read-only.** No non-GET method exists anywhere in `MailingListPage.jsx`; `IntegrationsPage.jsx:136` is a `GET /api/lists/` |
| Weekly digest | **Works.** `generate-weekly-digest` drafts published content into `newsletters` with status `Draft` |
| Sending | **Missing.** Nothing sends anything |

So the platform can draft a newsletter and can read Klaviyo, and can neither
capture a subscriber nor send. The shape being paid for is a marketing
automation platform used as a read-only address book.

## Purpose and decision drivers

- **The requirement is narrow.** Capture an address, store it, send an HTML
  email on a schedule. Not flows, not behavioural segmentation, not commerce
  events. A decision driver, because the two candidates are priced and shaped
  for very different requirements and the wrong one costs money for capability
  that will never be called.
- **Cost.** ADR 0015's USD 150 monthly ceiling. A newsletter to a list that
  does not yet exist should cost nothing, and the first paid step should buy
  headroom rather than unblock the basic case.
- **The scheduling machinery already exists here.** The Function App runs
  timer triggers (`jobs-sweeper.js`, `cosmos-export.js`, pinned by
  `timer-schedules-utc.test.js`), and `digest.js` already drafts a newsletter
  — though today only on demand, as the `generate-weekly-digest` job the
  Mailing List page queues. Putting that job on a timer is a small addition to
  a pattern that exists; a provider that also wants to own scheduling would be
  a second answer to when the newsletter goes out.
- **Reversibility.** The public route contract must not name a vendor, so a
  provider change is an implementation change behind `newsletterSubscribe`
  rather than a redesign or a frontend change.
- **Review before publish.** AI-drafted content goes out under the owner's
  name. ADR 0029 §1b settled this for episodes — approval is the trigger,
  generation never publishes — and a newsletter drafted by the same drafter
  must inherit the rule rather than re-argue it.

## Decision

### 1. Resend is the newsletter provider; Klaviyo is removed rather than left half-wired

Free-tier capability, checked 2026-09-12:

| | Klaviyo Free | Resend Free |
| --- | --- | --- |
| Contacts | 250 active profiles | **1,000** |
| Marketing sends | **500 per month** | **Unlimited** |
| Vendor branding on emails and forms | **Forced** | None |
| Verified domains | — | 3 |

**The send allowance is what decides it.** A weekly newsletter is 4.33 sends
per contact per month, so Klaviyo's 500 monthly sends is a list of
**115 subscribers** before the free plan cannot deliver a weekly cadence at
all. At its own 250-contact ceiling the most it can do is two sends a month.
Resend's marketing meter bills on **contacts stored, not emails sent**, so
1,000 contacts receive a weekly newsletter — 4,333 emails a month — for
nothing.

Klaviyo Free also brands the emails and the forms. For a consultancy's own
newsletter that is a real cost, paid to a plan that cannot send the newsletter
anyway.

Klaviyo is removed, not left in place beside Resend. #504's own closing
condition says it: one provider owns capture and send, and the other is
removed rather than left half-wired. A read-only integration to a list nothing
writes to is exactly the half-wired state this record exists to end.

### 2. The site owns the schedule; Resend is the send API

`digest.js` keeps drafting into `newsletters` with status `Draft`. It runs
only on demand today; the weekly run becomes a Function App timer that queues
the existing `generate-weekly-digest` job. Approval — not generation, not a cron inside the vendor
— creates the broadcast and sends it. The stored draft already carries the
whole payload a broadcast needs:

```js
// digest.js writes this today
await store.upsertDoc('newsletters', { id, title, content, status: 'Draft', ... });
```

`title` is the subject and `content` is the body. No new content pipeline.

Resend can schedule server-side (`scheduledAt`, ISO 8601 or natural language,
up to 30 days out) and that is **deliberately not used for the cadence**. The
cadence lives in the timer, where it is in source control, covered by
`timer-schedules-utc.test.js`, and visible to the same operator who reads
every other schedule. `scheduledAt` is available for a one-off "send this
Tuesday at 9am", which is an instruction about one broadcast rather than a
second place the weekly rhythm is configured.

This is ADR 0029 §1b's rule, applied again: the approval is the trigger and a
draft must not reach a public surface.

#### 2a. A structured issue replaces the digest, and approval schedules the send slot — amended 2026-09-13

§2 above is kept as written, as history. It assumed `digest.js`'s draft — a
title and a markdown body — was the payload a broadcast needs. Built, it was
not: the digest's query carried no URLs, so its newsletter could name articles
but not link to them, and nothing ever read the container it wrote to.

**What replaced it.** `lib/newsletter/issue.js` builds a structured issue: the
items of every registered section (`lib/newsletter/sections.js` — new articles
with the public URL publishing stored, Microsoft certification news, approved
study and podcast episodes), an AI intro and subject from the same drafter, and
a note the owner may write. The email is rendered from that structure at
approval (`render.js`), so the owner edits a subject and a note, never HTML.
Adding a section is one registry entry; the owner asked on 2026-09-13 for
sections to be addable, and this is the shape that makes it one file.

**What approval does, and the change to §2's `scheduledAt` rule.** The owner
decided on 2026-09-13 that every issue is approved before it sends, and set the
slot: Tuesday 09:00 America/Chicago, editable on the Mailing List page with the
postal address and reply-to a send requires. Approval creates the Resend
broadcast with `scheduled_at` at that slot, converted DST-correctly, or sends
immediately when the slot is more than three days away. That IS using Resend's
scheduler for the moment of sending, which §2 said it would not do for the
cadence — and the distinction §2 drew still holds: the weekly RHYTHM, when an
issue is drafted, belongs to a Function App timer (the follow-up PR); the slot
is a property of one approved broadcast. There is still one place the rhythm is
configured.

**At most once.** Approval claims the issue `draft → sending` with an
ETag-conditional write before Resend is called, so a double click or a retry
cannot create two broadcasts. A refused broadcast returns the issue to `draft`
with the reason; a process that dies after claiming leaves `sending`, which is
never retried automatically because a broadcast may exist.

### 3. `newsletterSubscribe` is implemented once, behind a provider-agnostic contract

The route is `POST newsletterSubscribe`, taking `{ email, source, website }`
— `website` being the honeypot the component already sends — and answering
`{ ok }` or `{ error }`. That is exactly what `NewsletterSignup.jsx` already
posts and already parses, so **the frontend does not change**, and the
vendor's name appears nowhere in the contract. A later provider change is a
change to the handler.

#### 3a. The path follows the public-route convention, and double opt-in adds a second route — amended 2026-09-13

Two things changed when this was built, and neither touches the contract's
substance.

**The path is `POST public/newsletter/subscribe`, not `newsletterSubscribe`.**
Every other anonymous route lives under `public/`, and `route-inventory.test.js`
keeps its allowlist in those terms. Following the convention cost the frontend
one changed URL, so "the frontend does not change" above held for the body and
the response, not for the path. The body is still `{ email, source, website }`
and still names no vendor.

**Double opt-in, chosen by the owner on 2026-09-13, adds
`POST public/newsletter/confirm`.** Subscribe emails a signed link and adds
nobody; confirm verifies it and writes the contact. §4 is why the pending state
lives in the link rather than in Cosmos: a pending-subscriber container would be
the mirror §4 refuses. The link's HMAC key is derived from `RESEND_API_KEY`
rather than being a new secret — whoever holds that key can add contacts
directly, so a forged confirmation grants them nothing, and it spares a second
value to seed. `lib/newsletter/confirmation-token.js` carries the full argument.

### 4. Resend holds the list; the site does not mirror it

The contact store is Resend's, and `newsletters` in Cosmos keeps holding
drafts only. The site does not maintain a parallel subscriber collection.

This follows ADR 0029's feed rule for the same reason: two stores of the same
truth eventually disagree, and then there is no answer to who is subscribed.
Unsubscribes are the sharp edge — Resend handles the unsubscribe flow and
skips those contacts on the next broadcast, and a mirrored list in Cosmos
would have to be told, would sometimes not be, and would mail someone who
opted out. The accepted cost is portability, addressed in the risks below.

### 5. Build against `segments.*`, not `audiences.*`

Resend is migrating contacts from Audiences to Segments; `audiences.*` remains
for backward compatibility and is marked deprecated, and broadcasts accept
either `segmentId` or `audienceId`. New code targets `segments.*` so this does
not become a port in six months.

## Consequences and accepted risks

- **The free tier is a cliff, not a ramp.** Resend Marketing is free to 1,000
  contacts and the next tier is **USD 40 a month for 5,000**. There is nothing
  in between, so contact 1,001 costs USD 40 and there is no gentle overage
  step. Klaviyo's low end is smoother — about USD 20 at 251 contacts and
  USD 30 at 1,000 — but it charges across a band where Resend is still free
  and still cannot send a weekly newsletter. Above 2,500 contacts Resend is
  materially cheaper (USD 40 against roughly USD 60, and USD 40 against
  roughly USD 100 at 5,000). The cliff is accepted because it is a cliff into
  five times the headroom, and the revisit trigger below watches for it.
- **Two meters, both free today, and they are not interchangeable.**
  Transactional is metered per email — 3,000 a month and **100 a day** — and
  Marketing is metered on contacts. A signup confirmation is transactional and
  a broadcast is not, so a large list does not consume the daily cap and a busy
  signup day does not consume contacts. Transactional overflow is Pro at
  USD 20 a month for 50,000 emails, separate from the Marketing SKU.
- **Resend is email-only, permanently.** There is no SMS path and there will
  not be one. Klaviyo bundles SMS (150 credits on free) and giving that up is
  the one capability this decision forecloses. It is accepted because SMS
  marketing has never been asked for and the estate's push channel is Telegram.
  It is also the first revisit trigger below.
- **It is not a CRM, and that is the point.** No behavioural segmentation, no
  event history per profile, no commerce flows. If those are ever wanted this
  record is wrong and should be superseded rather than stretched.
- **Portability is an export, not a mirror.** Because §4 keeps the list at the
  vendor, leaving Resend means exporting contacts and importing them elsewhere.
  That is the same exit cost Klaviyo carries today and it is the reason the
  route contract in §3 names no vendor.
- **Deliverability is ours either way.** SPF and DKIM for
  `hybridcloudworks.com` are Cloudflare DNS records and owner-gated. Neither
  candidate avoids this and neither should be blamed for a bounce rate until
  it is done.
- **One known SDK defect has to be pinned on first write.** `resend/resend-node#458`
  reports that creating a contact with `unsubscribed: false` produced an
  unsubscribed contact. If that reproduces, a subscriber would be captured and
  then silently skipped by every broadcast — the lossy failure #504 wrongly
  attributed to the current form, arriving for real. The first write asserts
  the contact's stored state rather than trusting the call's success, and a
  test pins it.
- **The broken form stays live until this is built.** The owner's decision on
  2026-09-12 was to sequence the provider choice first rather than unmount, on
  the corrected understanding that the form fails visibly rather than
  discarding addresses. Recorded here so the state is deliberate and dated
  rather than forgotten.

## Alternatives considered

- **Keep Klaviyo and implement `newsletterSubscribe` against it.** The
  status quo made to work. Rejected on the send allowance: 500 emails a month
  cannot carry a weekly newsletter past 115 subscribers, so the first success
  of the feature would be the thing that breaks it, and the fix would be a
  paid Klaviyo plan bought to reach a list size Resend serves free. The forced
  branding and the 2025 shift to billing on all active profiles rather than
  contacts emailed both push the same way.
- **Azure Communication Services Email.** The native-estate answer: managed
  identity instead of a Key Vault secret, per-email pricing far below either
  candidate, and one less vendor. Rejected because it is a sending service,
  not a newsletter service — no contact store, no broadcast, no unsubscribe
  handling, no list-management surface. It would solve the half of #504 that
  already works and none of the half that does not, and the compliance
  surface it omits (unsubscribe, suppression) is exactly the part that is
  unpleasant to own.
- **Self-host the list on Cosmos and send through ACS.** ACS above, plus a
  `subscribers` container, an unsubscribe route with signed tokens, a
  suppression list and a broadcast worker. Technically open — ADR 0012's
  idempotent-worker pattern is the right shape — and rejected on cost of
  ownership: it rebuilds CAN-SPAM and GDPR plumbing that the chosen vendor
  gives away at the free tier, for a newsletter with no subscribers yet. It
  stays the fallback if Resend's pricing ever stops working, in the same way
  self-hosting the podcast feed stayed the fallback in ADR 0029.
- **Unmount the form and defer everything.** Two lines, and it was offered on
  2026-09-12. Declined by the owner in favour of deciding the provider first,
  which the correction above supports: a visibly failing control is not
  urgent in the way a silently lossy one would have been.

## Validation and revisit triggers

- **Validated in production when:** subscribing on the live site creates a
  contact in the Resend segment and the button reports the true outcome; the
  weekly draft can be approved in the admin and arrives as an email; an
  unsubscribe from a delivered email removes that contact from the next
  broadcast without any code running here; and `newsletterSubscribe` appears
  in `.azure/api-surface.json` rather than being a name only the frontend
  knows.
- **Validated for the SDK defect when:** a contact created through the live
  route is read back and asserted subscribed, and a test pins that assertion.
  Reproducing `resend/resend-node#458` is not a blocker; discovering it after a list has been
  collected would be.
- **Validated for cost when:** the first month closes with the Resend bill at
  zero and the contact count recorded, so the distance to the 1,000 cliff is a
  known number rather than a surprise.
- **Revisit if SMS is ever wanted.** Resend cannot do it at any tier. That
  reopens the comparison entirely rather than adding a second vendor, because
  a list split across two providers has the §4 problem by construction.
- **Revisit when contacts pass 800.** Early enough to decide deliberately
  between USD 40 a month, pruning inactive contacts, and the self-hosted
  fallback — rather than discovering the cliff by being billed at it.
- **Revisit when `audiences.*` is removed** from the SDK, if §5 has not
  already made that a no-op.
- **Supersede this record if behavioural segmentation, commerce events or
  automated flows become requirements.** Resend is chosen because the
  requirement is narrow; if the requirement widens, the reasoning does not
  survive and a new record should say so rather than this one being amended.

### Open at decision time

Three variables were unresolved when this was accepted and none of them
changes the choice, but each changes a next step:

- **The current Klaviyo active-profile count.** Determines whether there are
  contacts to migrate at all and whether the free plan is being exceeded
  today. Readable from the admin mailing-list page, which is a `GET` through
  the existing proxy.
- **Whether double opt-in is wanted.** Changes the subscribe handler — one
  write, or a pending state plus a confirmation email (transactional, against
  the 100-a-day meter) plus a confirm route.
- **Whether any existing Klaviyo contacts need exporting** before the
  integration is removed. Removal should not be the thing that discovers
  this.

## Related decisions and references

- [ADR 0015](0015-cost-governance.md) — the ceiling the free-tier and
  next-SKU reasoning is measured against.
- [ADR 0013](0013-ai-provider-strategy.md) — providers selected by key
  presence, the shape `newsletterSubscribe` follows behind its contract.
- [ADR 0029](0029-podcast-hosting-and-audio-surface.md) §1b — approval is the
  publish trigger and generation never publishes; §2 of this record inherits
  it for newsletters.
- [ADR 0012](0012-asynchronous-workflows.md) — the idempotent-worker shape a
  self-hosted send would have taken, and the shape the broadcast job takes.
- Issue #504 (the evaluation that commissioned this record, and the source of
  the failure-mode correction in the Context above).
- `functions/src/lib/content/digest.js`,
  `functions/src/functions/integrations-http.js`,
  `frontend/src/components/shared/NewsletterSignup.jsx`,
  `frontend/src/components/shared/Footer.jsx`,
  `frontend/src/components/templates/BlogDetailTemplate.jsx`,
  `frontend/src/pages/admin/MailingListPage.jsx`.
- Resend account quotas and limits, and the Resend pricing knowledge-base
  page, both checked 2026-09-12; `resend/resend-node#689` (the Segments
  migration) and `resend/resend-node#458` (the unsubscribed-on-create defect).
