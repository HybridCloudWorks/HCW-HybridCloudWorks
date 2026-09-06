# HCW Azure Migration — Task Tracker

!!! note "Historical record"
    Retained as evidence of how the Azure platform was built. Not an active
    runbook for starting a new migration.


## Repo 1: Personal-Site_HCW (Frontend)

### Completed
- [x] Create `staticwebapp.config.json` (Azure Static Web Apps hosting config)
- [x] Create `src/lib/azureConfig.js` (Cosmos DB client-side SDK)
- [x] Update `src/lib/functionsBase.js` — add `VITE_BACKEND_PROVIDER` toggle
- [x] Update `.env.example` — add Azure env vars
- [x] Add `deploy-azure-frontend.yml` workflow

### Auth Update (Entra ID MSAL)
- [ ] Create `src/lib/msalConfig.js` to replace `firebaseConfig.js`
- [ ] Add `@azure/msal-browser` and `@azure/msal-react` to package.json
- [ ] Add `VITE_ENTRA_CLIENT_ID` and `VITE_ENTRA_TENANT_ID` to `.env.example`

### Cleanup (after full migration)
- [ ] Archive `firebase.json` config
- [ ] Archive `.firebaserc`
- [ ] Archive `.github/workflows/deploy-frontend.yml` (Firebase version)
- [ ] Archive `.github/workflows/deploy-functions.yml` (Firebase version)
- [ ] Remove `firebase` module from package.json dependencies

---

## Repo 2: HCW-HybridCloudWorks (New Azure Platform Repo)

### Repo Setup
- [x] Create `HCW-HybridCloudWorks` repo on GitHub
- [x] Initialize with README, .gitignore
- [ ] Set up branch protection rules

### Infrastructure (infra/)
- [x] Create Terraform Azure modules
- [x] Add `terraform.tfvars.example`
- [ ] **NEW**: Add Azure OpenAI Cognitive Services resource to `main.tf`
- [ ] Create `deploy-infra.yml` workflow
- [ ] `terraform init` + `terraform plan`

### Azure Functions (functions/)
- [x] Create project scaffold (package.json, host.json)
- [x] Port cosmos-client.js data access layer
- [x] Port blob-storage.js helpers
- [x] Port auth-middleware.js (Firebase Auth validation - **needs rewrite for Entra ID JWT**)
- [x] Create Key Vault helper (key-vault.js)
- [ ] **NEW**: Add `@azure/openai` to package.json and create `openai-client.js` helper
- [ ] Port CMS HTTP triggers from cms-functions.js
- [ ] Port Labs HTTP triggers from labs-functions.js
- [ ] Port scheduler triggers (9 timers)
- [ ] Port Cosmos DB change feed triggers
- [x] Create `deploy-functions.yml` workflow

### Data Migration (scripts/)
- [x] Create `migrate-firestore-to-cosmos.mjs`
- [x] Create `migrate-storage-to-blob.sh` (stub)
- [x] Create `verify-migration.mjs` (stub)
- [ ] Create `migrate-data.yml` workflow

### VPS Agent (vps-agent/)
- [x] Create vps-agent directory and basic scaffolding
- [ ] Fork `labs/vps-agent` with Cosmos DB SDK
- [ ] Update package.json (@azure/cosmos replaces firebase-admin)
- [ ] Update .env.example for Azure auth
- [ ] Update README runbook

### Documentation (docs/)
- [x] Create architecture.md
- [x] Create migration-runbook.md
- [x] Create cost-analysis.md

### Secrets & CI/CD
- [ ] Create `secret-sync-keyvault.yml` workflow
- [ ] Add AZURE_CREDENTIALS to GitHub Secrets
- [ ] Add COSMOS_ENDPOINT, COSMOS_KEY to GitHub Secrets
