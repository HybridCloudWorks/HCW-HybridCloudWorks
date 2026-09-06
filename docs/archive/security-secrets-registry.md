---
title: 'Secrets Registry — Label, Consumers, Provisioning'
status: 'Active'
maintainer: '@saulpatinojr'
related:
  - security-secrets-guide.md
  - .github/workflows/secret-encrypt.yml
  - .github/workflows/secret-sync.yml
  - .github/workflows/secret-rotate.yml
  - .github/workflows/secrets-terraform.yml
  - .github/workflows/secrets-resync.yml
  - scripts/bootstrap-secrets.ps1
---

# 🔐 Secrets Registry

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


Authoritative per-secret inventory. For every secret used anywhere in the HCW stack, this file
documents:

1. **Label** — the exact environment variable / Notion `Name` property
2. **Consumers** — every application, workflow, or function that reads it
3. **Type** — Firebase / GCP / AI / Infra / DNS / etc.
4. **Distribution** — where `secret-sync` lands it (GitHub Actions / Firebase Secret Manager /
   Terraform Cloud / not synced)
5. **Rotation** — auto (via `secret-rotate`) or manual cadence
6. **How to generate / rotate** — the exact provider console URL + procedure

> **Source of truth**: the Notion Secrets database (ID `2cb0982b27b680c392e5d8fa4c797cda`). This
> file is a human-readable mirror for onboarding and key recovery. If they disagree, **Notion wins**
> — re-run `secret-encrypt.yml` to reconcile.

---

## 📡 Distribution targets

| Target                      | Filter prefix in `secret-sync.yml`                                                                                                | Used by                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **GitHub Actions secrets**  | `VITE_`, `FIREBASE_`, `GCP_`, `NOTION_`                                                                                           | All CI/CD workflows (`deploy-frontend`, `deploy-functions`, `check-*`)                                               |
| **Firebase Secret Manager** | `OPENAI_`, `ANTHROPIC_`, `CLAUDE_`, `GEMINI_`, `PERPLEXITY_`, `REPLICATE_`, `FIRECRAWL_`, `PUBLER_`, `LINKIE_`, `KLAVIYO_`, `WIKIJS_`, `RESEND_`, `NOTION_`, `N8N_` | Cloud Functions runtime (`functions/index.js`, `functions/cms-functions.js`) via `defineSecret()`                    |
| **Terraform Cloud**         | Explicit map in `secrets-terraform.yml`                                                                                           | `infrastructure/terraform/` modules (VPS / Cloudflare)                                                               |
| **Not synced**              | The 4 bootstrap secrets (`NOTION_API_TOKEN`, `NOTION_SECRETS_DB_ID`, `SOPS_AGE_KEY`, `GH_PAT_KEY`)                                | Seeded once by `scripts/bootstrap-secrets.ps1` directly into GitHub Actions secrets — they bootstrap the sync itself |

---

## 🚦 Bootstrap secrets (seeded by `scripts/bootstrap-secrets.ps1`)

These break the chicken-and-egg: the sync pipeline can't sync the secrets it needs to run. They are
the **only** secrets a human ever pushes to GitHub directly. Everything else flows Notion → SOPS →
workflows.

**Bootstrap flow (one-time, or after rotating any of the 4):**

1. Populate `infrastructure/secrets/env/.env` with `NOTION_API_TOKEN` + `NOTION_SECRETS_DB_ID`
   (gitignored — never committed).
2. Run `./scripts/bootstrap-secrets.ps1 -ReuseExistingAgeKey` (or omit the flag to generate a new
   age keypair). The script:
   - Reads `.env` for Notion credentials
   - Pulls `GH_PAT_KEY` directly from the Notion Secrets DB (zero prompts)
   - Derives the age public key (`age-keygen -y`) and writes `.sops.yaml`
   - Pushes all 4 secrets to `saulpatinojr/Personal-Site_HCW` GitHub Actions secrets
3. Trigger `gh workflow run secrets-resync.yml` to run the full encrypt → sync → terraform chain.

