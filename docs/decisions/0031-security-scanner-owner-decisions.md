# ADR 0031: Purge protection on, Microsoft-managed keys, and no private endpoints

**Status:** Accepted
**Decision date:** 2026-09-14
**Owners:** Workload owner

## Context

Qlty's security view on `main` listed 19 open findings from checkov and trivy.
Seventeen were Terraform rows that
[scanner triage](../security/scanner-triage.md) had parked under *Needs owner
decision* because each costs money, cannot be undone, or both. The owner's
direction was to clear them with real changes where a real change exists, and
to record a decision wherever the answer is no, so no finding stays open
without one.

The owner decided each group on 2026-09-14:

| Group | Findings | Decision |
| --- | --- | --- |
| Key Vault purge protection | checkov CKV_AZURE_110, CKV_AZURE_42, trivy AZU-0016 (skipped until now under ADR 0021) | **On** |
| Customer-managed keys | checkov CKV2_AZURE_1 (x2), CKV_AZURE_100 | **No.** Keep Microsoft-managed keys |
| Private endpoints | checkov CKV2_AZURE_33, CKV2_AZURE_32 | **No** |
| Public network access disabled | checkov CKV_AZURE_59, CKV_AZURE_101 | Turn it off where the existing service-endpoint design allows |
| Storage infrastructure encryption | trivy AZU-0061 (x2) | **No.** Keep the current accounts |
| Function host storage geo-redundancy | checkov CKV_AZURE_206, trivy AZU-0058 | **Yes** |
| Storage resource logs | checkov CKV_AZURE_33 (x2), CKV2_AZURE_21, trivy AZU-0057 | **Yes** |
| Flex zone redundancy and always-ready instances | checkov CKV_AZURE_212, CKV_AZURE_225 | **No** |

## Purpose and decision drivers

- **Recoverability of the secrets.** Purge protection closes the gap
  [ADR 0021](0021-key-vault-purge-protection.md) accepted. With it off, a
  principal that can delete the vault can also purge it. The estate has not
  moved region since 2026-08-19, which was ADR 0021's first revisit trigger.
- **Cost against a USD 150/month budget.** Private endpoints, private DNS and
  always-ready instances are standing charges for a single-region,
  single-environment site.
- **No one-way changes without a need.** CMK on an existing Cosmos account is
  irreversible, and losing the key locks the data. Infrastructure encryption
  can be set only when an account is created.
- **Alerts must keep working.** The Log Analytics workspace caps ingestion at
  0.25 GB/day, and a tripped cap stops the log alert rules.

## Decision

1. **Key Vault purge protection is on.** `var.purge_protection_enabled`
   defaults to `true`. This supersedes ADR 0021. The inline skips for
   CKV_AZURE_110, CKV_AZURE_42 and AZU-0016 are removed, because those checks
   now pass.
2. **Encryption at rest stays on Microsoft-managed keys** for both storage
   accounts and Cosmos. CKV2_AZURE_1 and CKV_AZURE_100 are skipped inline,
   citing this record.
3. **No private endpoints.** The service firewalls stay:
   - Key Vault `network_acls`, Cosmos `virtual_network_rule`, and storage
     `network_rules` all default to Deny;
   - each admits the Functions integration subnet through its service
     endpoint (`infra/network.tf`).

   CKV2_AZURE_33 (content storage) and CKV2_AZURE_32 are skipped inline.
4. **Public network access stays *enabled* at the resource level, because
   `Disabled` would also refuse the service-endpoint traffic the app uses.**
   On Storage, Key Vault and Cosmos, `publicNetworkAccess = Disabled` allows
   private endpoint traffic only. A subnet rule reaches the service on its
   public endpoint and is refused along with everything else. Without private
   endpoints (decision 3), turning it off takes the site down.
   - "Where possible" is therefore already the live state: every data service
     is set to *selected networks*, and every operator IP list is empty in
     steady state.
   - CKV_AZURE_59 (content storage) and CKV_AZURE_101 are skipped inline.
5. **Infrastructure encryption is not added.** Both storage accounts are kept.
   AZU-0061 is ignored inline on each.
6. **The Function host storage account moves from LRS to GRS.** This is an
   in-place settings update. Timer schedule status, singleton and listener
   leases, and in-flight queue messages survive a regional loss. The cost is
   cents a month on an account holding a few MB.
7. **Storage resource logs go to Log Analytics** through Azure Monitor
   diagnostic settings (`infra/observability.tf`):
   - **content storage queues:** read, write and delete;
   - **host storage queues:** read, write and delete;
   - **host storage blobs:** write and delete only.

   The checks cannot see a diagnostic setting:
   - CKV_AZURE_33 and trivy AZU-0057 read only classic `queue_properties.logging`.
     Terraform writes that through the storage data plane, which the firewall
     closes to Terraform Cloud's runners.
   - CKV2_AZURE_21 passes only with `azurerm_log_analytics_storage_insights`,
     which reads classic logs with an account key, and the keys are disabled.

   These are skipped inline, each naming the diagnostic setting that does the
   job.
