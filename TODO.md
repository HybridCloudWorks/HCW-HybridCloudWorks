# TODO

**The one open-work document for the HybridCloudWorks website.** Engineering
work, owner decisions, production approvals, credentials, external access and
live-environment operations live here; verified completion belongs in
[CHANGELOG.md](CHANGELOG.md), and the required-inputs inventory is
[Required-Inputs](docs/standards/required-inputs.md) on the docs site.

**Nothing is open as of 2026-09-06.** The tracked findings (`T-` items), the
attack sequence, the owner-decision record and the long-form evidence all
closed by 2026-09-05 and moved to the changelog. What remains below is not
work: optional features you may seed, one live check that needs Entra access,
four confirmations that come due only on an external trigger, and the accepted
risks, which are decisions to live with something and must stay written down.

## Optional, and only if you want the feature

None of these blocks anything. Each path no-ops when its key is absent; seed at
**Admin → Platform → API Keys**, which writes straight to Key Vault through a
role that can create a secret version and cannot read one:
https://hybridcloudworks.com/admin/api-keys

| Secret or document | What it turns on | Without it |
| --- | --- | --- |
| `REPLICATE-API-KEY` | AI-generated hero images | The default-hero fallback covers it, once the covers below exist |
| ~8 cover images + `admin_config/default_heroes` | A deterministic hero per provider when generation is off or fails | Posts publish with no cover |
| `admin_config/social_autopost` | Scheduled social posting. Shape: `{ enabled, accountIds: [{ id, provider }], scheduleDelayMinutes }`, with Publer account ids from the Social Hub | No autoposting |
| `YOUTUBE-API-KEY` | Listen & Learn "watch next" links. ~505 of 10,000 daily quota units per certification | Episodes publish with an empty video list |
| `GCP-BILLING-API-KEY` | The GCP column in the public pricing tool. GCP console → enable the Cloud Billing API → create an API key → restrict it to that API. **Not a billing credential** — it reads Google's public price list | The GCP column is absent; AWS and Azure still render |

`GEMINI-API-KEY` already covers Listen & Learn speech; nothing to provide.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [TODO.md](TODO.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

## Live confirmation still requiring an authorized operator

- Verify the Entra role claim and API audience in a newly issued access token.
- Verify the admin registry record and the resulting `getCurrentAdminStatus`
  response in the deployed environment.
- Confirm the public API and Static Web App custom domain after any DNS or edge
  change.
- Confirm any third-party webhook or scheduled integration after its owner has
  approved a real external mutation test.

## Accepted risks

A decision to live with a finding rather than fix it. An accepted risk with no
record is indistinguishable from an unfixed one: the next reviewer re-raises it,
or someone "fixes" it without knowing it was a choice.

| Risk | Accepted | Reasoning, and what compensates |
| --- | --- | --- |
| **Log-based alerts sleep when the ingestion cap binds.** If daily volume ever again reaches the 0.25 GB cap, `function_http_5xx` and `function_response_time` stop evaluating from cap-hit until the 08:00 UTC reset — a partial failure in that window surfaces the next morning. Accepted with the T-719 decision | Owner, 2026-09-02 | A personal content site with RTO 8 h does not need same-hour paging on partial failures. The exposure was daily and unrecorded while host verbosity pinned the cap; after the verbosity cut the cap is headroom and the window should not recur. Compensating controls: the T-519 edge probe pages on unreachability twelve times an hour on a pipeline the cap cannot touch, and `logs_daily_cap` alerts at 80% of quota before the blindness starts |
| **Key Vault purge protection is off** on `kv-site-prod-cus-01`, which holds 18 live secrets. Raised as Go-Live blocker B2 on 2026-08-24 | Owner, 2026-08-24 | Enabling it is a **one-way** switch: once on it cannot be turned off, a deleted vault can no longer be purged, and its name stays reserved for the retention period — which removes the teardown-and-recreate path a single-environment estate depends on. The secrets are seeded and resolving, so the exposure is not "unprotected during setup". Compensating control: soft delete at 90 days, which still makes an accidental delete recoverable. What is given up is protection against a *deliberate* purge by someone already holding the rights to perform one. Recorded in the same terms in `infra/variables.tf` and `infra/README.md` |
| **`cloudflare_origin_secret` is a real shared-secret value in Terraform state.** Raised as T-723, 2026-08-28 | Recorded 2026-08-28 | Unavoidable rather than chosen: Terraform configures the Cloudflare end of the origin handshake, so the value has to pass through it. It was simply never written down, which is the part that is fixed here. **Rotation consequence, which is the reason this needs a record:** the value must change in three places in one window — the HCP Terraform workspace variable, Key Vault `CF-ORIGIN-SECRET`, and the Cloudflare transform rule Terraform writes — and a mismatch throws on *every anonymous request*, so a partial rotation is a full outage of the public API rather than a degradation. The companion exposure — the azapi read-back exporting the whole live app-settings map into state — is not accepted but *bounded*: it is safe only while every secret-shaped setting is a Key Vault reference, and `functions/src/functions/app-settings-secrets.test.js` now fails CI if one is not |

## Handling rules

- Never paste secret values, private keys, access tokens, or personal data into
  this file, issues, logs, or the Wiki.
- A missing credential is not an engineering task. Record its name, owner, and
  approved storage location only.
- Historical migration pages and the two archived plans are evidence, not
  current instructions for restoring Firebase services.

---

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