After bootstrap, never edit these in GitHub directly — rotate them in Notion (where applicable) and
re-run `bootstrap-secrets.ps1`.

| Label                  | Consumers                                              | Distribution   | Rotation                | Where / how to generate                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------ | -------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTION_API_TOKEN`     | `secret-encrypt`, `secret-rotate`, `secrets-terraform` | GH Secret only | Manual / annual         | <https://www.notion.so/profile/integrations> → create **internal integration** → copy "Internal Integration Secret" → in Notion DB → `...` → **Connect to integration**                                                                                                |
| `NOTION_SECRETS_DB_ID` | Same as above                                          | GH Secret only | Never (stable ID)       | Open the Notion Secrets DB page → URL is `notion.so/<workspace>/<32-char-id>?v=...` — copy the 32-char ID                                                                                                                                                              |
| `SOPS_AGE_KEY`         | `secret-encrypt`, `secret-sync`, `secret-rotate`       | GH Secret only | Annual or on compromise | Locally: `age-keygen -o ~/.config/sops/age/keys.txt`. `bootstrap-secrets.ps1` reads this file and pushes it as the GH secret. The script derives the public key via `age-keygen -y` if the file lacks a `# public key:` comment. Public key is written to `.sops.yaml` |
| `GH_PAT_KEY`           | `secret-sync` (to write back GH Actions secrets)       | GH Secret only | 90 days                 | <https://github.com/settings/personal-access-tokens/new> → Fine-grained token → repo `saulpatinojr/Personal-Site_HCW` → permission **Secrets: Read & Write** + **Actions: Read & Write**                                                                               |

---

## 🟢 Frontend / Firebase (GitHub Actions distribution)

Consumers: `deploy-frontend.yml`, `deploy-functions.yml`, `check-quality.yml`,
`check-lighthouse.yml`, `check-e2e.yml`. Read at build time by Vite (`import.meta.env.VITE_*`).

| Label                               | Type                 | Rotation    | Where / how to generate                                                                                                                                                                                |
| ----------------------------------- | -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_FIREBASE_API_KEY`             | Public web key       | 90d manual  | <https://console.firebase.google.com/project/hybridcloudworks-61e8d/settings/general> → Web app → **SDK setup and configuration** → `apiKey`                                                           |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Config               | Never       | Same page → `authDomain` (stable: `hybridcloudworks-61e8d.firebaseapp.com`)                                                                                                                            |
| `VITE_FIREBASE_PROJECT_ID`          | Config               | Never       | Same page → `projectId` (stable: `hybridcloudworks-61e8d`)                                                                                                                                             |
| `VITE_FIREBASE_STORAGE_BUCKET`      | Config               | Never       | Same page → `storageBucket`                                                                                                                                                                            |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Config               | Never       | Same page → `messagingSenderId`                                                                                                                                                                        |
| `VITE_FIREBASE_APP_ID`              | Config               | Never       | Same page → `appId`                                                                                                                                                                                    |
| `VITE_FIREBASE_MEASUREMENT_ID`      | Analytics config     | Never       | Same page → `measurementId` (only if Google Analytics linked)                                                                                                                                          |
| `VITE_FIREBASE_TOKEN`               | Deploy CLI token     | 90d manual  | Run locally: `firebase login:ci` → copy token. Used by `deploy-functions.yml` and `secret-sync.yml`                                                                                                    |
| `GCP_SA_KEY`                        | Service account JSON | 180d manual | <https://console.cloud.google.com/iam-admin/serviceaccounts?project=hybridcloudworks-61e8d> → SA used for Firebase deploys → **Keys** → **Add key → Create new key → JSON** → paste full JSON contents |

---

## 🟣 AI providers (Firebase Secret Manager distribution)

Consumers: `functions/index.js`, `functions/cms-functions.js`, `functions/lib/ai-model-router.js`.
Bound to Cloud Functions via `defineSecret()`.

| Label                   | Type       | Rotation               | Where / how to generate                                                                                                          |
| ----------------------- | ---------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`        | Bearer key | Manual 90d             | <https://platform.openai.com/api-keys> → **Create new secret key** → project-scoped recommended                                  |
| `ANTHROPIC_API_KEY`     | Bearer key | Manual 90d             | <https://console.anthropic.com/settings/keys> → **Create Key**                                                                   |
| `GEMINI_API_KEY`        | Bearer key | Manual 90d             | <https://aistudio.google.com/app/apikey> → **Create API key** (select GCP project `hybridcloudworks-61e8d` to reuse quotas)      |
| `PERPLEXITY_API_KEY`    | Bearer key | Manual 90d             | <https://www.perplexity.ai/settings/api> → **Generate**                                                                          |
| `REPLICATE_API_KEY`     | Bearer key | Manual 90d             | <https://replicate.com/account/api-tokens> → **Create token**                                                                    |
| `FIRECRAWL_API_KEY`     | Bearer key | Manual 90d             | <https://www.firecrawl.dev/app/api-keys> → **Create API Key**                                                                    |
| `AZURE_OPENAI_API_KEY`  | Bearer key | Manual 90d             | Azure Portal → Azure OpenAI resource → **Keys and Endpoint** → **Regenerate Key 1/2**                                            |
| `AZURE_OPENAI_ENDPOINT` | URL        | Never (resource-bound) | Same page → **Endpoint** field                                                                                                   |
| `AWS_ACCESS_KEY_ID`     | IAM key    | Manual 90d             | <https://console.aws.amazon.com/iam/home#/security_credentials> → **Access keys → Create access key** (use IAM user, never root) |
| `AWS_SECRET_ACCESS_KEY` | IAM secret | Same as above          | Same flow — shown **once** at creation                                                                                           |
| `RESEND_API_KEY`        | Bearer key | Manual 90d             | <https://resend.com/api-keys> → **Create API Key**                                                                               |

