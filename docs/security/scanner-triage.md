# Security scanner triage

One row per finding the security scanners reported on `main` at `357114f4`
(after #565), with the verdict, the evidence, and what resolves it. Issue
[#567](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/567).

A suppression in a scanner's own file, or in an inline comment, points back to
the section of this page it belongs to. **A new suppression needs a new row
here first.** Anything paid or irreversible stays unsilenced until the owner
decides, and is listed under [Needs owner decision](#needs-owner-decision).

## Counts

Qlty CLI 0.644.0, `qlty check --all --filter <plugin> --no-formatters`, run
locally on 2026-09-14. zizmor also runs directly as `uvx zizmor --offline
.github/workflows` (1.30.1), and its counts agree.

| Scanner | Before | Fixed | False positive | Accepted | Needs owner decision | After |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zizmor | 36 | 36 | 0 | 0 | 0 | **0** |
| checkov | 36 | 3 | 10 | 10 | 13 | **13** |
| trivy | 6 | 0 | 1 | 1 | 4 | **4** |
| bandit | 7 | 2 | 0 | 5 | 0 | **0** |
| gitleaks | 9 | 0 | 9 | 0 | 0 | **0** |
| radarlint-iac | 19 | 0 | 19 | 0 | 0 | **19** |
| osv-scanner | 0 | 0 | 0 | 0 | 0 | **0** |
| trufflehog | 0 | 0 | 0 | 0 | 0 | **0** |
| **Total** | **113** | **41** | **39** | **16** | **17** | **36** |

What "After" still counts:

- **checkov 13 and trivy 4** are the rows under
  [Needs owner decision](#needs-owner-decision). They stay visible on purpose.
- **radarlint-iac 19** are false positives, and the one place that can
  silence them is `.qlty/qlty.toml`, which #568 (PR #581) owns. The rule to
  add is in [radarlint-iac](#radarlint-iac).

Verdicts:

- **Fixed:** changed in this PR, so the scanner no longer reports it.
- **False positive:** the scanner is wrong about the code, with the evidence.
- **Accepted:** the scanner is right about the shape, and the risk is taken on
  purpose, either under a recorded owner decision or for the reason given.
- **Needs owner decision:** a real gap whose fix costs money or cannot be
  undone. Nothing in Terraform changes until the owner decides.

## zizmor

### artipacked (19, medium): fixed

`actions/checkout` writes the job's `GITHUB_TOKEN` into `.git/config`, where
any later step, or an uploaded artifact that includes the workspace, can read
it. Each checkout now sets `persist-credentials: false`.

Every job was checked for a later step that needs the persisted credential:
`git push`, `git fetch`/`pull`, `gh` driven by the checkout credential,
`EndBug/add-and-commit`, `peter-evans/*`. None was found. The `git diff`
calls in `ci.yml`, `codeql.yml` and `iac-validate.yml` read the local clone
(`fetch-depth: 0`), and need no credential. The two jobs that do push
(`publish-content-manifest.yml` and `update-learn-catalogue.yml`, second
job each) already used `persist-credentials: false` and push with an app token.

| Rule | File:line | Verdict | Resolution |
| --- | --- | --- | --- |
| artipacked | `.github/workflows/audit-published-pages.yml:40` | Fixed | This PR |
| artipacked | `.github/workflows/ci.yml:92` | Fixed | This PR |
| artipacked | `.github/workflows/ci.yml:171` | Fixed | This PR |
| artipacked | `.github/workflows/codeql.yml:69` | Fixed | This PR |
| artipacked | `.github/workflows/dependency-review.yml:32` | Fixed | This PR |
| artipacked | `.github/workflows/deploy-azure-frontend.yml:149` | Fixed | This PR |
| artipacked | `.github/workflows/deploy-azure-frontend.yml:355` | Fixed | This PR |
| artipacked | `.github/workflows/deploy-functions.yml:62` | Fixed | This PR |
| artipacked | `.github/workflows/docs-pages.yml:48` | Fixed | This PR |
| artipacked | `.github/workflows/heal-computed-properties.yml:62` | Fixed | This PR |
| artipacked | `.github/workflows/iac-validate.yml:61` | Fixed | This PR |
| artipacked | `.github/workflows/iac-validate.yml:147` | Fixed | This PR |
| artipacked | `.github/workflows/monitor-deploy-drift.yml:102` | Fixed | This PR |
| artipacked | `.github/workflows/monitor-deploy-drift.yml:133` | Fixed | This PR |
| artipacked | `.github/workflows/monitor-unresolved-secrets.yml:72` | Fixed | This PR |
| artipacked | `.github/workflows/publish-content-manifest.yml:133` | Fixed | This PR |
| artipacked | `.github/workflows/repository-policy.yml:18` | Fixed | This PR |
| artipacked | `.github/workflows/tfc-plan-check.yml:95` | Fixed | This PR |
| artipacked | `.github/workflows/update-learn-catalogue.yml:79` | Fixed | This PR |

### template-injection (17, informational): fixed

All 17 were in `deploy-functions.yml`: repository variables
(`vars.RESOURCE_GROUP`, `vars.FUNCTIONS_STORAGE_ACCOUNT`,
`vars.FUNCTION_APP_NAME`, `vars.APP_HOSTNAME`, `vars.FUNCTIONS_URL`) and one
step output (`steps.fw.outputs.runner_ip`, the runner's public IP as an
external service reported it), expanded inside `run:`. They now reach the
script through step `env:` as `RG`, `SA`, `APP`, `RUNNER_IP`, `APP_HOSTNAME`
and `FUNCTIONS_URL`, the names the other steps in that file already use. The
unflagged `${{ github.run_id }}` in the same steps is now the runner's
`GITHUB_RUN_ID`, so no `${{ }}` is left in those scripts. The commands run
with the same values.

| Rule | File:line | Step | Verdict | Resolution |
| --- | --- | --- | --- | --- |
| template-injection | `.github/workflows/deploy-functions.yml:131` | Open storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:132` | Open storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:136` | Open storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:137` | Open storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:304` | Close storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:305` | Close storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:308` | Close storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:309` | Close storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:310` | Close storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:312` | Close storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:313` | Close storage firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:346` | Open origin firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:347` | Open origin firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:355` | Post-deploy smoke test | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:390` | Post-deploy smoke test | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:402` | Close origin firewall window | Fixed | This PR |
| template-injection | `.github/workflows/deploy-functions.yml:403` | Close origin firewall window | Fixed | This PR |

### unpinned-uses (#562): not reproduced

zizmor reports no `unpinned-uses`. All 62 `uses:` lines in every tracked YAML
file are pinned to a 40-character commit SHA. That covers the workflows,
`copilot-setup-steps.yml` and the rest of `.github/`. The repository has no
composite actions (no `action.yml` or `action.yaml`). Closes #562.

## checkov

Inline suppressions are `#checkov:skip=RULE:reason` on the Terraform resource,
or `# checkov:skip=RULE:reason` (YAML comment spacing) on the
`workflow_dispatch:` key of the workflow. Checkov accepts both spellings. The one repository-wide skip is in
`.checkov.yaml`, with its reason.

### workflow_dispatch inputs, CKV_GHA_7 (6): accepted

CKV_GHA_7 is a SLSA build-integrity rule: "workflow_dispatch inputs MUST be
empty". None of these workflows builds a release artifact from its inputs, and
every input reaches its script only through `env:`, never through `${{ }}`
inside `run:`. Only people with write access can dispatch a workflow.

| Rule | File:line | Verdict | Evidence | Resolution |
| --- | --- | --- | --- | --- |
| CKV_GHA_7 | `.github/workflows/audit-published-pages.yml:16` | Accepted | Read-only page audit. `only` is a path prefix and `strict` a boolean, both via env. | Inline skip, this PR |
| CKV_GHA_7 | `.github/workflows/deploy-azure-frontend.yml:56` | Accepted | Break-glass `entra_client_id_override` is refused unless it matches the GUID pattern, before it is printed or built in. Runbook: [Admin sign-in rollback](../runbooks/admin-signin-rollback.md). | Inline skip, this PR |
| CKV_GHA_7 | `.github/workflows/heal-computed-properties.yml:39` | Accepted | `mode` is a `choice` of `apply` or `inspect`, passed via env as one flag. | Inline skip, this PR |
| CKV_GHA_7 | `.github/workflows/monitor-deploy-drift.yml:83` | Accepted | Read-only monitor. `scripts/check-deploy-drift.mjs` refuses a threshold that is not a positive number. | Inline skip, this PR |
| CKV_GHA_7 | `.github/workflows/monitor-unresolved-secrets.yml:51` | Accepted | Read-only monitor on the Reader identity. App and resource group names go via env into a quoted ARM URL. | Inline skip, this PR |
| CKV_GHA_7 | `.github/workflows/tfc-plan-check.yml:74` | Accepted | Read-only plan check. `scripts/check-tfc-plan.mjs` validates the run id against `^[A-Za-z0-9]{8,}$`, and uses the commit only for comparison, never in a URL. | Inline skip, this PR |

### Terraform (29)

Infra files at `357114f4`. Owner decisions were read from `infra/variables.tf`
and `docs/decisions/` before any verdict.

| Rule | File:line | Resource | Verdict | Reason and evidence | Resolution |
| --- | --- | --- | --- | --- | --- |
| CKV2_AZURE_47 | `infra/storage.tf:363` | `azurerm_storage_account.functions` | Fixed | Anonymous blob access was left at the provider default (true). No container on the account is anonymous, so `allow_nested_items_to_be_public = false` is free, in place and reversible. The content account already sets it. | This PR |
| CKV_AZURE_190 | `infra/storage.tf:363` | `azurerm_storage_account.functions` | Fixed | Same change as above. | This PR |
| CKV_AZURE_132 | `infra/cosmos.tf:20` | `azurerm_cosmosdb_account.hcw` | Fixed | `access_key_metadata_writes_enabled = false`. Local auth is already off, so nothing live changes. It keeps schema writes on Resource Manager if keys are ever switched back on. Free, in place, reversible. | This PR |
| CKV_AZURE_140 | `infra/cosmos.tf:20` | `azurerm_cosmosdb_account.hcw` | False positive | `local_authentication_enabled = !var.cosmos_local_auth_disabled`, and the variable defaults to `true`. checkov cannot evaluate the negation. | Inline skip, this PR |
| CKV_AZURE_110 | `infra/keyvault.tf:19` | `azurerm_key_vault.hcw` | Accepted | Purge protection is off by owner decision 2026-08-24: [ADR 0021](../decisions/0021-key-vault-purge-protection.md) and `var.purge_protection_enabled`. | Inline skip, this PR |
| CKV_AZURE_42 | `infra/keyvault.tf:19` | `azurerm_key_vault.hcw` | Accepted | "Recoverable" means purge protection plus soft delete. Soft delete is 90 days. Same decision, [ADR 0021](../decisions/0021-key-vault-purge-protection.md). | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:151` | `azurerm_storage_container.blogs` | False positive | Blob read logging is on for the whole content account: `azurerm_monitor_diagnostic_setting.content_blob` (`infra/observability.tf`) sends StorageRead, StorageWrite and StorageDelete to Log Analytics. checkov looks only for `azurerm_log_analytics_storage_insights`. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:157` | `azurerm_storage_container.covers` | False positive | As above. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:163` | `azurerm_storage_container.certifications` | False positive | As above. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:169` | `azurerm_storage_container.speakerevents` | False positive | As above. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:175` | `azurerm_storage_container.content` | False positive | As above. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:186` | `azurerm_storage_container.listenandlearn` | False positive | As above. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:199` | `azurerm_storage_container.podcast` | False positive | As above. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:225` | `azurerm_storage_container.cosmos_export` | False positive | As above. | Inline skip, this PR |
| CKV2_AZURE_33 | `infra/storage.tf:363` | `azurerm_storage_account.functions` | Accepted | [ADR 0008](../decisions/0008-selective-private-link.md) accepts public endpoints on Function host storage. The network rules default to Deny and allow the integration subnet. | Inline skip, this PR |
| CKV_AZURE_59 | `infra/storage.tf:363` | `azurerm_storage_account.functions` | Accepted | Same decision. Disabling the public endpoint also closes the per-run firewall window `deploy-functions.yml` uploads through. | Inline skip, this PR |
| CKV2_AZURE_21 | `infra/storage.tf:449` | `azurerm_storage_container.function_releases` | Needs owner decision | The Function host account has no diagnostic setting. Adding one puts StorageRead on the Log Analytics bill, and the workspace has a 0.25 GB/day cap. | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_33 | `infra/storage.tf:49` | `azurerm_storage_account.hcw` | Needs owner decision | Queue logging. A `queueServices` diagnostic setting costs Log Analytics ingestion. Classic `queue_properties.logging` is not an option, because the provider writes it through the shared-key data plane and shared keys are off. | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_33 | `infra/storage.tf:363` | `azurerm_storage_account.functions` | Needs owner decision | As above. The host runtime's own queues would be logged, which is high volume. | See [Needs owner decision](#needs-owner-decision) |
| CKV2_AZURE_33 | `infra/storage.tf:49` | `azurerm_storage_account.hcw` | Needs owner decision | Private endpoint for content storage. [ADR 0008](../decisions/0008-selective-private-link.md) chose one, the estate does not have one, and T-504 used service firewalls instead. Private endpoints and DNS are billed hourly. | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_59 | `infra/storage.tf:49` | `azurerm_storage_account.hcw` | Needs owner decision | Public network access disabled. Needs the private endpoint above first, because default Deny plus the subnet rule is what serves today. | See [Needs owner decision](#needs-owner-decision) |
| CKV2_AZURE_1 | `infra/storage.tf:49` | `azurerm_storage_account.hcw` | Needs owner decision | Customer-managed key. Adds Key Vault key operations and a key-loss failure mode that locks the data. | See [Needs owner decision](#needs-owner-decision) |
| CKV2_AZURE_1 | `infra/storage.tf:363` | `azurerm_storage_account.functions` | Needs owner decision | As above. | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_206 | `infra/storage.tf:363` | `azurerm_storage_account.functions` | Needs owner decision | Host storage is LRS. The content account moved to RA-GRS under T-706. Geo-redundancy roughly doubles the per-GB rate. The host state can be rebuilt by a redeploy. | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_101 | `infra/cosmos.tf:20` | `azurerm_cosmosdb_account.hcw` | Needs owner decision | Public network access disabled. Needs a private endpoint, which is billed. Today the service firewall allows the integration subnet and admin IPs only ([ADR 0025](../decisions/0025-cosmos-firewall-datacenter-sentinel.md)). | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_100 | `infra/cosmos.tf:20` | `azurerm_cosmosdb_account.hcw` | Needs owner decision | Customer-managed key. On an existing account it is a one-way change and needs a Key Vault key plus an identity. | See [Needs owner decision](#needs-owner-decision) |
| CKV2_AZURE_32 | `infra/keyvault.tf:19` | `azurerm_key_vault.hcw` | Needs owner decision | Private endpoint for Key Vault. ADR 0008 chose one, but the vault uses `network_acls` default Deny plus the subnet rule. Private endpoints are billed. | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_212 | `infra/functionapp.tf:13` | `azurerm_service_plan.hcw` | Needs owner decision | Minimum instances for failover. On Flex Consumption that means always-ready instances, about USD 20/month each for 2048 MB (the comment in `infra/functionapp.tf`). | See [Needs owner decision](#needs-owner-decision) |
| CKV_AZURE_225 | `infra/functionapp.tf:13` | `azurerm_service_plan.hcw` | Needs owner decision | Zone redundancy. On Flex it forces at least two always-ready instances, so it is decided together with the row above. | See [Needs owner decision](#needs-owner-decision) |

### Secrets (1)

| Rule | File:line | Verdict | Evidence | Resolution |
| --- | --- | --- | --- | --- |
| CKV_SECRET_6 | `scripts/docs/wiki-redirects.json:69` | False positive | The flagged string is the Wiki page name `Variables-And-Secrets`. It is the entropy heuristic, and the file maps retired page names to docs paths. JSON cannot take an inline skip, and checkov ignores `skip-path` when Qlty hands it single files. So `.checkov.yaml` skips CKV_SECRET_6, the entropy rule only. Secret detection stays with gitleaks, trufflehog and checkov's format-specific secret rules. | `.checkov.yaml`, this PR |

## trivy

Inline suppressions are `#trivy:ignore:AVD-AZU-NNNN` on the line above the
finding. No `.trivyignore` is needed.

| Rule | File:line | Verdict | Reason and evidence | Resolution |
| --- | --- | --- | --- | --- |
| AZU-0016 | `infra/keyvault.tf:26` | Accepted | Purge protection off, owner decision 2026-08-24, [ADR 0021](../decisions/0021-key-vault-purge-protection.md). Same as checkov CKV_AZURE_110. | Inline ignore, this PR |
| AZU-0057 | `infra/storage.tf:49` | False positive | trivy reads only classic `queue_properties.logging`. Blob resource logs for this account go to Log Analytics through `azurerm_monitor_diagnostic_setting.content_blob`. | Inline ignore, this PR |
| AZU-0057 | `infra/storage.tf:363` | Needs owner decision | The Function host account has no logging of any kind. Same decision as checkov CKV_AZURE_33 and CKV2_AZURE_21 on this account. | See [Needs owner decision](#needs-owner-decision) |
| AZU-0061 | `infra/storage.tf:49` | Needs owner decision | Infrastructure encryption can be set only when an account is created. On this account it means a new account and a data migration. The account has `prevent_destroy`. | See [Needs owner decision](#needs-owner-decision) |
| AZU-0061 | `infra/storage.tf:363` | Needs owner decision | As above, on the Function host account. | See [Needs owner decision](#needs-owner-decision) |
| AZU-0058 | `infra/storage.tf:368` | Needs owner decision | Host storage is not geo-redundant. Same decision as checkov CKV_AZURE_206. | See [Needs owner decision](#needs-owner-decision) |

## bandit

Developer tooling that Claude Code runs on the owner's machine and that CI
smoke-tests (`ci.yml`, harness job). No argument comes from outside the
repository.

| Rule | File:line | Verdict | Reason and evidence | Resolution |
| --- | --- | --- | --- | --- |
| B404 | `hooks/claude_event.py:14` | Accepted | Importing `subprocess` is the finding. Every call below it uses a list argv and never `shell=True`. | `# nosec B404` with the reason, this PR |
| B607 | `hooks/claude_event.py:30` | Fixed | `git` was resolved from `PATH` at call time. It is now resolved once with `shutil.which("git")` and passed as an absolute path. When git is missing, the hook takes the existing no-git fallback. | This PR |
| B603 | `hooks/claude_event.py:30` | Accepted | Constant argv `rev-parse --show-toplevel`. | `# nosec B603` with the reason, this PR |
| B603 | `hooks/claude_event.py:87` | Accepted | Runs `sys.executable` on the repository's own `tooling/workflow.py`. The workflow id is one argv element read from the repository's state file, with no shell. | `# nosec B603` with the reason, this PR |
| B404 | `tooling/workflow.py:26` | Accepted | As for the hook. | `# nosec B404` with the reason, this PR |
| B607 | `tooling/workflow.py:54` | Fixed | As for the hook. | This PR |
| B603 | `tooling/workflow.py:54` | Accepted | Constant argv. | `# nosec B603` with the reason, this PR |

## gitleaks

All nine are `generic-api-key`, and each was read in full before it was
silenced. None is printed here. Fingerprints are in `.gitleaksignore`.

| Rule | File:line | Verdict | Evidence | Resolution |
| --- | --- | --- | --- | --- |
| generic-api-key | `frontend/data/content-manifest.json:407` | False positive | A Firebase Storage download URL (`firebasestorage.googleapis.com/v0/b/.../o/...?alt=media&token=...`) for an image the public site already serves. The token grants read on that one public object. | `.gitleaksignore`, this PR |
| generic-api-key | `frontend/data/content-manifest.json:830` | False positive | As above. | `.gitleaksignore`, this PR |
| generic-api-key | `frontend/data/content-manifest.json:831` | False positive | As above. | `.gitleaksignore`, this PR |
| generic-api-key | `frontend/src/pages/NewsletterConfirmPage.test.jsx:16` | False positive | Test fixture. Its two base64url parts decode to `{"v":1}` and `signature`. | `.gitleaksignore`, this PR |
| generic-api-key | `functions/local.settings.json.example:7` | False positive | `COSMOS_KEY` is the Azure Cosmos DB emulator's published well-known key, byte for byte, next to `COSMOS_ENDPOINT` `https://localhost:8081/`. | `.gitleaksignore`, this PR |
| generic-api-key | `scripts/cutover/01-entra-api.ps1:51` | False positive | `$ApiAppId` default: the Entra API application (client) id. It is an identifier, not a credential. | `.gitleaksignore`, this PR |
| generic-api-key | `scripts/cutover/02-entra-spa-client.ps1:75` | False positive | As above. | `.gitleaksignore`, this PR |
| generic-api-key | `scripts/cutover/03-entra-dev-client.ps1:61` | False positive | As above. | `.gitleaksignore`, this PR |
| generic-api-key | `scripts/rollback/restore-admin-signin.ps1:60` | False positive | As above. | `.gitleaksignore`, this PR |

A filesystem fingerprint is `path:rule:line`. `publish-content-manifest.yml`
regenerates the manifest weekly, so its three lines move. When they
reappear, check that the new lines are the same URL shape, then move the
fingerprints. A `.gitleaks.toml` allowlist keyed on the URL shape would
survive regeneration, but Qlty's gitleaks plugin did not read one when tested,
so it was not added.

## radarlint-iac

All 19 are S1135, "Complete the task associated to this TODO comment". Each
match is the file name `TODO.md` inside an explanatory comment, such as
`see TODO.md T-520` or `(TODO.md)`. None is a TODO marker.

| Rule | File:line | Verdict | Resolution |
| --- | --- | --- | --- |
| terraform:S1135 | `infra/cosmos.tf:111` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/cosmos.tf:333` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:254` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:327` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:338` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:406` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:463` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:586` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:624` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:680` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:732` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/functionapp.tf:820` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/keyvault.tf:38` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/observability.tf:3` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/oidc.tf:22` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/oidc.tf:488` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/outputs.tf:241` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/outputs.tf:247` | False positive | Qlty triage rule below |
| terraform:S1135 | `infra/variables.tf:107` | False positive | Qlty triage rule below |

radarlint has no inline suppression, and its only configuration is
`.qlty/qlty.toml`. That file is owned by #568 (PR #581), so the rule belongs
there rather than in a second copy:

```toml
[[triage]]
match.plugins = ["radarlint-iac"]
match.rules = ["terraform:S1135"]
match.file_patterns = ["infra/**"]
set.ignored = true
```

Open work lives in GitHub issues (owner decision 2026-09-05). A real TODO in
`infra/` would name an issue number, not a TODO marker, so silencing S1135
there hides nothing the repository relies on.

## Needs owner decision

These stay unsilenced, and nothing in Terraform changes for them in this PR.
Each is paid, irreversible, or both. Rows that share a decision are grouped.

| Decision | Findings | Cost or irreversibility |
| --- | --- | --- |
| Private endpoints for content storage, Key Vault and Cosmos, then public network access off | checkov CKV2_AZURE_33 (`hcw`), CKV_AZURE_59 (`hcw`), CKV2_AZURE_32, CKV_AZURE_101 | Hourly endpoint charges, private DNS zones and data processing. Deployment ordering becomes an operational duty ([ADR 0008](../decisions/0008-selective-private-link.md)). |
| Customer-managed keys for storage and Cosmos | checkov CKV2_AZURE_1 (x2), CKV_AZURE_100 | Key Vault key operations. Losing the key locks the data. One-way on the existing Cosmos account. |
| Storage infrastructure (double) encryption | trivy AZU-0061 (x2) | Set only at account creation, so a new account and a migration. Both accounts have `prevent_destroy`. |
| Function host storage geo-redundancy | checkov CKV_AZURE_206, trivy AZU-0058 | About twice the per-GB rate, for state a redeploy rebuilds. |
| Storage resource logs for queues, and for the host account | checkov CKV_AZURE_33 (x2), CKV2_AZURE_21 (`function_releases`), trivy AZU-0057 (`functions`) | Log Analytics ingestion against the 0.25 GB/day cap. Host runtime queue traffic is high volume. |
| Flex Consumption zone redundancy and always-ready instances | checkov CKV_AZURE_212, CKV_AZURE_225 | About USD 20/month per 2048 MB always-ready instance, with at least two once zone redundant. Against a USD 150 platform budget. |
