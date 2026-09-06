---
title: I locked the door and left the keys inside
subtitle: What actually happened switching on the application layer — two bugs that only appeared because we turned something on.
date: 2026-08-20
track: build-log
part: 2 of 2
tags: [azure, github-actions, oidc, cdn]
reading: 9
---

`AADSTS700213`. The first time we tried to deploy application code onto the
platform from [part one](../content/blog-build-log-01-infrastructure.md), that's what came
back — and it turned out no deploy from that repository could ever have
succeeded, on any branch, at any point since the workflows were written.

We only found out because we turned one on.

*Companion to [How-To part 2](../content/blog-how-to-02-application.md), which has the
recipe.*

## Closing the origin

The API sits behind a CDN. That's how the app knows a visitor's real IP address,
and that IP is what the rate limiter counts against.

Which is only trustworthy if nobody can skip the CDN and hit the origin
directly. And they could — the `azurewebsites.net` hostname resolves publicly,
so anyone who found it could send a forged client-IP header and mint unlimited
quota per invented address, while bypassing the WAF at the same time.

The fix has two halves that are worthless apart, and the proof is a pair of
responses rather than either one alone:

```
origin hostname     404 → 403   refused
CDN hostname        404 → 404   still arrives
```

Both were 404 beforehand because no code was deployed yet. Afterwards the origin
refuses everything that isn't the CDN while the proxied path is untouched. That
*difference* is the test. Checking only the CDN path would have proved nothing —
it answered before, too.

A detail worth stealing: the CDN rule is created only when the secret is
non-empty. An empty secret would stamp an empty header, the app would compare
empty to empty, and every caller on earth would pass the check. Failing to
create the rule is the safer failure, and it's one line of `count` to make it
the only possible one.

## Then I broke every client

Here's the part I got wrong.

The Function App's origin hostname was in a CI variable, which feeds the
frontend build as the API base URL. That variable pointed at the origin. The one
I had just firewalled.

Every browser API call would have received a bare `403`. So would our own
post-deploy smoke test — which I had "fixed" in the same change and described in
the commit message as now going through the CDN. It didn't. It read the
variable, and the variable pointed at the origin.

What makes this worth writing down isn't the mistake, it's the shape of the
failure. A `403` with no body, on a cross-origin fetch, reads as an
authentication or CORS problem. Nothing in the browser mentions a firewall,
because from the client's side the firewall is invisible. I'd have spent an
afternoon in the identity provider.

The fix wasn't to correct the variable. It was to remove the opportunity: one
output named for what it's *for*, the origin output's description rewritten to
say plainly that it is not client-reachable, and the seeding script sourcing
from the first. Nobody has to remember the rule, because there's no longer a
place to get it wrong.

I nearly missed the second half. The Content Security Policy allowed the origin
hostname — the one host the browser now *can't* use. Changing the base URL
without the CSP swaps a `403` for a CSP refusal, which is a different confusing
error rather than a fix. Both had to move together. It ended up narrower too:
the old policy allowed a wildcard across every Azure Websites host on the
internet, and the replacement allows one name.

## The bug that was there the whole time

With clients pointed at the right address, we enabled the deploy workflow and
dispatched it. It failed at login:

```
AADSTS700213: No matching federated identity record found for presented
assertion subject 'repo:acme@<org-id>/platform@<repo-id>:ref:refs/heads/...'
```

Look at the subject GitHub presented. It carries numeric organisation and
repository IDs embedded in it. The documented format — the one our Terraform
built, the one in every tutorial — is `repo:<org>/<repo>:ref:<ref>`, with no IDs
anywhere.

I checked the API rather than trusting an error string:

```json
{ "use_default": true,
  "sub_claim_prefix": "repo:acme@<org-id>/platform@<repo-id>" }
```

`use_default: true`. Nobody had customised anything. That's the default now.

So the federated credentials could never have matched a real token. Not from a
feature branch, not from `main`, not once. And nobody had noticed because all
four deployment workflows were guarded with `if: false` while the infrastructure
was built — no token had ever been presented to be rejected.

**The bug was latent for exactly as long as we were careful.** Enabling the
cheapest, least destructive workflow is what surfaced it, which is an argument
for enabling one early rather than saving them all for the day you need them.

We now trust both subject forms rather than swapping. The rollout is the
provider's to reverse, and a credential that silently stops matching fails every
deploy with an error naming nothing that changed. They're also less redundant
than they look — the name form survives an org rename that breaks the IDs'
association, the ID form survives a rename outright. Federated credentials are
free and capped at twenty.

## Turning it on, but only partly

The deploy workflow is enabled for **manual dispatch only**, with the
push-on-merge trigger commented out rather than deleted.

Enabling a workflow and enabling auto-deploy-on-merge are two decisions, and
only the first had been made. The first deploys against an app that has never
held code are exactly the ones worth watching, and a red auto-deploy on `main`
is discovered by whoever next visits the site.

The other three stay disabled. One of them reads an entire production database.

## Three documents that disagreed

Not glamorous, but it changed the most.

We had a required-input checklist, a variable catalogue and a blocker list —
three files describing one thing from three angles, each recording facts the
others contradicted. The checklist still described the Terraform bootstrap
identity as absent and all four workspace variables as missing. Every one had
been set for days.

That isn't a documentation problem, it's a correctness problem. A variable can
be "missing" in one file, "set" in another and load-bearing in a third, and the
only way to know which is true is to go and look — at which point the documents
cost time rather than saving it.

They're one file now, organised so the most expensive mistake available —
redoing finished work — is the hardest one to make. Part one is what's done and
verified, and each entry says what proved it. The task list dropped from 1,854
lines to 211 by deleting every completed item rather than striking it through,
after checking each appears in the changelog.

Two remaining items turned out to be wrong rather than stale. One was blocked on
a decision the origin lock had already settled. The other listed variables to
rename, three of which no longer exist. A rename list naming absent variables is
worse than no list.

## What we'd do differently

Enable one deployment workflow on day one, pointed at nothing, just to watch a
token get rejected. The OIDC subject bug cost an afternoon to find and ten
minutes to fix — and it would have cost the same ten minutes on day one, except
it wouldn't have been sitting underneath every deploy decision made in between.

And when you close a door, grep for who was walking through it. I locked the
origin and updated the smoke test in the same change without checking what the
smoke test actually resolved to. The variable was right there.

## Where it stands

129 resources, clean plan, origin accepting the CDN and nothing else. The vault
holds 19 of 21 secrets — the two outstanding are multi-line blobs read at
runtime rather than through app settings, which is exactly why the check that
verified the other 19 didn't catch them. Sixty-three routes and four timers
written and tested, 822 tests passing.

None of it is deployed. The app is still an empty shell, and the last unproven
link is a dispatch from `main` that gets past login.

That's a merge and one button. Then the real work starts: 117 endpoints, 1,395
documents, and a cutover.

---

*Part 2 of 2 · Recipe: [How-To part 2](../content/blog-how-to-02-application.md)*