---

## 🟢 Admin integration providers (Firebase Secret Manager)

Consumers: `functions/cms-functions.js` admin/public integration proxies. Synced from Notion to
Firebase Secret Manager by `secret-sync.yml`.

| Label                  | Consumer functions                         | Type       | Rotation   | Where / how to generate                                                                 |
| ---------------------- | ------------------------------------------ | ---------- | ---------- | --------------------------------------------------------------------------------------- |
| `PUBLER_API_KEY`       | `publerProxy`                              | API key    | Manual 90d | Publer dashboard → API / integrations settings → generate or rotate API key             |
| `PUBLER_WORKSPACE_ID`  | `publerProxy`                              | Workspace  | Never      | Publer workspace settings or API response                                               |
| `LINKIE_API_KEY`       | `linkieProxy`                              | Bearer key | Manual 90d | Linkie dashboard/API settings; used as `Authorization: Bearer <key>`                    |
| `KLAVIYO_PRIVATE_KEY`  | `klaviyoProxy`, `newsletterSubscribe`      | API key    | Manual 90d | <https://www.klaviyo.com/settings/api-keys> → create private API key                    |
| `KLAVIYO_LIST_ID`      | `newsletterSubscribe`                      | List ID    | Never      | Klaviyo list/audience settings → copy the target newsletter list ID                     |

**Verified 2026-06-12:** `LINKIE_API_KEY`, `KLAVIYO_PRIVATE_KEY`, and `KLAVIYO_LIST_ID` synced from
Notion to Firebase Secret Manager, and the subsequent `deploy-functions` run completed
successfully.

---

## 🟡 Workflow orchestration (Firebase Secret Manager)

| Label                     | Consumers                                       | Type        | Rotation                           | Where / how to generate                                                                              |
| ------------------------- | ----------------------------------------------- | ----------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `N8N_ENCRYPTION_KEY`      | n8n (self-hosted)                               | App secret  | **Auto monthly** (`secret-rotate`) | Auto-generated; never visible. If lost, all stored n8n credentials become unrecoverable              |
| `WIKIJS_DB_PASSWORD`      | Wiki.js (self-hosted)                           | DB password | Auto monthly                       | Auto-generated                                                                                       |

