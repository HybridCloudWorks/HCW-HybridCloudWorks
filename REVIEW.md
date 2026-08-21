# REVIEW — the working document

**This is the single document for what needs a human.** It absorbed
`CHECKLIST.md` (required-input inventory) and `Variables.md` (variable and
secret catalogue) on 2026-08-20; both files were deleted, and everything they
contained is below.

**Read Part 1 first.** It lists what is already finished and verified, so the
most expensive mistake available here — redoing completed work, or re-deciding
a settled question — is the one hardest to make.

| Part | What it holds |
| --- | --- |
| **[1](#part-1--done-do-not-redo)** | **Done and verified. Do not redo.** |
| [2](#part-2--decisions-only-you-can-make) | Decisions only you can make |
| [3](#part-3--operator-tasks-not-yet-done) | Provisioning work an operator must perform |
| [4](#part-4--required-inputs) | Required inputs: every variable, secret and setting, with live status |
| [5](#part-5--deferred-not-blocking) | Deferred — real, but nothing waits on them |
| [6](#part-6--historical-record) | Historical record and corrections |

Engineering work an engineer can finish without you is in [TODO.md](TODO.md).
Completed work is in [CHANGELOG.md](CHANGELOG.md).

**Last updated 2026-08-20**, after the centralus rebuild, the origin lock, and
the consolidation of CHECKLIST and Variables into this file.

---

## Status at a glance

| | |
| --- | --- |
| Azure infrastructure | **Deployed** — 129 resources, `centralus`, plan clean |
| Function App code | **80 functions deployed** (2026-08-20) — `/api/health` 200 through Cloudflare, 403 at the origin |
| Terraform authentication | **Working** — `id-plat-terraform-prod-cus-01` |
| HCP Terraform variables | **All 13 set**, plus `cosmos_scratch_enabled` / `storage_scratch_enabled` = `true` (2026-08-20, runbook step 4); `migration_writer_enabled` stays unset = `false` |
| GitHub repository variables | **8 of 8 platform variables set**; the 9 migration variables in §4.2 are not — they wait on the WIF binding and the scratch apply |
| GitHub repository secrets | **1 of 4 set, and that one is moving to variables** — see §4.3 |
| Key Vault | **19 of 21 secrets seeded** — two runtime-read secrets outstanding, §3.1 |
| Origin lock | **On and proven end to end** — anonymous rate-limited route 200 via Cloudflare, 403 at the origin |
| Data migration | **Production import done 2026-08-21** — Cosmos `cosmos-site-prod-cus`: 8,023 documents in 62 containers, 0 failed, reconciled; Blob `stsiteprodcus01`: 1,438 objects / 3.17 GiB, verified. Both locks still open for the delta run before cutover (`migration_writer_enabled`, `PRODUCTION_IMPORT_ENABLED`); close them per the [runbook](.github/wiki/Migration-Runbook.md) step 7. No key on either cloud at any point |

**The single most useful fact in this document:** the public API base is
`https://api-azure.hybridcloudworks.com/api`. The `azurewebsites.net` origin is
firewalled to Cloudflare IP ranges and answers **403** to browsers, CI runners
and your laptop alike. A 403 from a cross-origin fetch reads as an auth or CORS
fault, so this is worth knowing before it costs you an afternoon.

---

# PART 1 — DONE. Do not redo.

Everything in this part was completed and verified. Each entry says what proved
it, because "it should work" and "it was observed working" are different claims.

## 1.1 Infrastructure — deployed, and rebuilt into one region

**Done 2026-08-19.** The estate was torn down and rebuilt to consolidate into
`centralus` and adopt the CAF instance-number convention: 125 destroyed, 125
created, 129 resources in state.

| Resource | Name |
| --- | --- |
| Function App origin | `func-site-prod-cus-01.azurewebsites.net` |
| **Public API base** | **`https://api-azure.hybridcloudworks.com/api`** |
| Static Web App | `stapp-site-prod-cus-01` → `calm-ground-0d0e6a010.7.azurestaticapps.net` |
| Cosmos | `cosmos-site-prod-cus`, database `hcw`, 73 containers |
| Key Vault | `kv-site-prod-cus-01` |
| Storage | `stsiteprodcus01` (content) · `stsitefuncprodcus01` (Functions host) |
| Resource groups | `rg-{web,db,stor,sec,conn}-site-prod-cus`, `rg-mgmt-plat-prod-cus`, `rg-conn-hub-prod-cus` |
| Bootstrap identity | `id-plat-terraform-prod-cus-01` in `rg-mgmt-boot-prod-cus` |

**Proved by:** `terraform plan` → *"No changes."* · a sweep of all three
subscriptions returning zero resources in `southcentralus` · `fmt`, `validate`
and the repository-structure gate all passing · CI green on PR #122 including
tflint and Trivy.

**This supersedes the old §1.1 and §1.2**, which recorded that Terraform had
never been run and no cloud control plane was reachable. Both are now false.
Every infrastructure claim in this repository has been checked against a real
plan.

## 1.2 The bootstrap handshake — Terraform can authenticate

**Done.** `scripts/bootstrap-terraform-oidc.ps1` created
`id-plat-terraform-prod-cus-01`, two federated credentials against
`https://app.terraform.io` (`run_phase:plan` and `run_phase:apply` — Entra
matches subjects exactly, so one credential is not enough), and Contributor +
Role Based Access Control Administrator on all three target subscriptions.

The identity was renamed and moved on 2026-08-20: `id-hcw-terraform` in
`rg-hcw-bootstrap` (southcentralus) broke the naming convention four ways.
The swap ran create → repoint `TFC_AZURE_RUN_CLIENT_ID` → verify a plan
authenticates → strip the old role assignments → delete the old group.
Reversing that order locks the workspace out with `AADSTS70021`.

**Two design decisions worth not re-litigating:**

- **The bootstrap identity is deliberately outside Terraform state.** If
  `infra/` managed the identity it authenticates with, a destroy or a bad plan
  would lock the workspace out irrecoverably. It will therefore never appear in
  a drift plan.
- **Managed identity, not app registration.** App registrations need
  Application Administrator in Entra, which Azure Owner does not grant — the two
  are separate permission planes. A user-assigned managed identity is an
  ordinary Azure resource, so an Azure Owner can build the whole chain with no
  directory role.

**Proved by:** a plan authenticating through the new identity, and Terraform
correctly moving `azurerm_role_assignment.terraform_kv_secrets` to the new
principal.

## 1.3 Variables and secrets — seeded

**HCP Terraform workspace (`hcw/hcw-azure`, project `Site`): all set.** The four
contractual environment variables plus every Terraform variable without a
default. Full inventory in §4.1.

**GitHub repository variables: all seven set**, each sourced from a Terraform
output and cross-checked afterwards. Full inventory in §4.2.

**Key Vault: 19 secrets seeded 2026-08-19** and diffed against the
`@Microsoft.KeyVault(...)` references in `infra/main.tf` — exact match, nothing
missing, nothing stray. Two runtime-read secrets remain outstanding; see §3.1.

The seeding window was opened and closed with `az keyvault network-rule
add/remove`, and access required assigning the operator **Key Vault Secrets
Officer** — RBAC authorization is on, so subscription Owner alone carries no
read or write access to secret data. That surprise is worth remembering.

## 1.4 Security posture — closed by default

| Control | State | Note |
| --- | --- | --- |
| Origin lock (`ip_restriction`) | **On** | 15 Cloudflare ranges + terminating `Deny 0.0.0.0/0`. This closes the old §3.1 |
| Cloudflare origin secret | **On** | `cloudflare_ruleset.origin_secret` stamps `x-hcw-origin-secret` |
| `https_only` | **On** | |
| Key Vault firewall | **Deny** | Functions subnet only, no IP rules |
| Cosmos firewall | **Deny** | Functions subnet only |
| Both storage accounts | **Deny** | Functions subnet + per-run CI window |
| Cosmos key authentication | **Disabled** | `cosmos_local_auth_disabled = true` |
| `prevent_destroy` guards | **On** | Cosmos, both storage accounts, Key Vault |

**The Cosmos key-rotation question is closed by construction.** The old §0.2
asked whether a Cosmos read key had ever been published, and whether rotation
was needed. The account was destroyed and recreated in the rebuild, and key
authentication is disabled on the new one — so no key exists to rotate and none
would work if it did. The old §3.2 ("turn on `local_authentication_disabled`")
is likewise satisfied.

**One caveat on the origin lock.** The IP half is proved: the origin went from
`404` to `403` for a direct call while the Cloudflare path stayed reachable.
The *header* half — Cloudflare stamping `x-hcw-origin-secret` and
`client-identity.js` accepting it — is **structurally verified but not observed
end to end**, because the Function App has no deployed code to observe it. If
anonymous rate-limited endpoints throw after the first deploy, the secret is
mismatched; rollback is `functions_origin_lock_enabled = false`.

## 1.5 Questions that no longer need answering

| Was | Now |
| --- | --- |
| §0.1 Deployment topology — same-origin or cross-origin? | **Settled: cross-origin.** The origin lock makes it the only working shape. `VITE_AZURE_FUNCTIONS_URL` = the Cloudflare base, and `staticwebapp.config.json`'s `connect-src` names the same host |
| §0.2 Was a Cosmos key ever deployed? | **Moot** — account recreated, key auth disabled |
| §0.3 Inspect live container contents | **Moot for now** — all 73 containers are empty. Becomes live again once data migrates |
| §0.6 Republish snapshots after first deploy | **Moot** — no pre-fix data exists to republish. Fresh account |
| §3.2 Turn on Cosmos `local_authentication_disabled` | **Done** — defaults `true` |
| §4.7 Computed-property healer's role grant | **Done** — both `azurerm_cosmosdb_sql_role_assignment` grants are in state |
| §8.2 The approved plan no longer describes the system | **Decided 2026-08-18** — option (b), superseded as-built by ADR-0018 through ADR-0021 |
| CodeQL alerts from `.claude/skills/**` | **Moot** — `.claude/` was removed from the repository on 2026-08-20, so the files that produced every open alert are gone |

---

# PART 2 — DECISIONS ONLY YOU CAN MAKE

These block work. Each says what it unblocks.

## 2.1 Entra provisioning for the VPS agent

**Decided and built — API-only. What remains is provisioning, not a decision.**

The agent holds no database credential. It authenticates to the Functions API
with an Entra certificate credential and can reach exactly three endpoints, each
further constrained server-side. A stolen VPS credential buys those three
operations, not two containers.

Two alternatives were rejected and should stay rejected:

- **A brokered Cosmos resource token is not viable.** Resource tokens are minted
  from the SQL API's users/permissions model, which requires the master key, and
  `disableLocalAuth` admits "only MSI and AAD" — it disables resource tokens
  along with keys. Brokering them would mean the Functions app holds the master
  key permanently.
- **A workload identity via Azure Arc** is viable but was not chosen. It leaves
  the VPS with read/write over both lab containers including other agents' rows,
  and puts an Arc agent on a host you do not fully control.

**What you must provision** — none of it expressible in this repository's
Terraform, because it is Entra directory configuration:

1. An app registration **per agent host**, confidential client, with a
   certificate whose **private key is generated on the VPS and never
   transmitted**.
2. A `LabAgent` App Role on the API app registration, assigned to that
   registration's service principal. Deliberately disjoint from `Admin`.
3. A `lab_agents/{agentId}` document per agent carrying `oid` (the agent service
   principal's object id), `active: true`, and the `capabilities` array
   deciding which job types it may claim — the agent cannot set its own.

Revocation is `active: false` on the registry document, effective on the agent's
next call. There is no cache to wait out.

**Unblocks:** the labs runner path. **Inputs:** §4.7.

## 2.2 Entra SPA registration for admin sign-in

The admin frontend authenticates with Entra via MSAL; `firebase/auth` is gone
from the admin surface. Before any admin can sign in:

1. **Expose an API scope** on the API app registration (the one whose URI is
   `ENTRA_API_AUDIENCE`): *Expose an API → Add a scope*, e.g. `access_as_admin`.
   Full value: `api://<api-app-client-id>/access_as_admin`.
2. **SPA app registration** (or a SPA platform on the same registration):
   *Authentication → Add platform → Single-page application*, redirect URIs =
   the site origins (production + `http://localhost:5173`). Grant delegated
   permission to the scope from step 1 plus openid/profile/email, and
   admin-consent it.
3. **Build variables**: `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_TENANT_ID`,
   `VITE_ENTRA_API_SCOPE`. Without the last, the SPA requests a token the
   backend rejects on audience.
4. **App Roles**: the API registration carries the `Admin` role (guard gate 1) —
   assign it per admin user. Gate 2 is the `admins/{oid}` registry, seeded via
   `CMS_BOOTSTRAP_ALLOWED_UIDS` or `CMS_BOOTSTRAP_ALLOWED_EMAILS`.
5. **MFA** is an Entra Conditional Access policy, not app code.

> **The highest-risk mismatch in the whole system.** If `ENTRA_API_AUDIENCE` and
> `VITE_ENTRA_API_SCOPE` disagree, sign-in *succeeds* and every API call 401s.
> The failure looks like a broken API, not a misconfigured scope.

**Unblocks:** every authenticated endpoint, and the admin UI entirely.

## 2.3 Cloudflare WAF rule for synthetic validation

Every request from a GitHub-hosted runner receives a Cloudflare bot challenge
(403) before reaching the origin. `validate-deployed.yml` can therefore verify
DNS, TLS and that the edge is up — but nothing about the application. Its "admin
guards refuse anonymous callers" check passes **vacuously**: a challenge 403 is
indistinguishable from an application refusal.

**This matters more now than when it was written.** With the origin lock on,
going around Cloudflare is no longer an option — the origin refuses runners too.
The Cloudflare path is the only path, so validating it is the only validation
available.

Standard fix: a WAF custom rule that skips the challenge when a request carries
a secret header, with the secret stored as a GitHub Actions secret the workflow
sends.

**Unblocked by:** creating the rule and repository secret, or deciding synthetic
origin validation is not wanted.

## 2.3b Edge security review — findings, verified against the live estate

An adversarial review of the origin lock, origin secret, hostname binding and
CI challenge-skip was run on 2026-08-20 against published Cloudflare and Azure
guidance. **Every finding below was re-tested against the running system rather
than accepted**, and two of them did not survive that contact intact.

### Fixed the same day

**The origin lock had an unmatched-request hole.** `Deny 0.0.0.0/0` is an IPv4
CIDR, so an IPv6 source matches no rule and falls through to the
unmatched-request action — which was `Allow`, confirmed on the live app while
every IPv4 request was correctly refused. Not demonstrably exploitable (no AAAA
is published and a direct IPv6 attempt failed to connect), but the posture
depended on that staying true, which is not a property this configuration
controls. `ip_restriction_default_action = "Deny"` now says what the rule was
trying to say.

**Static publishing credentials were enabled.** SCM basic auth is now off, so
reaching that endpoint requires an Entra token rather than a username and
password. Costs nothing here — this app deploys with OIDC and has never used a
publish profile.

### Corrected — the review overstated this one

**SCM is reachable, but not anonymously usable.** The review reported the Kudu
site as "publicly reachable... the Kudu console, and the file system", which
tested as too strong: `https://<app>.scm.azurewebsites.net` and
`/api/settings` both return **the Entra sign-in page**, `text/html`, not
content. It is behind directory authentication, and now behind Entra
authentication *only*.

The residual exposure is real but narrower than stated: the endpoint accepts
connections from any IP, so it is a surface for credential attacks rather than
an open door.

### Open, and blocked on a genuine conflict

**SCM cannot simply be IP-restricted, because the deploy runs through it.** The
Flex Consumption deploy logs `Will use Kudu https://<scmsite>/api/publish to
deploy since Flex consumption plan is detected`, and GitHub-hosted runners have
no stable egress IPs. Denying SCM breaks every deploy. Closing it properly needs
one of:

- a per-run SCM firewall window, exactly as the host storage account already
  gets in `deploy-functions.yml`; or
- the self-hosted runner in `infra/ci-runner.tf`, which has a stable address.

The first is a small change to a workflow that already does this once. The
second is §3.5 and costs money.

**FTP basic auth is still enabled** (`ftpsState: FtpsOnly`). The
`azurerm_function_app_flex_consumption` resource exposes no argument for it —
only `webdeploy_publish_basic_authentication_enabled`, which covers SCM. Needs
an `azapi` resource or a CLI step.

### Worth doing, not yet done

| Finding | Why it matters |
| --- | --- |
| **Cloudflare TLS mode is not in code** | No `cloudflare_zone_settings_override` anywhere. The certificate-less hostname binding is only safe under **Full (strict)**; under "Flexible" Cloudflare would speak plain HTTP to an origin with `https_only = true`, producing a redirect loop and bearer tokens in cleartext on the last hop. The invariant is currently assumed, not enforced |
| **Origin-secret rotation is not atomic** | `CF_ORIGIN_SECRET` is a versionless Key Vault reference, and App Service caches those for up to 24h. Rotating flips Cloudflare instantly while the app compares the old value — every anonymous request throws until the cache turns over. Accept a list of valid secrets during overlap |
| **Non-constant-time secret comparison** | `client-identity.js` uses `===`. The comment argues a timing oracle yields nothing an attacker cannot get by reaching the origin directly — which was circular while the origin *was* directly reachable. `timingSafeEqual` is three lines |
| **Allowlisting Cloudflare admits every Cloudflare customer** | Anyone can point a zone at this origin hostname. The origin secret is what makes the design work at all — this is the argument for never weakening it |
| **No IP-range drift detection** | The 15 CIDRs are hardcoded, which is correct — an `http` data source would make `plan` network-dependent and let an upstream change silently rewrite the firewall. What is missing is a scheduled diff against Cloudflare's published list that opens a PR |

### Confirmed sound

- **No ordering problem between the skip rule and the header stamp.**
  `http_request_firewall_custom` is phase 8, `http_request_late_transform` is
  phase 14. The skip passes only `products`, which targets features outside the
  Ruleset Engine, so header stamping is untouched. **If anyone ever adds
  `phases` to that skip and includes the late-transform phase, the origin secret
  silently stops being stamped** and every request starts throwing at the origin.
- **`operation = "set"` rather than `add`** on the header means a
  client-supplied `x-hcw-origin-secret` is overwritten rather than appended.
  Deliberate, and worth keeping.
- **Hardcoded IP ranges are defensible.** Cloudflare adds ranges to the
  published list before putting them into production, so a stale list fails by
  rejecting new Cloudflare egress rather than by admitting strangers.

### The one to weigh properly

The review's strongest structural point: Cloudflare rates IP allowlisting and
header validation as *moderately* secure, and Authenticated Origin Pulls,
Tunnel and mTLS as *very* secure. This design stacks the two moderate ones,
which beats either alone but is not the recommended tier. Flex Consumption
supports inbound private endpoints, so **private endpoint + Cloudflare Tunnel
removes the public origin entirely** and makes most of this section moot. That
is a real architectural option on the current plans, not an enterprise upsell —
worth costing before adding more rules to the current approach.

## 2.4 Enabling the deployment workflows

`deploy-functions` and `migrate-data` are dispatch-only and enabled (both
2026-08-20). `deploy-azure-frontend` and `deploy-infra` are still guarded by
`if: ${{ false }}`; enabling either is a deliberate act in a reviewed PR.

`migrate-data` reads the whole production Firestore database. Its two write
modes (`rehearse`, `storage-rehearse`) refuse `target=production`, and the
deploy identity holds no write role on production until
`migration_writer_enabled` is flipped in Terraform — two independent locks. It
runs in the `data-migration` environment, which must exist **with a required
reviewer** before the first dispatch (§4.4). Creating the environment without
reviewers would satisfy the linter while removing the gate, which is worse than
the current state.

**Unblocks:** the frontend deploy (needs the SWA token, §4.3) and the gated
infra workflow (needs `production-infra`, §4.4). The first `migrate-data`
dispatch needs the environment plus the GCP binding in §4.2.

---

# PART 3 — OPERATOR TASKS NOT YET DONE

Not decisions. Work that needs someone with access.

## 3.1 Two Key Vault secrets are still missing

19 of 21 are seeded. The two outstanding are both **runtime-read** — resolved by
`getSecret()` at execution time rather than through an app-setting
`@Microsoft.KeyVault(...)` reference, because they are multi-line blobs that do
not belong in app settings:

| Secret | Consumed by | Why it is runtime-read |
| --- | --- | --- |
| `GCP-SERVICE-ACCOUNT-JSON` | `gcp.js` | Multi-line JSON blob |
| `GITHUB-APP-PRIVATE-KEY` | site-rebuild trigger | Multi-line RSA PEM signed into a JWT |

They are not in the 19 precisely because the diff that verified those 19 checked
app-setting references, and these two have none. Seed them with `--file`, not
`--value`.

**Names follow §4.0**, and both already do — `UPPER-KEBAB-CASE`, hyphens not
underscores. Neither has an app-setting counterpart to map to, so nothing else
needs to change when they land.

**Seed them only here.** Both are read by the application at runtime, so Key
Vault is the one store that needs them. Neither belongs in GitHub secrets, and
neither belongs in the Terraform workspace — a GitHub App private key in
Terraform state is exactly the blast radius the hand-seeding decision exists to
avoid.

**Neither is urgent.** Their consumers are unported: the site-rebuild trigger
and `gcp.js` are both stubs today. Seed them when you next have a firewall
window open for another reason, rather than opening one for these alone.

**Procedure** — the vault denies by default, so this needs a window:

```bash
VAULT=kv-site-prod-cus-01
RG=rg-sec-site-prod-cus

# 1. Grant yourself data-plane access (once). Subscription Owner is NOT enough.
az role assignment create --role "Key Vault Secrets Officer" \
  --assignee <your-object-id> \
  --scope /subscriptions/<app-sub>/resourceGroups/$RG/providers/Microsoft.KeyVault/vaults/$VAULT

# 2. Open a window
az keyvault network-rule add --name $VAULT --resource-group $RG --ip-address "$(curl -s ifconfig.me)"

# 3. Seed — multi-line, so --file
az keyvault secret set --vault-name $VAULT --name GCP-SERVICE-ACCOUNT-JSON --file ./gcp-sa.json
az keyvault secret set --vault-name $VAULT --name GITHUB-APP-PRIVATE-KEY    --file ./github-app.pem

# 4. Verify, then close
az keyvault secret list --vault-name $VAULT --query "length(@)"   # expect 21
az keyvault network-rule remove --name $VAULT --resource-group $RG --ip-address "$(curl -s ifconfig.me)"
```

Empty `ipRules` is the correct resting state: reachable only by the Function App
over its subnet.

## 3.2 Three GitHub repository secrets are missing

`COSMOS_ENDPOINT` is set and is moving to a variable — `set-github-variables.ps1`
now seeds it there and deletes the secret. `FIREBASE_SERVICE_ACCOUNT_JSON` is
no longer wanted at all (§4.3). What remains: the SWA token, `TF_API_TOKEN`,
and a read token for Site-Main. See §4.3 for what each blocks.

## 3.3 Deploy the function code — DONE 2026-08-20

The first dispatch from `main` deployed 80 functions. It settled all three
questions it was meant to: the rebuilt identity authenticates (after the
ID-embedded OIDC subject fix), the smoke test passes through Cloudflare, and
the origin-secret handshake holds — an anonymous rate-limited route answers 200
through Cloudflare and the same route answers 403 at the origin, asserted on
every deploy since.

What the deploy did **not** prove: `heal-computed-properties.yml`. Its first
run failed with a data-plane 403 on a control-plane call; the identity needs an
ARM role, not a Cosmos one. Engineering item, TODO T-508 — nothing to do here
until `content` holds data.

## 3.3b Stand up the migration prerequisites

Three things only an operator can do, all ahead of the first `migrate-data`
dispatch. Each is a numbered step in the
[Migration-Runbook](.github/wiki/Migration-Runbook.md):

1. **GCP**: a dedicated read-only service account and the Workload Identity
   Federation binding for this repository → `GCP_WORKLOAD_IDENTITY_PROVIDER`,
   `GCP_SERVICE_ACCOUNT` (runbook step 2).
2. **GitHub**: environment `data-migration` with a reviewer; the Site-Main read
   token (runbook step 3).
3. **HCP Terraform**: `cosmos_scratch_enabled = true`,
   `storage_scratch_enabled = true`; apply; re-run
   `set-github-variables.ps1` (runbook step 4).

## 3.4 Enable secret scanning and push protection

**Settings → Advanced Security** → enable **Secret scanning**, then **Push
protection**. The repository is public, so both are free. Push protection turns
"a credential was committed, now rotate it" into "the push was refused."

## 3.5 Self-hosted CI runner — deferred, not deleted

`infra/ci-runner.tf` defines an Azure Container Apps event-driven Job running
ephemeral GitHub runners (KEDA `github-runner` scaler, scale-to-zero — idle days
cost $0, active days ≈ $10/mo). It is a **fallback** for GitHub-hosted runner
outages, selected per-run by the `CI_RUNNER` repository variable.

`ci_runner_enabled = false`, so none of it is deployed. The setup below applies
only if you turn it on.

<details>
<summary>One-time setup, in order</summary>

1. **GitHub App** (org settings → Developer settings → GitHub Apps → New): no
   webhook, repository permission **Administration: Read & write** only. Install
   on `HCW-HybridCloudWorks` only. Record App ID, Installation ID, and a
   generated private key. A GitHub App rather than a PAT, so tokens are
   short-lived and not person-bound.
2. **Docker Hub**: create repository `hcw-runner` and a read/write token scoped
   to it. Add `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` as repository secrets,
   then run `Build runner image` once via `workflow_dispatch`.
3. **Terraform**: set `ci_runner_enabled = true` and apply.
4. **Seed the job's secrets and config** — the values Terraform deliberately
   does not manage; `lifecycle.ignore_changes` protects everything set here:

   ```bash
   RG=rg-mgmt-plat-prod-cus JOB=caj-plat-ci-prod-cus-01
   az containerapp job secret set -g $RG --name $JOB \
     --secrets gh-app-private-key="$(cat app-key.pem)" dockerhub-token='<token>'
   az containerapp job registry set -g $RG --name $JOB \
     --server docker.io --username '<dockerhub-user>' --password-secret-ref dockerhub-token
   az containerapp job update -g $RG --name $JOB \
     --set-env-vars GH_APP_ID=<app-id> GH_APP_INSTALLATION_ID=<installation-id> \
       GH_REPO_OWNER=HybridCloudWorks GH_REPO_NAME=HCW-HybridCloudWorks
   ```

5. **Smoke test**: `gh variable set CI_RUNNER --body '["self-hosted","aca"]'`,
   start a run, watch a job execution appear, then flip back.

**Failover during an outage:**

```bash
gh variable set CI_RUNNER --body '["self-hosted","aca"]'   # fail over
gh variable delete CI_RUNNER                                # restore
```

Applies to runs created after the change. Caveat from the 2026-08-06 outage: its
second phase stalled workflow-run *creation*, and no runner helps when the
control plane is down. This covers hosted-runner-capacity outages only.

**Deliberate security posture** — do not "improve" these without reading
`infra/ci-runner.tf`'s header: no managed identity on the runner job, no VNet,
JIT ephemeral runners via `generate-jitconfig`, secrets out-of-band of Terraform
state, runner image rebuilt weekly on GitHub-hosted runners so a broken image
cannot brick its own rebuild.

</details>

---

# PART 4 — REQUIRED INPUTS

Every variable, secret and setting the workload needs, with live status.
Absorbed from `CHECKLIST.md` and `Variables.md`.

> **This section must never contain actual values.** Formats use placeholders
> only: `X` = letter, `0` = number, `!` = special. If a real value ever appears
> here, treat it as disclosed and rotate it.

**Status vocabulary:** `SET` (present and confirmed) · `VERIFIED` (observed
working in the deployed system) · `MISSING` (consumed by code, not provisioned)
· `RETIRED` (no longer read by anything; listed so it is not reintroduced).

## 4.0 Naming and placement — read before adding anything

### The rule: one secret, one store

**A secret lives in exactly one store — the one whose consumer needs it.** Not
"the one that was convenient", and never two.

Duplication is not a tidiness problem. A value in two stores has two rotation
paths, and rotating one of them produces a system that half-works: the half
still holding the old value fails in whatever way that component fails, which is
rarely "authentication error" and is usually something further downstream. It
also doubles the leak surface for no benefit.

| Store | Holds | Never holds |
| --- | --- | --- |
| **Key Vault** | Runtime secrets the *application* reads | Anything Terraform needs, anything only a workflow needs |
| **HCP Terraform workspace** | Values Terraform needs to *build* infrastructure | Runtime application secrets |
| **GitHub secrets** | Credentials a *workflow* needs that Terraform cannot output | Runtime application secrets; anything non-sensitive |
| **GitHub variables** | Non-sensitive identifiers workflows need — resource names, client IDs | Anything sensitive |

The test when adding one: **name the consumer.** If the answer is "the Function
App at runtime" it is a Key Vault secret. If it is "the provider, during an
apply" it is a workspace variable. If it is "a workflow step" it is a GitHub
secret. If two consumers want it, one of them is usually wrong — see the
exceptions below before assuming yours is the third case.

### Naming, per store

The stores disagree about legal characters, so the same value has two spellings
and the mapping has to be mechanical rather than remembered.

| Store | Convention | Example |
| --- | --- | --- |
| Key Vault secret | `UPPER-KEBAB-CASE` | `ANTHROPIC-API-KEY` |
| Function App setting | `UPPER_SNAKE_CASE` | `ANTHROPIC_API_KEY` |
| GitHub secret / variable | `UPPER_SNAKE_CASE`, **max 2 words** (3 only to break a collision), no provider prefix | `FUNCTIONS_URL`, not `AZURE_FUNCTIONS_URL` |
| Terraform variable | `lower_snake_case` | `cloudflare_origin_secret` |
| Terraform output | `lower_snake_case`, named for the consumer | `api_base_url` |

> **Key Vault forbids underscores.** That is the whole reason for two spellings.
> The mapping is exact: an app setting `X_Y_Z` resolves the vault secret
> `X-Y-Z`. Get it wrong and the reference silently resolves to nothing — the app
> deploys clean and a missing credential presents as missing *data*.

**Contractual names are exempt from all of the above and must never be
"corrected":** `ARM_*`, `TFC_AZURE_*` (HashiCorp and Microsoft), `VITE_*`
(Vite), `GITHUB_TOKEN`. Renaming one breaks the tool that reads it.

### The exceptions, and why each is real

Three values legitimately appear twice. They are listed so nobody "fixes" them,
and so a fourth is scrutinised rather than assumed.

| Value | Where | Why it is not duplication |
| --- | --- | --- |
| Origin secret | Key Vault `CF-ORIGIN-SECRET` + workspace `cloudflare_origin_secret` | The two ends of a shared secret are configured by different systems, and neither can read the other's copy: Terraform configures Cloudflare, the app reads the vault. **They must match exactly** — a mismatch means every anonymous request is treated as bypassing Cloudflare and throws |
| Tenant id | `ARM_TENANT_ID` (env) + `entra_tenant_id` (terraform) | Same value, two categories. One configures the provider, one is consumed by the configuration. The categories are not interchangeable |
| Subscription id | `ARM_SUBSCRIPTION_ID` (env) + `subscription_app` (terraform) | As above. `ARM_SUBSCRIPTION_ID` is the provider's fallback only — every provider pins `subscription_id` in HCL, so it never decides where resources land |

**Tenant and subscription IDs are `sensitive` in the workspace and plain
variables in GitHub. That is deliberate, not drift.** They are identifiers, not
credentials — nothing is authorized by knowing one. The workspace marks them
sensitive to keep them out of run logs, which is defensive rather than
necessary; GitHub holds them as variables because a workflow that cannot echo
its own subscription id is a workflow nobody can debug.

### Two placements to fix

**`COSMOS_ENDPOINT` was seeded as a GitHub *secret* and is not sensitive.** It
holds `https://<account>.documents.azure.com:443/` — a public endpoint, and a
non-sensitive Terraform output. Storing a non-secret as a secret costs three
things: it is masked in logs so failures are harder to read, it cannot be
verified in the UI, and it dilutes what "secret" means for the values that are.
**Fixed in the tooling 2026-08-20**: `set-github-variables.ps1` seeds it as a
variable and deletes the secret; both workflows that read it now use
`vars.COSMOS_ENDPOINT`. The operator's next run of the script completes it.

### The repository is public

Job logs and workflow artifacts on this repository are world-readable. That
rules out a class of things that would be fine on a private one: uploading a
migration report that contains document ids or field samples, printing a
document preview to a log, or leaving an export on an artifact. `migrate-data`
uploads only `*.summary.json` files (counts, container names, warning tallies)
with 1-day retention, keeps the export in `$RUNNER_TEMP`, and sets
`MIGRATION_CI=1` so the scripts refuse `--show-samples`. Any new workflow that
touches data inherits the same rule.

**The seventeen provider API keys are seeded but nothing consumes them yet.**
The AI endpoints behind them are unimplemented stubs. That is not wrong — the
vault was seeded in one pass during a firewall window, and a second window later
costs more than seeding early — but it means "19 of 21 secrets present" is not
the same claim as "19 secrets in use". Only `CF-ORIGIN-SECRET`, `CLIENT-IP-SALT`
and the AWS pair have live consumers today.

### When to seed

Seed a secret when the thing that reads it exists, or when you already have a
firewall window open and closing it means opening another one later. Both stores
that hold runtime secrets deny by default, so windows are the expensive part,
not the writes.

Do **not** seed a placeholder to make a linter quiet. An unset input usually
fails with a clear "not supplied"; a stubbed one fails as an authentication or
resolution error that reads like a permissions or networking problem. The two
cost very different amounts to diagnose. `COSMOS_KEY` in §4.3 is the worked
example — it must stay unset, and setting it would switch the client to a key
path the account rejects.

## 4.1 HCP Terraform workspace — `hcw/hcw-azure`, project `Site`

**All set.** Confirmed against the HCP Terraform API 2026-08-20.

**Environment variables** — how Terraform authenticates to Azure. These four
names are dictated by HashiCorp and Microsoft, so they are contractual: exempt
from the repository's 2-word variable rule, never renamed. Category matters —
set as *Terraform* variables instead of *environment* variables they are
silently ignored and the run fails claiming no credentials were supplied.

| Name | Status | Notes |
| --- | --- | --- |
| `TFC_AZURE_PROVIDER_AUTH` | **SET** (`true`) | Absent ⇒ no OIDC token is minted and the provider finds no credential |
| `TFC_AZURE_RUN_CLIENT_ID` | **SET** | Client id of `id-plat-terraform-prod-cus-01`. Distinct from §4.2's `CLIENT_ID`, which is the GitHub Actions identity |
| `ARM_TENANT_ID` | **SET** (sensitive) | Same value as the `entra_tenant_id` Terraform variable |
| `ARM_SUBSCRIPTION_ID` | **SET** (sensitive) | Fallback only — every provider pins `subscription_id` in HCL, so this never decides where resources land |

**Terraform variables** — no defaults, so an apply fails without them:

| Name | Sensitive | Status | Notes |
| --- | --- | --- | --- |
| `subscription_app` | yes | **SET** | Application landing zone (`sub-app-site-prod-cus`) |
| `subscription_mgmt` | yes | **SET** | Platform Management (`sub-plat-mgmt-prod-cus`) |
| `subscription_conn` | yes | **SET** | Platform Connectivity (`sub-plat-conn-prod-cus`) |
| `entra_tenant_id` | yes | **SET** | |
| `cloudflare_api_token` | yes | **SET** | **Four scopes:** Zone:Read, DNS:Edit, Zone → Transform Rules:Edit, and (only if rulesets fail) Account → Rulesets:Read. A DNS-only token applies every record fine and fails on the ruleset alone with `Authentication error (10000)` |
| `cloudflare_origin_secret` | yes | **SET** | Must equal Key Vault's `CF-ORIGIN-SECRET` exactly. A mismatch is not partial — every anonymous request throws |
| `cloudflare_zone_id` | no | **SET** | |
| `entra_api_audience` | no | **SET** | Validated non-empty. `verify-token.js` refuses to start without it, deliberately: `jsonwebtoken` *skips* audience validation when unset rather than failing, which would accept any Microsoft-signed token in the tenant |
| `budget_alert_email` | no | **SET** | |

**Terraform variables with defaults** — override only with reason:

| Name | Default | Notes |
| --- | --- | --- |
| `azure_location` | `centralus` | Whole estate, single region since 2026-08-19 |
| `region_abbreviation` | `cus` | Must agree with `azure_location` |
| `instance` | `01` | CAF instance number, applied per resource type — not to everything |
| `cosmos_location` / `static_web_app_location` | `centralus` | Equal to `azure_location` today; kept separate because their constraints have not gone away, only been satisfied |
| `functions_origin_lock_enabled` | `true` | The origin lock. `false` is the one-step rollback |
| `cloudflare_ip_ranges` | 15 ranges | A literal list, not an http data source — a fetch failing mid-apply would silently rewrite the allow-list of the only door into the app |
| `cosmos_local_auth_disabled` | `true` | Key auth off; AAD only |
| `budget_amount_usd` | `150` | |
| `purge_protection_enabled` | `false` | Set `true` before production secrets matter |
| `ci_runner_enabled` | `false` | §3.5 |
| `vnet_address_space` / `functions_subnet_prefix` | `10.40.0.0/16` · `/24` | |
| `domain` | `hybridcloudworks.com` | |
| `admin_ip_rules` / `cosmos_admin_ip_rules` / `functions_storage_admin_ip_rules` | `[]` | Empty is the correct resting state. Populate → apply → work → empty → apply |
| `cosmos_db_account_name` · `storage_account_name` · `functions_storage_account_name` · `function_app_name` · `key_vault_name` | see `infra/variables.tf` | All globally unique; all verified free before the rebuild |

## 4.2 GitHub repository variables

**All eight set 2026-08-20**, each from the matching `terraform output` and
cross-checked afterwards.

| Name | Status | Value source | Notes |
| --- | --- | --- | --- |
| `FUNCTIONS_URL` | **SET** | output `api_base_url` | **The Cloudflare host, not the origin.** Feeds `VITE_AZURE_FUNCTIONS_URL`. Built from `function_hostname` until 2026-08-20, which the origin lock broke |
| `APP_HOSTNAME` | **SET** | output `function_hostname` | The origin. Diagnostics only — do not call it |
| `FUNCTION_APP_NAME` | **SET** | output `function_app_name` | The bare resource name `Azure/functions-action` targets. Was hardcoded in the workflow and went stale across the rename |
| `CLIENT_ID` | **SET** | output `client_id` | Deploy identity for OIDC login. Distinct from `TFC_AZURE_RUN_CLIENT_ID` |
| `TENANT_ID` | **SET** | Entra directory | |
| `SUBSCRIPTION_ID` | **SET** | Application landing zone | |
| `RESOURCE_GROUP` | **SET** | output `web_resource_group` | For the storage firewall window in `deploy-functions.yml` |
| `FUNCTIONS_STORAGE_ACCOUNT` | **SET** | output `functions_storage_account` | Paired with `RESOURCE_GROUP` by construction |

Needed by `migrate-data.yml`, all **variables** (every one is an identifier or
a public URL), none set yet:

| Name | Status | Value source | Notes |
| --- | --- | --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | **SET 2026-08-20** | `projects/556314942797/locations/global/workloadIdentityPools/github-actions/providers/github-actions-hcw` | A sibling of Site-Main's provider in the same pool, pinned to **this** repository id and `refs/heads/main` — Site-Main's trust was not widened. Dispatch from any other ref fails at the GCP step by design |
| `GCP_SERVICE_ACCOUNT` | **SET 2026-08-20** | `hcw-migration-reader@hybridcloudworks-61e8d.iam.gserviceaccount.com` | Dedicated read-only SA: `roles/datastore.viewer` on the project, `roles/storage.objectViewer` on the one bucket, `workloadIdentityUser` for `attribute.repository/HybridCloudWorks/HCW-HybridCloudWorks`. **Not** Site-Main's deploy SA |
| `COSMOS_ENDPOINT` | **moving from secrets** | output `cosmos_endpoint` | Production. Read-only use until `migration_writer_enabled` |
| `STORAGE_ACCOUNT` · `STORAGE_RESOURCE_GROUP` | **MISSING** | outputs `storage_account`, `storage_resource_group` | The **content** account — not the Functions host account the two rows above name |
| `COSMOS_SCRATCH_ENDPOINT` | **MISSING** | output `cosmos_scratch_endpoint` | Null until `cosmos_scratch_enabled`; the script leaves an absent output's variable unchanged |
| `STORAGE_SCRATCH_ACCOUNT` · `SCRATCH_RESOURCE_GROUP` | **MISSING** | outputs `storage_scratch_account`, `scratch_resource_group` | Same |
| `SITE_MAIN_APP_ID` | **MISSING** | GitHub App settings | Only for `mode=inventory-gate`. Absent ⇒ the workflow falls back to `SITE_MAIN_READ_TOKEN` (§4.3) |
| `PRODUCTION_IMPORT_ENABLED` | **unset — correctly** | operator, per run | The workflow-side lock on `rehearse` / `storage-rehearse` against production. Set to `true` only after `migration_writer_enabled` is applied; unset again when the import is verified. Absence = closed |

Still needed for the frontend build, sourced from the Entra registrations in
§2.2 rather than Terraform:

| Name | Status | Notes |
| --- | --- | --- |
| `VITE_ENTRA_CLIENT_ID` | **MISSING** | SPA registration client id. A variable, not a secret |
| `VITE_ENTRA_TENANT_ID` | **MISSING** | A variable, not a secret |
| `VITE_ENTRA_API_SCOPE` | **MISSING** | Must correspond to `entra_api_audience` — see the warning in §2.2 |
| `VITE_SOCIAL_X_URL` · `VITE_SOCIAL_LINKEDIN_URL` · `VITE_SOCIAL_GITHUB_URL` | **MISSING** | Cosmetic; absence renders an empty link target |
| `CI_RUNNER` | **Deliberately absent** | Absence ⇒ `ubuntu-latest`, which is normal operation. This is why the Actions extension reports "Context access might be invalid" on its references — expected, and must not be "fixed" by setting the variable |

Re-run `scripts/set-github-variables.ps1` after any apply that changes an
output. It sources from applied state, not a hardcoded copy that drifts.

## 4.3 GitHub repository secrets

**One of four set, and that one is moving to variables.**

| Name | Status | Blocks | Notes |
| --- | --- | --- | --- |
| `COSMOS_ENDPOINT` | **SET — moving** | — | Now a *variable* (§4.2). The script deletes this secret on its next run; until then both exist and the workflows read the variable |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | **MISSING** | Frontend deploy | Terraform output `swa_token`. **Reissued by the rebuild** — any previously recorded value is dead |
| `TF_API_TOKEN` | **MISSING** | Gated infra workflow | How the *workflow* reaches Terraform. Distinct from §4.1, which is how *Terraform* reaches Azure |
| `SITE_MAIN_APP_PRIVATE_KEY` (environment `data-migration`) | **MISSING** | `mode=inventory-gate` only | Private key of an org GitHub App with `contents: read` on Site-Main alone. Preferred over a PAT: no human expiry, narrowest scope |
| `SITE_MAIN_READ_TOKEN` (environment `data-migration`) | **MISSING — fallback** | `mode=inventory-gate` only | Fine-grained PAT, Site-Main `contents: read`, 90-day expiry. **Record the expiry date here** if this path is used |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | **MISSING** | Runner image build only | Needed only if §3.5 is turned on |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Never provision** | — | Retired 2026-08-20. `migrate-data.yml` authenticates to GCP through Workload Identity Federation and the scripts refuse a `service_account` credential file in CI. A downloaded key is the one artefact this design has no use for |
| `COSMOS_KEY` | **Never provision** | — | Key auth is off on **both** Cosmos accounts (production and scratch), and `scripts/lib/cli.mjs` throws on startup if this is set. There is no rehearsal shape that needs it |

## 4.4 GitHub environments

Neither exists. `deploy-infra` is still `if: ${{ false }}`; `migrate-data` is
enabled and its job names `environment: data-migration`, so a dispatch before
the environment exists fails at Azure Login (no matching federated subject) —
loudly, which is the right failure. An environment is where required reviewers
live; the environment **is** the human-review gate.

| Environment | Purpose | Protection expected | Status |
| --- | --- | --- | --- |
| `production-infra` | Review gate for production applies | Required reviewers; restrict to the deploy ref | **MISSING** |
| `data-migration` | Gate for every `migrate-data` run — rehearsal and, later, production import | Required reviewers; holds the two Site-Main token secrets (§4.3) | **CREATED 2026-08-20** — required reviewer `saulpatinojr`, no branch policy (the GCP provider already pins `main`) |

> `data-migration` is **load-bearing in two places**. `infra/oidc.tf` pins a
> federated credential to the subject
> `repo:<org>/<repo>:environment:data-migration`. Renaming the environment
> breaks OIDC login with `AADSTS70021`.

Create them **with reviewers before** flipping `if: false`, not after.

## 4.5 Function App settings — Terraform-managed

Set automatically by `infra/main.tf`. Listed for reference and local dev; do not
set by hand.

| Setting | Purpose |
| --- | --- |
| `COSMOS_ENDPOINT` · `COSMOS_DATABASE` | Cosmos account endpoint and database name |
| `STORAGE_ACCOUNT_NAME` · `STORAGE_BLOB_ENDPOINT` · `STORAGE_QUEUE_ENDPOINT` | Blob endpoint preferred over account name — it carries the correct suffix for the account's cloud |
| `KEY_VAULT_URI` | Vault the app resolves secrets from |
| `ENTRA_TENANT_ID` · `ENTRA_CLIENT_ID` · `ENTRA_API_AUDIENCE` | JWT validation |
| `CF_ORIGIN_SECRET` · `CLIENT_IP_SALT` | Anti-abuse; both resolve from Key Vault |
| `FEATURE_FLAG_SCHEDULERS` | **Must stay `false`.** One flag arms four timers, one of which deletes blobs with an unimplemented body — TODO T-302 |
| `NODE_ENV` | `production` |
| `*_API_KEY` and friends | All resolve from Key Vault by reference |

**Retired — must not exist.** Listed so they are not reintroduced:

| Setting | Why |
| --- | --- |
| `STORAGE_ACCOUNT_KEY` · `STORAGE_CONNECTION_STRING` | SAS tokens are user-delegation, signed via managed identity. A test asserts these names cannot return to the module |
| `AZURE_OPENAI_ENDPOINT` · `AZURE_OPENAI_KEY` · `AZURE_OPENAI_GPT_DEPLOYMENT` · `AZURE_OPENAI_DALLE_DEPLOYMENT` | Azure OpenAI retired 2026-08-19: zero gpt-4o TPM quota in every SKU, no DALL-E in region, and nothing consumed it. `functions/src/lib/openai-client.js` and the `@azure/openai` dependency were deleted 2026-08-20 |
| `COSMOS_CONNECTION_STRING` | Carried the account primary key. Removed with the change-feed triggers that were its only consumer |

## 4.6 Key Vault secrets — `kv-site-prod-cus-01`

Accessed by the Function App via managed identity as app-setting
`@Microsoft.KeyVault(SecretUri=…)` references, except where marked runtime-read.
Naming and placement rules are in **§4.0** — in short, `UPPER-KEBAB-CASE` here
because Key Vault forbids underscores, mapping mechanically to the app setting's
`UPPER_SNAKE_CASE`: `OPENAI_API_KEY` resolves `OPENAI-API-KEY`.

**This store holds runtime application secrets and nothing else.** A value
Terraform needs belongs in the workspace (§4.1); a value only a workflow needs
belongs in GitHub secrets (§4.3). The single documented overlap is
`CF-ORIGIN-SECRET`, and §4.0 explains why it is real.

**Seeded by hand.** Deliberately not Terraform-managed: the values would
otherwise live in both the workspace and Terraform state, and several of them
(an AWS secret key, a GCP service-account JSON, a GitHub App RSA key) do not
warrant that blast radius. There is no `secret-sync-keyvault.yml` — it was
removed rather than finished, and will not return.

**Platform**

| Secret | Status | Consumed by |
| --- | --- | --- |
| `AWS-ACCESS-KEY-ID` | **SET** | AWS pricing — scope the IAM policy to `pricing:GetProducts` only |
| `AWS-SECRET-ACCESS-KEY` | **SET** | same |
| `CF-ORIGIN-SECRET` | **SET** | `client-identity.js`; fails closed in production without it |
| `CLIENT-IP-SALT` | **SET** | Rate-limit key derivation. Rotating it resets all live quota counters |
| `GCP-SERVICE-ACCOUNT-JSON` | **MISSING** | `gcp.js` — **runtime read**, §3.1 |

**Ported from Site-Main's `defineSecret` bindings**

| Secret | Status | Consumed by |
| --- | --- | --- |
| `ANTHROPIC-API-KEY` | **SET** | AI drafting, WAF scoring, architecture generation |
| `OPENAI-API-KEY` | **SET** | AI generation fallback |
| `PERPLEXITY-API-KEY` | **SET** | Research and enrichment |
| `REPLICATE-API-KEY` | **SET** | Image generation |
| `FIRECRAWL-API-KEY` | **SET** | URL ingestion and scraping |
| `LINKIE-API-KEY` | **SET** | Linkie proxy |
| `YOUTUBE-API-KEY` | **SET** | `youtubeChannelStats` |
| `PUBLER-API-KEY` | **SET** | Social scheduling proxy and calendar sync |
| `PUBLER-WORKSPACE-ID` | **SET** | Identifier; travels with the key rather than splitting across two stores |
| `KLAVIYO-PRIVATE-KEY` | **SET** | Newsletter subscribe, weekly digest |
| `KLAVIYO-LIST-ID` | **SET** | Identifier; as above |
| `TELEGRAM-BOT-TOKEN` | **SET** | Notifications; webhook secret derives as `sha256(token)` |
| `TELEGRAM-CHAT-ID` | **SET** | Notification target |
| `GITHUB-APP-INSTALLATION-ID` | **SET** | Site-rebuild trigger |
| `HOSTINGER-API-TOKEN` | **SET** | VPS control |
| `GITHUB-APP-PRIVATE-KEY` | **MISSING** | **Runtime read**, §3.1 |

**Names that do not exist** — recorded because earlier revisions of the
catalogue invented them:

- `KLAVIYO-API-KEY` — Site-Main declares `KLAVIYO_PRIVATE_KEY` **and** `KLAVIYO_LIST_ID`.
- `GITHUB-APP-TOKEN` — there is no single "app token"; it is installation id + private key.
- `PLAUD-API-KEY` — Plaud is an **MCP server entry**; its credentials live in the `mcp_servers` container as admin-configured data and migrate as data, not as a deploy secret.
- `SESSIONIZE-API-KEY` — Sessionize is a **public profile URL** in site settings. There is no API key.

> Add new secrets here **and** to `infra/main.tf`'s `app_settings` before adding
> them to the vault. Ground truth until Site-Main is retired:
> `grep -rhoE "defineSecret\(['\"][A-Z0-9_]+" functions/`

## 4.7 VPS agent (Hostinger) — `.env`, never committed

**The agent holds no database credential.** If anything in this table ever grows
a `COSMOS_*` entry, something has gone wrong — see §2.1.

| Variable | Status | Notes |
| --- | --- | --- |
| `LABS_AGENT_API_BASE` | **MISSING** | The **Cloudflare** API base including `/api`. Same shape as `VITE_AZURE_FUNCTIONS_URL`, same `/api` requirement, and same origin-lock constraint |
| `LABS_AGENT_TENANT_ID` | **MISSING** | |
| `LABS_AGENT_CLIENT_ID` | **MISSING** | **One registration per agent host**, so a compromised VPS is revoked alone rather than fleet-wide |
| `LABS_AGENT_CERT_PATH` | **MISSING** | PEM holding certificate and private key. Generate the key **on the host**; upload only the public certificate. Root-owned, `0600`, outside the repository |
| `LABS_AGENT_API_SCOPE` | **MISSING** | Audience must match `entra_api_audience` |
| `LABS_AGENT_ID` | **MISSING** | Defaults to the hostname. A wrong value fails closed — the server refuses it unless the registry document's `oid` matches this credential |

Not environment variables, but required for any of the above:

| Input | Status | Notes |
| --- | --- | --- |
| `LabAgent` App Role | **MISSING** | On the API app registration, assigned per agent service principal. Disjoint from `Admin` |
| `lab_agents/{agentId}` document | **MISSING** | `{oid, active, capabilities[]}`. `active: false` revokes immediately |

## 4.8 Frontend build-time variables

Vite inlines `VITE_*` at build time. **Everything here ships to the browser and
is publicly readable — no secret may ever be added.**

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_AZURE_FUNCTIONS_URL` | **Yes** | **Must end in `/api`** — routes are registered relative to it, so a base without it 404s uniformly. Must be the Cloudflare host, and must agree with `staticwebapp.config.json`'s `connect-src`. Read by exactly one module, `frontend/src/lib/functionsBase.js`, enforced by test. A deploy build without it fails (`REQUIRE_API_BASE=true`) |
| `VITE_ENTRA_CLIENT_ID` · `VITE_ENTRA_TENANT_ID` · `VITE_ENTRA_API_SCOPE` | Yes | §2.2 |
| `VITE_TRANSLATIONS` · `VITE_DEFAULT_LANGUAGE` · `VITE_NEWS_ENABLE_INSIGHTS` | No | Feature toggles |
| `VITE_SOCIAL_*` | No | Public URLs, not secrets |

## 4.9 Local development

```bash
# az login — DefaultAzureCredential picks it up. No COSMOS_KEY needed, and none works.
COSMOS_ENDPOINT=https://cosmos-site-prod-cus.documents.azure.com:443/
COSMOS_DATABASE=hcw
KEY_VAULT_URI=https://kv-site-prod-cus-01.vault.azure.net/
ENTRA_TENANT_ID=<tenant-id>
ENTRA_CLIENT_ID=<client-id>
FEATURE_FLAG_SCHEDULERS=false
```

Reaching Cosmos or Key Vault from a laptop needs a firewall window — both deny
by default. The same populate/apply/work/empty cycle as §3.1.

## 4.10 Terraform outputs

`terraform output` after any apply.

| Output | Use |
| --- | --- |
| **`api_base_url`** | **The public API base. Feeds `FUNCTIONS_URL` and every client** |
| `function_hostname` / `function_url` | The origin. **Not client-reachable** — diagnostics only |
| `swa_token` | GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| `swa_hostname` | Static Web App default hostname |
| `client_id` | GitHub variable `CLIENT_ID` |
| `cosmos_endpoint` · `cosmos_database` | Migration scripts, VPS agent |
| `vault_uri` · `vault_name` | Local dev, seeding |
| `blob_endpoint` · `storage_account` · `functions_storage_account` | Storage clients and CI firewall windows |
| `web_resource_group` | GitHub variable `RESOURCE_GROUP` |
| `workspace_id` | Log Analytics, for diagnostic settings |
| `app_principal_id` · `deploy_principal_id` | Granting additional RBAC |
| `subnet_id` | Additional service firewall rules |
| `federated_subjects` | Diagnosing `AADSTS70021` |

---

# PART 5 — DEFERRED, NOT BLOCKING

Real, but nothing waits on them.

## 5.1 Media delivery — keep the account closed, or front it with a CDN?

Uploaded images are served by `GET /api/public/media/{container}/{*path}`,
reading blobs through the Function App's managed identity. The storage account
stays closed, no new resource is provisioned, no security setting is reversed.
Responses are `immutable` with ETag support, so repeat views do not reach the
function.

The alternative — open the account behind Cloudflare or Front Door — trades two
security settings and a monthly service floor for edge caching. Against a USD
150 ceiling that is a spend decision.

Worth revisiting if image egress dominates invocation cost. Nothing forecloses
it: the route can sit behind a CDN unchanged, and stored URLs are site-relative.

## 5.2 Dependabot #17 — eslint 9 → 10

**Upstream blocked.** eslint 10 crashes `eslint-plugin-react`
(`contextOrFilename.getFilename is not a function`). Both `eslint-plugin-react`
(peer ≤9.7) and `eslint-plugin-jsx-a11y` (peer ≤9) cap below 10. Monitor only;
the bump and both plugin upgrades land together or not at all.

## 5.3 react-router — 2 HIGH advisories, deliberately not fixed

GHSA-qwww-vcr4-c8h2, "RSC Mode CSRF Bypass". **Assessed as not applicable**:
specific to React Server Components mode, and this is a plain Vite SPA using
only `useNavigate` / `Link` / `useLocation` with no RSC entry points. There is
also no fixed version *above* the current one — npm's only remedy is a
downgrade losing seven minor versions.

**If RSC adoption is ever planned, this flips.**

## 5.4 GCP Secret Manager stack — 8 unreferenced secrets

`frontend/platform/terraform/gcp-secrets/` still defines eight secrets nothing
active references. Left alone deliberately: the README requires explicit
approval for GCP decommissioning, and if that state is live those secrets exist.

## 5.5 Six pre-existing test failures — the gate covers a subset

CI runs `test:admin` (green). The full `vitest run` has 6 failing tests across 3
files on `main`, including `App.routes.test.jsx` timeouts. Confirmed
pre-existing. Widening the gate requires fixing those six first — the same
"clear it, then enforce it" sequence used for lint and format.

## 5.6 Thirteen non-executing workflows in `frontend/.github/`

GitHub only runs workflows from the repository root. Thirteen there never
execute, including five Notion secret workflows referencing deleted scripts. A
shadow CI directory that looks real and is not.

## 5.7 Two unconvertible pricing unit mismatches

`compute-serverless` and `database-nosql` baselines measure different meters
than their live paths (million invocations vs normalized request workload; hour
provisioned vs million operations on-demand). Recorded in
`KNOWN_UNIT_MISMATCHES` with a test that fails if a third appears. Choosing
replacement baselines is a pricing-catalog decision.

---

# PART 6 — HISTORICAL RECORD

Kept so the reasoning survives, and so stale assessments are not mistaken for
current ones.

## 6.1 Corrections to earlier claims

- **`claude/site-main-migration-prep-5fka2q` was reported as safe to delete. It
  was not.** It carried 1,337 lines of unmerged feature work, pushed after the
  earlier check. Verified before acting; preserved, and became #38.
- **A CI matrix simulation was reported as passing when the environment was
  contaminated.** The `frontend` leg passed locally only because
  `frontend/functions/node_modules` was present from an earlier step. A clean
  checkout failed. Every simulation since deletes every `node_modules` first.
- **`frontend/scripts/package.json` was described as an empty, vestigial
  package.** Its contents are empty; its function is not — with no `"type"`
  field it marks that directory CommonJS inside an ESM parent, and nine `.js`
  helpers there use `require()`. Deleting it breaks them.
- **The post-deploy smoke test was described as going "through the proxied
  Cloudflare record" when it did not.** It was pointed at `FUNCTIONS_URL`, which
  at the time named the origin. Corrected 2026-08-20 by making `FUNCTIONS_URL`
  the Cloudflare base at its source, the `api_base_url` output.

## 6.2 Fixed, with the reasoning retained

**Key Vault was unreachable by everyone, including the app.** The vault set
`default_action = "Deny"` and allowed the Functions subnet — but that subnet
carried no `Microsoft.KeyVault` service endpoint, and a Key Vault VNet rule is
inert without one. Silent by construction: the app deploys clean, then a missing
credential presents as missing data. Nothing in CI could catch it and
`terraform validate` would have passed. Fixed by adding the service endpoint.

**Deploys used a static service principal against the repository's own
guardrail.** `deploy-functions.yml` authenticated with a long-lived
service-principal JSON while the README requires OIDC. Replaced with a
user-assigned managed identity and federated credentials — deliberately not an
app registration, because those need Entra directory permissions that Azure
Owner does not confer.

**The frontend was a Firebase client, and it was the Go-Live blocker.** Resolved
in PRs #61–#66: `useFirestore.js`, `firebaseConfig.js` and `firebaseStorage.js`
are deleted and the production bundle contains no Firebase chunk. The counts
that section cited — 34 files importing `firebase/firestore`, ~115 direct
Firestore calls — are now zero.

## 6.3 Environment limitations that no longer apply

Recorded because they qualified a great deal of earlier work:

| Was | Now |
| --- | --- |
| No Terraform binary, no Terraform Cloud credentials — every infra change reasoned from configuration only | Terraform runs, applies, and is verified against the real provider |
| No Azure, Cloudflare or GCP control-plane access | Azure and Cloudflare both reachable and exercised |
| `pwsh` unavailable — repository policy checked by hand | Runs locally |

The Wiki remains outside the authorized repository set, so
`.github/wiki/**` is edited here and pushed by `sync-wiki.yml`.
