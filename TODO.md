# TODO

**The accepted-risk record for the HybridCloudWorks website, and the index to
where the open work lives.** Engineering work, owner decisions, production
approvals, credentials, external access and live-environment operations are
GitHub issues; verified completion belongs in [CHANGELOG.md](CHANGELOG.md), and
the required-inputs inventory is [Required-Inputs](docs/standards/required-inputs.md) on
the docs site.

**Open work is tracked in GitHub issues as of 2026-09-05.** Owner decision:
the remaining items were moved to the issues list so they can be worked from
there, and this file now holds only what is not work — the accepted risks
below, which are decisions to live with something and must stay written down —
plus the pointers that follow. The tracked findings (`T-` items), the attack
sequence and the owner-decision record all closed by 2026-09-05 and moved to
the changelog.

## Where the open items live

The board: https://github.com/orgs/HybridCloudWorks/projects/1 — every open
issue, with a Priority (`P1 now` / `P2 next` / `P3 later` / `Gated`). The
issues list behind it: https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues

| Label | Meaning |
| --- | --- |
| `owner-gated` | Needs the owner: a credential, a console action, or a spend decision |
| `live-check` | Needs an authorized operator against the deployed estate; several come due only on an external trigger and stay open as standing checklists |
| `podcast` | Podcast hosting, generation and the podcast pages |

| Item | Issue |
| --- | --- |
| Audio pipeline parent: sources, transcript, voice, RSS.com publish; owner steps after the 2026-09-09 merges | [#432](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/432) |
| Listen & Learn grounded on owner-supplied pages and videos: owner-run live generation closes it | [#433](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/433) |
| Plaud recording to episode script: owner-run "Script this" on a connected Plaud closes it | [#434](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/434) |
| Published article to podcast transcript: article-side player still to come | [#435](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/435) |
| ElevenLabs speech provider: seed the key, one-certification trial closes it | [#436](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/436) |
| One Recording Hub: season and per-episode metadata editing still to come | [#442](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/442) |
| Replace Podbean: RSS.com show live once the first pipeline episode publishes; Listen & Learn on the show still a decision | [#349](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/349) |
| Live check: third-party webhooks after an approved mutation test (Publer blocked on a rotated key) | [#358](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/358) |
| Functions deploy and Terraform apply race on the app-settings map; six settings lost 2026-09-09 | [#454](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/454) |
| Live check: timed Cosmos restore drill against RTO 8 h / RPO 24 h, after the first Sunday full | [#455](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/455) |

`GEMINI-API-KEY` already covers Listen & Learn speech; nothing to provide.

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
- An open item is an issue, and every open issue is on the board at
  https://github.com/orgs/HybridCloudWorks/projects/1. The project's
  auto-add workflow puts each issue on the board when it is opened; the person
  opening it sets its Priority. This file does not carry work; when something
  new is found, open an issue and, if it is a decision to live with a finding,
  record it under Accepted risks here.
- A missing credential is not an engineering task. Record its name, owner, and
  approved storage location only.
- Historical migration pages and the two archived plans are evidence, not
  current instructions for restoring Firebase services.

---

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