> **v1.5.0 (2026-06-11):** `RABBITMQ_ADMIN_PASSWORD` retired — the `platform/ansible` VPS stack
> (RabbitMQ et al.) was removed in v1.5.0; labs now run on the Hostinger VPS labs platform (see
> `labs-platform-guide.md`). Linkie and Klaviyo integration secrets are tracked in the Admin
> integration providers section above.

---

## 🟠 Infrastructure (Terraform Cloud distribution)

Synced by `secrets-terraform.yml` monthly (1st @ 02:00 UTC) into the Terraform Cloud workspace
declared by `TERRAFORM_WS_ID`.

| Label (Notion)             | TF variable                    | Sensitive | Where / how to generate                                                                                                                    |
| -------------------------- | ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `TERRAFORM_API_KEY`        | (workspace auth, not a TF var) | yes       | <https://app.terraform.io/app/settings/tokens> → **Create an API token**                                                                   |
| `TERRAFORM_WS_ID`          | (workspace target)             | no        | Terraform Cloud → workspace → **General Settings** → Workspace ID (`ws-...`)                                                               |
| `VPS_API_TOKEN`            | `hostinger_api_token`          | yes       | <https://hpanel.hostinger.com/profile/api> → **Generate token**                                                                            |
| `CLOUDFLARE_DNS_API_TOKEN` | `cloudflare_api_token`         | yes       | <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → template **Edit zone DNS** → restrict to `hybridcloudworks.com` zone |
| `CLOUDFLARE_ZONE_ID`       | `cloudflare_zone_id`           | yes       | Cloudflare dashboard → select `hybridcloudworks.com` → right rail → **Zone ID**                                                            |
| `VPS_SSH_KEY`              | `ssh_public_key`               | no        | Locally: `ssh-keygen -t ed25519 -C "hcw-deploy"` → paste **public** key (`.pub`); store private key separately in your password manager    |
| `VPS_HOST_IP`              | `vps_ipv4`                     | no        | Hostinger VPS panel → server detail → **IPv4 address**                                                                                     |
| `VPS_HOST_ID`              | `vps_id`                       | no        | Hostinger VPS panel → server detail → URL contains `/servers/<vps_id>`                                                                     |

---

## 🔵 Future / Stage 0 (documented, not yet provisioned)

Set these in Notion only when the VPS backend deployment begins. They will remain inert until the
matching workflow exists.

| Label                     | Future consumer            | Where / how to generate                                                                               |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `VPS_KUBE_CONFIG`         | k3s deploy workflow        | After k3s install: `cat /etc/rancher/k3s/k3s.yaml` on the VPS, replace `127.0.0.1` with `VPS_HOST_IP` |
| `KEYCLOAK_ADMIN_PASSWORD` | `4-deploy-auth` (archived) | Auto-rotatable; generate via Notion or `openssl rand -base64 32`                                      |
| `DB_PASSWORD`             | `4-deploy-auth` (archived) | Auto-rotatable; same as above                                                                         |

---

## ⚙️ Rotation cadence summary

| Cadence                                      | Trigger                            | Secrets affected                                                               |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| **Monthly auto** (1st @ 00:00 UTC)           | `secret-rotate.yml` cron           | All Notion rows with `CanAutoRotate=✅` (n8n, wiki.js, db passwords) |
| **Monthly Terraform sync** (1st @ 02:00 UTC) | `secrets-terraform.yml` cron       | VPS / Cloudflare / Terraform Cloud variables                                   |
| **On Notion edit**                           | Manual run of `secret-encrypt.yml` | Whatever you changed — `secret-sync.yml` auto-fires after commit               |
| **Manual 90d**                               | Calendar reminder                  | All external AI provider keys + `VITE_FIREBASE_TOKEN` + `GH_PAT_KEY`           |
| **Manual 180d**                              | Calendar reminder                  | `GCP_SA_KEY`                                                                   |
| **Annual / on compromise**                   | Manual                             | `SOPS_AGE_KEY`, `NOTION_API_TOKEN`                                             |

