---
title: The region that took three tries
subtitle: What actually happened building the platform from How-To part 1 — including the rebuild we chose to do.
date: 2026-08-19
track: build-log
part: 1 of 2
tags: [azure, terraform, iac]
reading: 8
---

Azure told us our first-choice region was fine three separate times before we
worked out it wasn't.

Not in the same way each time, which is what made it slow. Once it was a Cosmos
account returning `ServiceUnavailable`, blaming high demand for availability
zones — a message pointing at a setting that had nothing to do with it. Once it
was a Static Web App that simply cannot be created there, in a list of five
regions nobody had thought to check. And once it was an AI model that doesn't
exist in that region at all.

Three failures, three unrelated-looking errors, one cause.

*This is the companion to [How-To part 1](../content/blog-how-to-01-infrastructure.md), which
has the recipe. This one has the mistakes.*

## The setup

Move a live site off one cloud onto Azure: static site, API, database, object
storage, secrets. The constraint that made it interesting was a **USD 150 per
month ceiling**.

That number does most of the architectural work, and cleanly — a budget you
cannot argue with is a budget that makes decisions for you. Everything through
Terraform, no clicking, no stored credentials, nothing created by hand that
isn't written down.

That last rule has an obvious problem, and it was the first thing that bit.

## Terraform cannot create the credential Terraform uses

Runs execute in HCP Terraform, authenticating to Azure with a short-lived OIDC
token. Fine. But the identity behind that token has to exist before the first
run, and the only tool available for creating it is the tool that cannot start
without it.

The fix is a bootstrap script that runs once, outside state. Two details in it
turned out to matter more than the script.

**Managed identity, not app registration.** App registrations need Application
Administrator in Entra, and Azure Owner does not grant it — they are separate
permission planes. Finding that out mid-deploy produces a permissions error that
looks like a subscription problem.

**Two federated credentials, not one.** HCP Terraform stamps the run phase into
the token subject, and Entra matches subjects as exact, case-sensitive strings.
`run_phase:plan` and `run_phase:apply` are different subjects. Configure only
the first and every run plans beautifully while every apply fails at
authentication — which, again, reads as a permissions problem and is not one.

## Two APIs, one question, different answers

Back to the region, which turned out to be the interesting failure, because
*finding* a legal region takes two checks that disagree with each other.

ARM tells you whether a resource type is deployable in a region. Cosmos tells
you, separately, whether your subscription is cleared for that region. Neither
knows what the other thinks.

| Region | ARM: deployable? | Cosmos: cleared? |
| --- | --- | --- |
| First choice | yes | **no** |
| Its neighbour | **no** | yes |
| Third region | yes | yes |

We consulted the second list first, picked the neighbouring region, and ARM
rejected it outright. The error helpfully listed valid regions — a list
containing our first choice, which the other API had just said was unavailable.

Neither list was wrong. They answer different questions, and we had only asked
one of them.

## A stranger owns your Key Vault name

Key Vault names are global across all of Azure, not scoped to your tenant. The
name we wanted was held by an unrelated customer and wasn't soft-deleted
anywhere we could see, so it wasn't recoverable.

Five-minute problem if you find it before the first apply. Considerably worse
during one. The instance suffix reserved for exactly this case went from a
convention we'd documented but never used to a convention we'd used in earnest.

## Deleting the AI

The plan called for a managed AI account. The apply refused to create one, for
two reasons that only appear at apply time: the subscription held **zero token
quota for the model in every SKU**, and the image model wasn't offered in the
region at all.

We could have requested quota. Instead we checked what consumed it, and the
answer was nothing — the client module had no importers and the seventeen
endpoints behind it were unimplemented stubs. We'd have been unblocking a path
with no traffic on it.

So it came out entirely: account, resource group, diagnostic settings, app
settings. AI calls go to external provider APIs keyed from the vault, which is
what the rest of the configuration already did. The model router was already
provider-abstracted, which is the only reason this was cheap rather than a
rewrite.

Then we deleted the client module too. A file importing an SDK for a service you
retired is a trap for whoever ports those endpoints next.

## Then we tore it all down

By this point the estate worked and its names were wrong. Half the resources
carried the region token from the failed region, the instance-number convention
hadn't been applied consistently, and one resource was running in the third
region while named for the first.

Azure resource names are immutable. So are regions. There is no rename — only
destroy and recreate.

```
Plan: 125 to add, 3 to change, 125 to destroy.
```

We did it, and the timing is the whole point: no data had been migrated. Every
container was empty, both storage accounts were empty. The same change three
weeks later is a data migration with a maintenance window. Right then it was an
afternoon.

Four resources carried `prevent_destroy` guards, and Terraform correctly refused
to plan until a human lifted them in a reviewed change. That is the guard
working, not an obstacle. We lifted them, rebuilt, and restored them the same
day.

One thing nearly went wrong. The teardown stalled on a resource group Azure
wouldn't delete, because Application Insights had quietly created a
`Smart Detection` action group inside it that Terraform didn't manage, and the
provider refuses to delete a group containing unmanaged resources. The suggested
fix is a provider flag disabling that check globally. We deleted the one object
instead — turning off a safety check everywhere is a poor trade for a problem
that exists in one place.

## What we'd do differently

Check region availability before writing the configuration rather than during
the apply. Three commands would have saved three failed applies, and they're in
the how-to.

Check globally-unique names before the first apply too — storage accounts, Key
Vaults, Cosmos accounts and Function Apps all live in a namespace shared with
every Azure customer.

Everything else the same, including the rebuild. It looked like rework and was
the cheapest hour in the project.

## Where it stands

129 resources in one region. `terraform plan` returns *"No changes."* Every
backing store denies by default and admits exactly one subnet. No keys anywhere:
database key auth disabled, storage SAS user-delegation signed by managed
identity, secrets in the vault, CI authenticating by OIDC with nothing stored.

What isn't done: the application. The Function App is an empty shell, every
container is empty, and not one document has been migrated.

That's the next post, and it starts by locking a door and then walking into it.

---

*Part 1 of 2 · Recipe: [How-To part 1](../content/blog-how-to-01-infrastructure.md)*