8. **Host storage blob *reads* are not logged.** This was measured on
   2026-09-14 (Transactions by ApiName, one day):
   - reads: about 573,000 a day, all the host's own OAuth traffic (GetBlob
     409,304, GetBlobProperties 139,323, ListContainers 24,966);
   - writes and deletes: about 20,000 a day.

   At the workspace's 1.08 KB average row, reads alone come to about
   0.6 GB/day. The workspace ingested 0.107 GB/day that week against its 0.25 GB
   cap, so logging reads would trip the cap every day and silence
   `function_http_5xx` and `function_response_time`. The CKV2_AZURE_21 skip on
   `function_releases` records this.
9. **No zone redundancy and no always-ready instances** on Flex Consumption.
   FC1 has no `worker_count`. Zone redundancy there forces at least two
   always-ready instances, about USD 40/month. CKV_AZURE_212 and CKV_AZURE_225
   are skipped inline.

## Consequences and accepted risks

- **Purge protection is permanent.** Azure refuses to turn it off. A deleted
  vault stays soft-deleted for 90 days: it can't be purged, and its name stays
  reserved. A future rebuild must recover the vault, not recreate it. Setting
  the variable back to `false` produces a failed apply.
- **Microsoft holds the encryption keys.** Data is still encrypted at rest with
  256-bit AES. What is given up is customer control of key rotation and
  revocation.
- **Data services keep public endpoints behind firewalls.** A firewall
  misconfiguration, not a missing DNS record, is the failure mode to watch.
  The subnet rules and empty operator IP lists are the control.
- **Single-layer encryption at rest** on both storage accounts.
- **Host storage reads leave no per-request log.** Writes, deletes, leases and
  container changes do. Transaction metrics by ApiName still count the reads.
- **Single-zone Function App.** A zone outage in centralus is an outage of the
  API until Azure restores the zone.
- **Log ingestion rises by about 32 MB/day,** to roughly 56% of the cap. That
  is under the 80% `logs_daily_cap` alert. Confirm after apply with the daily
  usage query in that rule.

## Alternatives considered

- **Private endpoints for Storage, Key Vault and Cosmos.** Rejected by the
  owner on standing cost and DNS ordering. They would make decision 4 possible.
- **CMK with purge protection.** Rejected. The owner took the purge protection
  half on its own, since CMK needs it anyway, and declined the key-loss failure
  mode.
- **New storage accounts with infrastructure encryption, then migrate.**
  Rejected for the migration risk on accounts guarded by `prevent_destroy`.
- **Host blob reads to a storage-account archive rather than Log Analytics.**
  Deferred. It avoids the cap, but it was not verified that Azure Monitor can
  write diagnostic logs to an account with shared-key access disabled. It also
  adds a third storage account with its own scanner findings.
- **Raising the Log Analytics cap to fit host blob reads.** Rejected. About
  0.6 GB/day more ingestion would cost more than the always-ready instances
  declined above, to log the host reading its own state.

## Validation and revisit triggers

- **Validation:**
  - `az keyvault show -n kv-site-prod-cus-01 -o json` shows
    `properties.enablePurgeProtection` as `true`.
  - `az storage account show -n stsitefuncprodcus01 -g rg-web-site-prod-cus -o json`
    shows `sku.name` as `Standard_GRS`.
  - `az monitor diagnostic-settings list` on each storage account's
    `queueServices/default`, and on the host account's `blobServices/default`,
    lists the settings above.
  - checkov and trivy report no failures on `infra/`, and Qlty's security view
    shows none of the findings in the table above.
- **Revisit when:**
  - private endpoints become affordable or required (that also reopens
    decision 4);
  - a compliance obligation names CMK or infrastructure encryption;
  - the log cap is raised for another reason, which reopens host blob reads;
  - the API gains an availability target a single zone cannot meet.

## Related decisions and references

- Supersedes [ADR 0021](0021-key-vault-purge-protection.md)
- [ADR 0008](0008-selective-private-link.md): service firewalls instead of
  Private Link
- [ADR 0025](0025-cosmos-firewall-datacenter-sentinel.md): the Cosmos firewall
- [Security scanner triage](../security/scanner-triage.md)
- `infra/storage.tf`, `infra/keyvault.tf`, `infra/cosmos.tf`,
  `infra/functionapp.tf`, `infra/observability.tf`, `infra/variables.tf`