---

## ➕ How to add a new secret end-to-end

1. **Notion** → open the Secrets DB → **New row**. Fill `Name` (the env var label), `Value`, `Type`,
   `Used By`, `CanAutoRotate`, `NextRotation`.
2. **Repo** → if a Cloud Function needs it, add `const newKey = defineSecret('NEW_KEY');` in
   `functions/index.js` and pass it into the function's `secrets: [...]` option.
3. **Sync filter** → if the new secret is consumed by Cloud Functions **and** its prefix is not
   already in `secret-sync.yml` line 113, add the prefix to that list.
4. **Run** `secret-encrypt.yml` manually → confirm commit to
   `infrastructure/secrets/.secrets.enc.yaml` → `secret-sync.yml` auto-fires.
5. **Update this file** → add a row in the appropriate section above (Frontend / AI / Workflow /
   Infra).
6. **Deploy** → re-deploy whatever consumes it (`deploy-functions.yml` or `deploy-frontend.yml`).

---

## 🆘 If you lose `SOPS_AGE_KEY`

The encrypted file becomes unrecoverable. Recovery procedure:

1. Generate a new key: `age-keygen -o ~/.config/sops/age/keys.txt`
2. Run `./scripts/bootstrap-secrets.ps1` (it derives the public key and rewrites `.sops.yaml` and
   `SOPS_AGE_KEY` in one shot)
3. Run `gh workflow run secrets-resync.yml` — it will re-encrypt **from Notion** (the source of
   truth) with the new key and re-distribute everywhere
4. Verify the run shows green on all jobs

**This is why Notion is the source of truth and not the encrypted file.**

---

## 🧭 Workflow orchestration map

```
Notion (source of truth)
  │
  │  bootstrap-secrets.ps1 (one-time seed, 4 secrets)
  │       └──> GH Actions: NOTION_API_TOKEN, NOTION_SECRETS_DB_ID,
  │                        SOPS_AGE_KEY, GH_PAT_KEY
  │
  └──> secret-encrypt.yml (Notion → SOPS encrypt → commit)
            │
            ├──> secret-sync.yml      (auto on push of .secrets.enc.yaml)
            │       └──> GH Actions secrets + Firebase Secret Manager
            │
            └──> secrets-terraform.yml (manual or monthly cron)
                    └──> Terraform Cloud workspace vars

  secrets-resync.yml = one-button orchestrator that runs all three in sequence
  secret-rotate.yml  = monthly auto-rotation of `CanAutoRotate=✅` rows
```

---

## 🪤 Known gotchas (lessons from the field)

- **Reusable workflows**: caller `permissions:` must be ≥ callee's. If `secret-encrypt.yml` needs
  `contents: write` to commit, the caller (`secrets-resync.yml`) must grant the same. Mismatches
  produce `startup_failure` with **no logs and no jobs** — diagnose via the workflow file, not the
  run.
- **`gh secret set` via pipe (`$value | gh secret set --body -`)** appends a trailing CRLF on
  Windows, silently corrupting values (e.g., DB IDs get `\r\n` appended → "Invalid request URL").
  Always pass `--body $clean` as an argument after stripping `\r`.
- **TFC variable API payload**: build with `jq -n --arg key --arg value --argjson sensitive`, not
  `printf` with `jq -Rs .` inside `"%s"` (that double-quotes the value → HTTP 400).
- **Poll jobs in reusable-workflow chains have no checkout**. `gh run list` needs repo context — set
  `env: GH_REPO: ${{ github.repository }}` so it works without a working tree.
- **husky/commitlint**: `body-max-line-length: 100`. Wrap long commit bodies with multiple `-m`
  flags. Failed commit-msg auto-stashes — `git stash pop` after rebasing.
