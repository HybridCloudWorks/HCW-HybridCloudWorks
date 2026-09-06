# Complete Deployment Pipeline: Frontend & Backend

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Document Version:** 2.1 **Last Updated:** 2026-06-11 (v1.5.0) **Status:** Production-Ready
Deployment Guide **Audience:** DevOps Engineers, Full-Stack Developers, Release Engineers

> **Architecture update (v1.5.0, 2026-06-11):** the Kubernetes/ArgoCD GitOps backend tier
> described in this guide was **removed in v1.5.0** before going to production (the
> `platform/ansible` stack — RabbitMQ, python-worker, k3s/kubeadm, ArgoCD — was deleted). The
> live deployment surfaces are now: **frontend + Cloud Functions via GitHub Actions/Firebase**
> (unchanged, fully accurate below) and the **Hostinger VPS labs platform** (`labs/vps-agent/`,
> pull-based Firestore job queue — deployment covered in
> `documentation/labs-platform-guide.md`). Kubernetes/ArgoCD sections below are retained as
> historical design reference only.

---

## Executive Summary

This document provides a unified guide for deploying **both frontend and backend** components of
Hybrid Cloud Works (HCW). It covers the complete pipeline from code commit to production, including:

- **Frontend**: React SPA on Firebase Hosting (automatic deployments)
- **Backend (historical)**: Kubernetes microservices with GitOps (removed in v1.5.0 — see note
  above; current VPS backend is the labs platform)
- **Integration**: How frontend and backend communicate in production
- **GitHub's Role**: Source of truth, not execution agent
- **Deployment Workflow**: Complete step-by-step procedures

---

## Strategic Deployment Approach

### Two-Tier Deployment Strategy

This project uses a **hybrid deployment model** optimized for each tier:

**Backend: GitOps with ArgoCD (Pull-Based)**

- The old backend infrastructure is being **completely gutted and rebuilt**
- All Kubernetes resources managed via Helm charts in Git
- ArgoCD continuously watches Git and reconciles cluster state
- Zero manual kubectl commands in production
- Self-healing through continuous reconciliation
- Source of truth: `infrastructure/kubernetes/charts/*` in Git

**Frontend: GitHub Workflows + Firebase/Google Cloud (Push-Based)**

- Frontend is already deployed and working in production
- Continues using GitHub Workflows for CI/CD
- Automatic deployment to Firebase Hosting on every main branch commit
- No changes to frontend pipeline needed
- Keep existing workflows and Firebase integration

### Why This Approach?

- **Backend (GitOps)**: Enables safe, auditable, repeatable infrastructure deployments with GitOps
  benefits (rollback, drift detection, compliance)
- **Frontend (Push)**: Firebase/Google Cloud provides automatic deployments with CDN, which is
  already working well
- **No Rip-and-Replace**: Frontend stability is not disrupted; focus is entirely on backend
  modernization

### Key Principle

GitHub remains the **source of truth for both tiers**, but plays different roles:

- **Frontend**: GitHub Actions → Firebase (push model, immediate deployment)
- **Backend**: GitHub repository → ArgoCD (pull model, continuous reconciliation)

### Complete Deployment Pipeline Flow

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│                        1. REPOSITORY SETUP                                         │
│                                                                                     │
│  ┌────────────────────────────┐              ┌──────────────────────────────┐     │
│  │  Application Repository    │              │  GitOps Repository           │     │
│  │  ├── src/                  │              │  └── infrastructure/         │     │
│  │  ├── functions/            │              │      └── kubernetes/         │     │
│  │  └── package.json          │              │          └── charts/         │     │
│  └────────────────────────────┘              └──────────────────────────────┘     │
│                                                                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│                                      │  │                                      │
│   FRONTEND PIPELINE (Push-Based)     │  │  BACKEND PIPELINE (Pull-Based)       │
│                                      │  │                                      │
│  2. CI PIPELINE: GitHub Actions      │  │  2. CI VALIDATION: GitHub Actions    │
│  ┌──────────────────────────────┐    │  │  ┌──────────────────────────────┐   │
│  │ Code Push                    │    │  │  │ Code Push                    │   │
│  └────────┬─────────────────────┘    │  │  └────────┬─────────────────────┘   │
│           │                          │  │           │                         │
│  ┌────────▼─────────────────────┐    │  │  ┌────────▼─────────────────────┐   │
│  │ GitHub Actions Workflow      │    │  │  │ GitHub Actions Workflow      │   │
│  │ - npm ci && npm run build    │    │  │  │ - helm lint                  │   │
│  │ - npm run test               │    │  │  │ - kubeconform                │   │
│  │ - npm run code:quality       │    │  │  │ - git-secrets scan           │   │
│  │ - Build Docker image         │    │  │  │ - npm run build (validate)   │   │
│  └────────┬─────────────────────┘    │  │  └────────┬─────────────────────┘   │
│           │                          │  │           │                         │
│  ┌────────▼─────────────────────┐    │  │  ┌────────▼─────────────────────┐   │
│  │ Push to Container Registry   │    │  │  │ VALIDATION PASSES            │   │
│  │ (ghcr.io/saulpatinojr/...)   │    │  │  │ ✅ Merge to main             │   │
│  └────────┬─────────────────────┘    │  │  └──────────────────────────────┘   │
│           │                          │  │                                      │
│  3. DEPLOYMENT (Push to Firebase)    │  │  3. ARGOCD: Continuous Pull         │
│  ┌────────▼─────────────────────┐    │  │  ┌──────────────────────────────┐   │
│  │ Firebase Hosting Deploy      │    │  │  │ ArgoCD Agent (in cluster)   │   │
│  │ - Deploy React bundle        │    │  │  │ - Polls Git repo every 3m   │   │
│  │ - Update environment vars     │    │  │  │ - Detects manifest changes  │   │
│  │ - Cache bust CDN             │    │  │  │ - Reconciles desired state  │   │
│  └────────┬─────────────────────┘    │  │  │ - Self-healing/drift detect │   │
│           │                          │  │  └────────┬─────────────────────┘   │
│           │                          │  │           │                         │
│  4. LIVE (Immediate)                 │  │  ┌────────▼─────────────────────┐   │
│  ┌────────▼─────────────────────┐    │  │  │ Kubernetes Deployment       │   │
│  │ React SPA Ready              │    │  │  │ - Apply Helm charts         │   │
│  │ - hybridcloudworks.com       │    │  │  │ - Update pods/services      │   │
│  │ - Admin console              │    │  │  │ - Monitor health            │   │
│  │ - Live on Firebase CDN       │    │  │  │ - Scale as needed           │   │
│  └──────────────────────────────┘    │  │  └────────┬─────────────────────┘   │
│                                      │  │           │                         │
│                                      │  │  4. LIVE (Eventual Consistency)     │
│                                      │  │  ┌────────▼─────────────────────┐   │
│                                      │  │  │ Kubernetes Cluster Ready    │   │
│                                      │  │  │ - All pods running          │   │
│                                      │  │  │ - Services operational      │   │
│                                      │  │  │ - ArgoCD shows "Synced"     │   │
│                                      │  │  └──────────────────────────────┘   │
│                                      │  │                                      │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
                    │                                   │
                    └─────────────────┬─────────────────┘
                                      ▼
                        ┌──────────────────────────┐
                        │   PRODUCTION             │
                        │  ┌────────────────────┐  │
                        │  │ Frontend (Firebase)│  │
                        │  │ - React SPA        │  │
                        │  │ - CDN Cached       │  │
                        │  │ - Real-time        │  │
                        │  └────────────────────┘  │
                        │                          │
                        │  ┌────────────────────┐  │
                        │  │ Backend (K8s)      │  │
                        │  │ - 9 Services       │  │
                        │  │ - Self-Healing     │  │
                        │  │ - Auto-Scaling     │  │
                        │  └────────────────────┘  │
                        │                          │
                        │  ┌────────────────────┐  │
                        │  │ Integration        │  │
                        │  │ - API Calls        │  │
                        │  │ - WebSockets       │  │
                        │  │ - Real-time Sync   │  │
                        │  └────────────────────┘  │
                        └──────────────────────────┘
```

### Key Differences

| Aspect                  | Frontend (Push)           | Backend (Pull)            |
| ----------------------- | ------------------------- | ------------------------- |
| **Trigger**             | GitHub Actions (on merge) | Git change (ArgoCD polls) |
| **Deployment Speed**    | Immediate (seconds)       | Eventual (minutes)        |
| **Failure Handling**    | Rollback via Firebase     | Rollback via Git revert   |
| **State Location**      | Firebase console          | Git + Kubernetes          |
| **Manual Intervention** | None (fully automated)    | None (fully automated)    |
| **Scalability**         | Firebase managed          | Kubernetes managed        |

---

## Table of Contents

1. [Overview: Frontend & Backend Deployment](#overview)
2. [GitHub's Role in the Pipeline](#github-role)
3. [GitOps Tool Comparison: ArgoCD vs Flux](#gitops-comparison)
4. [Frontend Deployment Pipeline](#frontend-pipeline)
5. [Backend Deployment Pipeline](#backend-pipeline)
6. [Integrated Deployment Workflow](#integrated-workflow)
7. [Monitoring & Verification](#monitoring)
8. [Rollback Procedures](#rollback)
9. [Troubleshooting](#troubleshooting)
10. [Production Checklist](#checklist)

---

## Overview: Frontend & Backend Deployment {#overview}

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DEVELOPER WORKFLOW                           │
│                                                                  │
│  Feature Branch → Code Review → Merge to main → Production    │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│                   GITHUB REPOSITORY                              │
│                   (Source of Truth)                              │
│                                                                  │
│  ├── src/ (frontend code)                                       │
│  ├── functions/ (Firebase Functions)                            │
│  ├── infrastructure/                                            │
│  │   ├── kubernetes/ (Helm charts)                              │
│  │   ├── secrets/ (SOPS-encrypted)                              │
│  │   └── python-worker/ (Backend services)                      │
│  └── package.json (both frontend & functions)                   │
└────────────┬────────────────────────────────────────────────────┘
             │
      ┌──────┴──────┐
      ▼             ▼
┌────────────┐  ┌──────────────────────────┐
│ FRONTEND   │  │ BACKEND                  │
│ Deployment │  │ Deployment               │
└────────┬───┘  └───────────┬───────────────┘
         │                  │
         ▼                  ▼
┌────────────────────┐  ┌──────────────────────┐
│ Firebase Hosting   │  │ GitOps Controller    │
│ (Automatic)        │  │ (ArgoCD or Flux)     │
│ • Build: npm       │  │ • Watches Git        │
│ • Deploy: Firebase │  │ • Applies Helm       │
│ • Live: CDN        │  │ • Self-healing       │
└────────────────────┘  └──────────────────────┘
         │                  │
         └──────┬───────────┘
                ▼
        ┌──────────────────┐
        │  PRODUCTION      │
        │ ┌──────────────┐ │
        │ │ React SPA    │ │
        │ │ Firebase CDN │ │
        │ └──────────────┘ │
        │ ┌──────────────┐ │
        │ │ Kubernetes   │ │
        │ │ Cluster      │ │
        │ │ 9 Services   │ │
        │ └──────────────┘ │
        └──────────────────┘
```

---

## GitHub's Role in the Pipeline {#github-role}

### What GitHub Does ✅

1. **Source of Truth**
   - All infrastructure code lives in Git
   - Helm charts, manifests, values stored here
   - Immutable history of every change

   ```
   infrastructure/
   ├── kubernetes/charts/
   │   ├── hcw-core/
   │   ├── hcw-auth/
   │   ├── hcw-worker/
   │   └── [6 more charts]
   ├── secrets/
   │   └── .secrets.enc.yaml (SOPS-encrypted)
   └── terraform/
       └── [Infrastructure as Code]
   ```

2. **Version Control**
   - Every change tracked with commit messages
   - Full audit trail of who changed what and when
   - Easy to revert: `git revert <commit>`

3. **Access Control**
   - Branch protection rules on main
   - Required PR reviews before merge
   - CODEOWNERS file for selective approval

4. **Code Review Gate**
   - All infrastructure changes reviewed
   - Tests run before merge (linting, validation)
   - Security scanning on pull requests

5. **CI/CD Validation** (not execution)
   - Validate Helm charts: `helm lint`
   - Validate YAML: `kubeconform`
   - Check secrets aren't committed: `git-secrets`
   - Run tests on code changes

### What GitHub Does NOT Do ❌

| ❌ OLD (Broken)             | ✅ NEW (GitOps)                   |
| --------------------------- | --------------------------------- |
| SSH into VPS                | Git is source of truth            |
| Run kubectl commands        | ArgoCD/Flux runs kubectl          |
| Store kubeconfig in secrets | Use ServiceAccount inside cluster |
| Execute deployments         | Pull desired state from Git       |
| State in CI/CD logs         | State in Git (versioned)          |

### GitHub Actions Role: Validation Only

```yaml
# .github/workflows/validate.yml
name: Validate Infrastructure Changes

on:
  pull_request:
    paths:
      - 'infrastructure/**'
      - 'src/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      # Validate Helm charts
      - run: helm lint infrastructure/kubernetes/charts/*/

      # Validate YAML manifests
      - run: |
          kubeconform infrastructure/kubernetes/charts/*/templates/*.yaml

      # Check for secrets
      - run: git-secrets --scan

      # Build frontend
      - run: npm ci && npm run build

      # Lint code
      - run: npm run code:quality

# NO deployment happens here!
# Just validation
```

### GitHub's Complete Role Summary

```
Developer
  │
  ├─ Writes code (frontend or infrastructure)
  │
  └─ Pushes to feature branch
      │
      └─ Creates Pull Request
          │
          └─ GitHub Actions validates:
              • Helm chart syntax
              • YAML validity
              • Security scanning
              • Code linting
              • No secrets exposed
          │
          └─ Code Review (CODEOWNERS)
              │
              └─ Approve & Merge to main
                  │
                  └─ Push event triggers:
                      • Frontend: Build & Deploy (Firebase)
                      • Backend: Git push only
                          │
                          └─ ArgoCD detects change
                              │
                              └─ Syncs cluster to Git state
```

---

## GitOps Tool Comparison: ArgoCD vs Flux {#gitops-comparison}

### Decision Matrix

| Criterion                | ArgoCD               | Flux CD v2                | Winner for HCW |
| ------------------------ | -------------------- | ------------------------- | -------------- |
| **Web UI**               | Rich, easy rollbacks | No native UI              | ArgoCD         |
| **Resource Usage**       | ~500MB RAM           | ~200MB RAM                | Flux ✅        |
| **Learning Curve**       | Beginner-friendly    | Steeper                   | ArgoCD         |
| **Community Size**       | Large (CNCF Sandbox) | Growing (CNCF Incubating) | ArgoCD         |
| **Multi-cluster**        | Excellent            | Good                      | ArgoCD         |
| **Cost Efficiency**      | Higher               | Lower                     | Flux ✅        |
| **GitOps Purism**        | Good                 | Better                    | Flux ✅        |
| **Production Readiness** | ✅                   | ✅                        | Both           |

### Detailed Comparison

#### **ArgoCD** ✅ Recommended for current HCW

**Pros:**

- Web UI for status visibility (operations teams love this)
- One-click rollbacks
- Large ecosystem of plugins
- Works great with Helm
- Easy to understand for beginners
- Better for multi-cluster scenarios

**Cons:**

- Uses more VPS resources (~500MB RAM base)
- More opinionated
- Can feel "heavy" for simple setups

**When to use:**

```
✅ You want a web dashboard
✅ You need multi-cluster management
✅ Your team is new to GitOps
✅ You have enough VPS resources
✅ You want easy rollbacks
```

**Installation:**

```bash
# 1. Create namespace
kubectl create namespace argocd

# 2. Install ArgoCD
kubectl apply -n argocd -f \
  https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# 3. Expose UI (port-forward or ingress)
kubectl port-forward svc/argocd-server -n argocd 8080:443

# 4. Get initial password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d

# 5. Add Git repository
argocd repo add https://github.com/saulpatinojr/Personal-Site_HCW \
  --username <github-user> \
  --password <github-token>

# 6. Create Application
argocd app create hcw-platform \
  --repo https://github.com/saulpatinojr/Personal-Site_HCW \
  --path infrastructure/kubernetes/charts \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace default
```

#### **Flux CD v2** - Alternative if cost is critical

**Pros:**

- Lightweight (200MB RAM)
- Pure GitOps (every change in Git)
- No external state
- Great for cost-sensitive VPS

**Cons:**

- No web UI (GitHub works as UI)
- Steeper learning curve
- Fewer plugins
- No built-in rollback UI

**When to use:**

```
✅ You want minimal resource usage
✅ Your team understands GitOps deeply
✅ You're happy with kubectl/Git as UI
✅ You need maximum simplicity
✅ Cost optimization is critical
```

**Installation:**

```bash
# 1. Install Flux CLI
curl -s https://fluxcd.io/install.sh | sudo bash

# 2. Create namespace
kubectl create namespace flux-system

# 3. Generate SSH keypair for Git
flux create secret git flux-system \
  --url=ssh://git@github.com/saulpatinojr/Personal-Site_HCW

# 4. Create GitRepository source
flux create source git hcw-platform \
  --url=https://github.com/saulpatinojr/Personal-Site_HCW \
  --branch=main \
  --interval=1m

# 5. Create Kustomization
flux create kustomization hcw-platform \
  --source=hcw-platform \
  --path=./infrastructure/kubernetes \
  --prune=true \
  --interval=5m

# 6. Reconcile
flux reconcile kustomization hcw-platform --with-source
```

### **Current HCW Recommendation: ArgoCD**

Reasons:

1. ✅ Team is learning GitOps (UI helps understanding)
2. ✅ VPS has sufficient resources (4GB+ RAM)
3. ✅ Multi-chart setup benefits from ArgoCD's app management
4. ✅ Easy rollbacks are important for learning phase
5. ✅ Community support is stronger

**Future: Consider Flux when:**

- VPS becomes resource-constrained
- Team is proficient with GitOps
- Cost optimization becomes priority

---

## Frontend Deployment Pipeline {#frontend-pipeline}

> **📖 Full workflow reference:** See [pipeline-cicd-workflows.md](../archive/pipeline-cicd-workflows.md) for
> complete details on all 9 CI/CD workflows, triggers, environment variables, and troubleshooting.

### Trigger: Automatic on Push to main

```
Developer pushes to main
  ↓
GitHub detects push
  ↓
GitHub Actions workflow triggers: deploy-frontend.yml
  ↓
npm ci (clean install)
  ↓
npm run build (Vite)
  ↓
Firebase deploy (hosting only)
  ↓
Live on CDN within 2-3 minutes
```

### Step-by-Step

#### 1. Code Push

```bash
git checkout -b feature/add-content-studio
# Make changes to src/
git add src/
git commit -m "feat: Add AI content generation to studio"
git push origin feature/add-content-studio
```

#### 2. Pull Request & Validation

PR workflows run automatically (see [CI/CD Workflows Reference](../archive/pipeline-cicd-workflows.md)):

- **Check Quality** (`check-quality.yml`) — ESLint, Prettier, unit tests
- **Check E2E** (`check-e2e.yml`) — Playwright end-to-end tests
- **Check Lighthouse** (`check-lighthouse.yml`) — Performance & accessibility
- **Scan Security** (`scan-security.yml`) — Trivy vulnerability scanning

#### 3. Merge to main

- PR approved and merged
- Triggers `deploy-frontend.yml` automatically

#### 4. Automatic Build & Deploy

```yaml
# .github/workflows/deploy-frontend.yml
name: Deploy Frontend

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'public/**'
      - 'index.html'
      - 'vite.config.js'
      - 'package.json'
      - 'package-lock.json'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
        env:
          VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
          # ... other VITE_* vars (see pipeline-cicd-workflows.md)
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.GCP_SA_KEY }}
          projectId: ${{ secrets.VITE_FIREBASE_PROJECT_ID }}
          channelId: live
```

#### 5. Verification

```bash
# Check deployment status in Firebase Console
firebase hosting:sites:get hybridcloudworks

# Or via CLI
firebase hosting:channel:list

# Test the live site
curl -I https://hybridcloudworks.com
# Should return 200 OK
```

### Frontend Deployment Times

| Stage                | Time        | Notes               |
| -------------------- | ----------- | ------------------- |
| GitHub Actions setup | ~30 sec     | Spins up runner     |
| npm ci + build       | 1-2 min     | Cached dependencies |
| Firebase deploy      | ~1 min      | CDN propagation     |
| **Total**            | **2-3 min** | From merge to live  |

---

## Backend Deployment Pipeline {#backend-pipeline}

### Trigger: Git Push (GitOps watches)

```
Developer pushes to main (Kubernetes changes)
  ↓
GitHub Actions validates Helm/YAML
  ↓
Git push recorded
  ↓
ArgoCD detects change (polls every 3 minutes)
  ↓
ArgoCD compares Git state vs Cluster state
  ↓
ArgoCD runs: helm upgrade <charts>
  ↓
Kubernetes rolling update
  ↓
Deployment complete (5-15 minutes depending on service)
```

### Step-by-Step

#### 1. Modify Infrastructure Code

```bash
git checkout -b feature/scale-python-worker
# Edit: infrastructure/kubernetes/charts/hcw-worker/values.yaml

# Change replicas
# Old:
#   replicaCount: 2
# New:
#   replicaCount: 4

git add infrastructure/
git commit -m "feat: Scale Python worker to 4 replicas"
git push origin feature/scale-python-worker
```

#### 2. Pull Request & Validation

```yaml
# GitHub Actions validates (on PR):
- helm lint infrastructure/kubernetes/charts/hcw-worker
- kubeconform infrastructure/kubernetes/charts/hcw-worker/templates/*.yaml
- helm template --debug (dry-run)
- Check for secrets in YAML
```

#### 3. Merge to main

- PR approved → Merge triggers
- **Important**: No automatic deployment yet
- Just a Git commit

#### 4. ArgoCD Detects Change

```
ArgoCD watches: https://github.com/saulpatinojr/Personal-Site_HCW
  ↓
Git repository HEAD changed
  ↓
ArgoCD fetches latest
  ↓
Compares desired (Git) vs actual (Cluster)
  ↓
Difference detected:
  - Old: hcw-worker: 2 replicas
  - New: hcw-worker: 4 replicas
```

#### 5. ArgoCD Syncs

```bash
# ArgoCD runs (automatically):
helm upgrade hcw-worker ./infrastructure/kubernetes/charts/hcw-worker \
  --namespace worker \
  --values infrastructure/kubernetes/values/worker.values.yaml \
  --wait \
  --timeout 10m

# Result:
# Scaling deployment hcw-worker
# Waiting for 2 new replicas to start
# ...
# deployment "hcw-worker" successfully rolled out
```

#### 6. Monitoring During Deployment

```bash
# Watch pod rollout
kubectl rollout status deployment/hcw-worker -n worker -w

# Check new pods
kubectl get pods -n worker -l app=hcw-worker

# View logs
kubectl logs -f deployment/hcw-worker -n worker --all-containers

# If issues, manually sync or rollback via ArgoCD UI
argocd app sync hcw-worker
argocd app rollback hcw-worker  # Revert to previous Git state
```

### Backend Deployment Times

| Stage          | Time         | Notes                       |
| -------------- | ------------ | --------------------------- |
| Push to Git    | Instant      | Code reaches GitHub         |
| ArgoCD poll    | 0-3 min      | Depends on sync interval    |
| Helm upgrade   | 1-2 min      | Chart processing            |
| Rolling update | 3-10 min     | Depends on readiness probes |
| **Total**      | **5-15 min** | From merge to deployed      |

---

## Integrated Deployment Workflow {#integrated-workflow}

### Scenario: Deploy complete feature (Frontend + Backend)

```
Feature: "AI Content Generation"
  - Frontend: New React component (src/pages/ContentStudio.jsx)
  - Functions: New Firebase Function (functions/src/contentforge.js)
  - Backend: New Python endpoint (infrastructure/python-worker/app/api/ai.py)
  - Infrastructure: Scale workers, add environment variables
```

### Timeline

```
T+0:00  Developer creates feature branch
        ├─ src/pages/ContentStudio.jsx (new)
        ├─ functions/src/contentforge.js (new)
        ├─ infrastructure/python-worker/app/api/ai.py (new)
        └─ infrastructure/kubernetes/charts/hcw-worker/values.yaml (updated)

T+0:30  Push to GitHub
        └─ Branch: feature/ai-content-generation

T+1:00  Pull Request created
        ├─ GitHub Actions validates:
        │  ├─ Frontend lint/build: ✅ (2 min)
        │  ├─ Functions: ✅ (1 min)
        │  └─ Helm lint: ✅ (1 min)
        └─ Team reviews, approves

T+2:00  Merge to main
        ├─ Git push recorded
        └─ Both workflows trigger:
        │  ├─ Frontend: Firebase deploy (automatic)
        │  └─ Backend: Git is updated (ArgoCD watches)

T+5:00  Frontend LIVE ✅
        └─ https://hybridcloudworks.com/studio
           React component served, Firebase Functions ready

T+5:00-15:00  Backend deploying (in parallel with frontend)
        ├─ ArgoCD detects change (0-3 min wait)
        ├─ Helm upgrade starts
        │  ├─ Scale hcw-worker to new replicas
        │  ├─ Set environment variables
        │  ├─ Pull new images
        │  └─ Run readiness checks
        └─ Deployment complete

T+15:00 Everything LIVE ✅
        ├─ Frontend: React SPA + Firebase Functions
        ├─ Backend: Python API + Celery workers scaled
        └─ Integration working end-to-end
```

### Key Points

1. **Frontend deploys faster** (5-7 min)
2. **Backend may take longer** (5-15 min depending on service)
3. **Both happen independently** - frontend doesn't wait for backend
4. **No manual steps required** - fully automated
5. **Rollback is simple** - either git revert or ArgoCD rollback

---

## Monitoring & Verification {#monitoring}

### Frontend Verification

```bash
# 1. Check deployment status
firebase hosting:sites:get hybridcloudworks

# 2. Test live site
curl -I https://hybridcloudworks.com
# Expected: 200 OK

# 3. Check browser console
# Open https://hybridcloudworks.com and inspect browser console
# Should show no critical errors

# 4. Verify Firebase Functions
curl https://region-project.cloudfunctions.net/contentforge \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"

# 5. Monitor in Firebase Console
# https://console.firebase.google.com/project/hybridcloudworks-61e8d
# Hosting → Deployments tab shows history
```

### Backend Verification

```bash
# 1. Check ArgoCD sync status
argocd app get hcw-worker
# Expected: Health=Healthy, Sync=Synced

# 2. Verify pods are running
kubectl get pods -n worker
# Expected: All pods Running and Ready (1/1)

# 3. Check Helm release
helm list -n worker
# Expected: STATUS=deployed

# 4. Test backend endpoint
kubectl port-forward svc/hcw-worker 8000:8000 -n worker
curl http://localhost:8000/health
# Expected: {"status": "healthy"}

# 5. Monitor logs
kubectl logs -f deployment/hcw-worker -n worker

# 6. Check Prometheus metrics
kubectl port-forward svc/prometheus 9090:9090 -n monitoring
# Open http://localhost:9090
# Query: rate(http_requests_total[5m])
```

### Monitoring Stack (Post-Deployment)

| Component            | Access                                 | What to Monitor                       |
| -------------------- | -------------------------------------- | ------------------------------------- |
| **Grafana**          | http://grafana.hybridcloudworks.com    | Dashboards: CPU, Memory, Request Rate |
| **Prometheus**       | http://prometheus.hybridcloudworks.com | Raw metrics, custom queries           |
| **Loki**             | Via Grafana                            | Application logs from all pods        |
| **ArgoCD**           | http://argocd.hybridcloudworks.com     | Application sync status, drift        |
| **Firebase Console** | https://console.firebase.google.com    | Frontend usage, error tracking        |

---

## Rollback Procedures {#rollback}

### Frontend Rollback (Firebase)

#### Option 1: Automatic Rollback

```bash
# Firebase keeps last 25 deployments
firebase hosting:channel:list

# Get previous version's hash
PREVIOUS_HASH="abc123def456"

# Rollback to previous deployment
firebase hosting:channel:deploy \
  --channel live \
  --version $PREVIOUS_HASH
```

#### Option 2: Git Revert

```bash
# See what broke
git log --oneline -5 src/

# Revert the problematic commit
git revert <commit-hash>

# Push to main (triggers new build)
git push origin main

# Firebase auto-deploys the reverted code
```

### Backend Rollback (Kubernetes + ArgoCD)

#### Option 1: ArgoCD Rollback (Recommended)

```bash
# See sync history
argocd app history hcw-worker

# Rollback to previous sync
argocd app rollback hcw-worker 1
# (1 = number of revisions back)

# Verify
argocd app get hcw-worker
```

#### Option 2: Git Revert

```bash
# See infrastructure changes
git log --oneline -5 infrastructure/kubernetes/charts/hcw-worker/

# Revert the change
git revert <commit-hash>

# Push to main
git push origin main

# ArgoCD auto-syncs the reverted manifest
argocd app wait hcw-worker
```

#### Option 3: Manual Rollback

```bash
# If urgent (use ArgoCD for permanent fix)

# Scale down broken deployment
kubectl scale deployment hcw-worker --replicas 0 -n worker

# Restore from backup Helm release
helm rollback hcw-worker 1 -n worker
# (1 = previous release number)

# Then fix Git and push
git revert <commit-hash>
git push origin main
# ArgoCD will reconcile
```

### Rollback Timeline

| Method              | Time     | Reversibility          | Use Case             |
| ------------------- | -------- | ---------------------- | -------------------- |
| **Firebase auto**   | 1 min    | Easily reversed        | Small frontend bugs  |
| **Git revert**      | 5-10 min | Tracked in Git history | Coordinated rollback |
| **ArgoCD rollback** | 3-5 min  | Visible in UI          | Backend issues       |
| **Manual kubectl**  | 1-2 min  | Need to fix Git after  | Emergency only       |

---

## Troubleshooting {#troubleshooting}

### Frontend Issues

#### Issue: Firebase Deploy Fails with "Quota Exceeded"

```bash
# Problem: Too many deployments in short time
# Firebase has rate limiting

# Solution: Wait or delete old channels
firebase hosting:channel:list
firebase hosting:channel:delete <channel-name>

# Then retry
firebase deploy --only hosting
```

#### Issue: Site Shows "404 Not Found"

```bash
# Problem: React SPA routing not working

# Check firebase.json rewrites
cat firebase.json | grep -A 5 rewrites

# Should have:
# "rewrites": [
#   {
#     "source": "**",
#     "destination": "/index.html"
#   }
# ]

# If missing, update and redeploy
firebase deploy --only hosting
```

#### Issue: Environment Variables Not Loading

```bash
# Problem: VITE_* variables not exposed

# Vite only exposes VITE_* prefix in browser
echo "VITE_API_BASE_URL=https://api.hybridcloudworks.com" > .env

npm run build

# Verify build contains variable
grep -r "api.hybridcloudworks.com" build/assets/

# If missing, check .env file exists during build
ls -la .env
```

### Backend Issues

#### Issue: Pod Stuck in CrashLoopBackOff

```bash
# 1. Check pod logs
kubectl logs -f <pod-name> -n worker --previous

# 2. Check events
kubectl describe pod <pod-name> -n worker

# 3. Check health probe
kubectl get events -n worker | grep Error

# Common causes:
# - Image not found: Check Docker registry credentials
# - Port already in use: Check service port
# - Readiness probe failing: Check application startup

# 4. Temporary fix (while fixing Git)
kubectl set image deployment/hcw-worker \
  app=<image:previous-tag> -n worker

# 5. Permanent fix: git revert and push
git revert <broken-commit>
git push origin main
```

#### Issue: ArgoCD Shows "OutOfSync"

```bash
# 1. Check what's different
argocd app diff hcw-worker

# 2. Manual sync (temporary)
argocd app sync hcw-worker

# 3. Check why Git is different
git diff HEAD infrastructure/kubernetes/charts/hcw-worker/

# 4. If someone changed cluster manually, revert
git checkout infrastructure/kubernetes/charts/hcw-worker/

# 5. Push fix to Git
git push origin main

# 6. ArgoCD auto-syncs
```

#### Issue: Helm Install Fails with "Timeout"

```bash
# Problem: Pod taking too long to start

# 1. Check pod status
kubectl get pods -n worker -w

# 2. Increase timeout in values
# infrastructure/kubernetes/charts/hcw-worker/values.yaml
timeouts:
  deployment: 15m  # was 10m

git add infrastructure/
git commit -m "fix: increase deployment timeout"
git push origin main

# 3. ArgoCD re-applies with new timeout
```

---

## Production Checklist {#checklist}

### Pre-Deployment

- [ ] Feature branch created with descriptive name
- [ ] All tests pass locally: `npm run test`
- [ ] Code lints: `npm run code:quality`
- [ ] No console errors: `npm run build && npm run preview`
- [ ] Helm charts validate: `helm lint infrastructure/kubernetes/charts/*/`
- [ ] YAML valid: `kubeconform` passes
- [ ] No secrets in code: `git-secrets` passes
- [ ] Database migrations tested (if applicable)
- [ ] Rollback procedure documented

### Deployment

- [ ] PR created with description
- [ ] Code review completed (approved by CODEOWNER)
- [ ] CI/CD workflows pass (all green checkmarks)
- [ ] Merge to main
- [ ] Monitor frontend deployment (5-7 min)
- [ ] Test frontend: https://hybridcloudworks.com
- [ ] Monitor backend deployment (5-15 min)
- [ ] Test backend: `kubectl get pods -n worker`
- [ ] Verify logs show no errors
- [ ] Verify metrics in Prometheus

### Post-Deployment

- [ ] Frontend loads without console errors
- [ ] API endpoints respond correctly
- [ ] No unusual error rates in logs
- [ ] Alerts haven't fired
- [ ] Team notified of deployment
- [ ] Monitor for 30 minutes
- [ ] Document any issues encountered

### Rollback Ready

- [ ] Rollback procedure tested
- [ ] Team knows how to execute rollback
- [ ] Previous versions available
- [ ] Rollback tested in staging

---

## Quick Reference

### Commands Cheat Sheet

```bash
# Frontend
npm run dev              # Local dev server
npm run build           # Production build
firebase deploy         # Deploy to Firebase
firebase hosting:sites:get hybridcloudworks  # Check status

# Backend
kubectl get pods -n worker                  # See deployments
kubectl logs -f pod-name -n worker          # View logs
argocd app get hcw-worker                   # Check sync status
argocd app sync hcw-worker                  # Manual sync
argocd app rollback hcw-worker 1            # Rollback 1 revision
helm upgrade hcw-worker ./charts/hcw-worker # Manual Helm upgrade

# Git
git checkout -b feature/name                # Create branch
git push origin feature/name                # Push branch
git revert <commit>                         # Revert commit
git log --oneline -5                        # View recent commits
```

### Important URLs

| Component        | URL                                                                |
| ---------------- | ------------------------------------------------------------------ |
| Frontend         | https://hybridcloudworks.com                                       |
| Admin Dashboard  | https://hybridcloudworks.com/admin                                 |
| Firebase Console | https://console.firebase.google.com/project/hybridcloudworks-61e8d |
| ArgoCD           | https://argocd.hybridcloudworks.com                                |
| Grafana          | https://grafana.hybridcloudworks.com                               |
| Prometheus       | https://prometheus.hybridcloudworks.com                            |
| GitHub Repo      | https://github.com/saulpatinojr/Personal-Site_HCW                  |

---

## Document Status

✅ **Complete and Production-Ready**

- Version: 1.0
- Last Updated: 2026-02-06
- Owner: DevOps Team
- Next Review: 2026-03-06

---

_This document is the single source of truth for HCW deployment procedures. All deployment
activities should reference this guide._

---

## Consolidated from `pipeline-deployment-checklist.md`

_Merged 2026-05-27 during documentation reorganization. Original archived at
`archive/docs/pipeline-deployment-checklist.md`._

# Deployment Checklist

**Date:** February 10, 2026 **Target:** Firebase Hosting (hybridcloudworks-61e8d) **Status:** 🟢
READY FOR DEPLOYMENT

---

## Pre-Deployment Verification

### ✅ Build Status

- [x] `npm run build` succeeds
- [x] 1847 modules transformed
- [x] dist/ directory created with all assets
- [x] No build errors or critical warnings
- [x] index.html present

### ✅ Configuration Files

- [x] `firebase.json` configured correctly
  - public: "dist" ✅
  - SPA rewrites configured ✅
  - Cache headers configured ✅
- [x] `.firebaserc` project: hybridcloudworks-61e8d ✅
- [x] `firestore.rules` present
- [x] `storage.rules` present

### ✅ Critical Pages Implemented

- [x] HomePage - Full implementation
- [x] AboutPage - Production ready (7.08 kB)
- [x] ContactPage - Production ready (9.40 kB)
- [x] 6 Landing pages (AWS, Azure, GCP, Terraform, GitHub, FinOps)
- [x] Architecture pages for major providers
- [x] Blog pages for major providers
- [x] Header & Footer components
- [x] Design system CSS with provider themes

### ✅ Design System

- [x] Dark glassmorphism styling (#0a0f1a background)
- [x] Provider accent colors applied
- [x] Responsive design (mobile, tablet, desktop)
- [x] Animations (Framer Motion)
- [x] All icons loaded (lucide-react)

### ✅ Dependencies

- [x] React 18+
- [x] Vite 7.x
- [x] Tailwind CSS 3.x
- [x] Firebase SDK
- [x] React Router v6
- [x] Framer Motion
- [x] React Helmet Async

---

## Deployment Instructions

### Step 1: Verify Firebase CLI & Authentication

```bash
# Check Firebase CLI is installed
firebase --version

# Login to Firebase (if not already logged in)
firebase login

# Verify project is set
firebase projects:list
```

### Step 2: Set Environment Variables

Set the following GitHub Secrets (if deploying via CI/CD):

```
VITE_FIREBASE_API_KEY=<your-api-key>
VITE_FIREBASE_AUTH_DOMAIN=hybridcloudworks-61e8d.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=hybridcloudworks-61e8d
VITE_FIREBASE_STORAGE_BUCKET=hybridcloudworks-61e8d.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=<your-sender-id>
VITE_FIREBASE_APP_ID=<your-app-id>
GCP_SA_KEY=<base64-encoded-service-account-json>
FIREBASE_PROJECT_ID=hybridcloudworks-61e8d
```

### Step 3: Build for Production

```bash
cd "C:\Users\saulp\AppData\Workspace\Personal-Site_HCW"
npm ci                    # Clean install
npm run build             # Production build → dist/
```

### Step 4: Preview Build Locally (Optional)

```bash
npm run preview           # Test dist/ on localhost:4173
# Visit http://localhost:4173 and verify:
# - HomePage loads with all 6 provider cards
# - About page shows profile + certs + values
# - Contact page shows form + methods + FAQ
# - Navigation works between pages
# - Dark theme applies correctly
# - No console errors
```

### Step 5: Deploy to Firebase Hosting

**Option A: Deploy via CLI (Recommended)**

```bash
# Deploy only hosting (fastest)
firebase deploy --only hosting --project hybridcloudworks-61e8d

# Or deploy all resources
firebase deploy --project hybridcloudworks-61e8d
```

**Option B: Deploy via GitHub Actions**

```bash
# Push to main branch to trigger frontend-deploy.yml workflow
git add .
git commit -m "Deploy: HCW with AboutPage and ContactPage"
git push origin main

# Watch workflow at: https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions
```

### Step 6: Post-Deployment Verification

```bash
# Test live site
curl https://hybridcloudworks.com

# Verify React root loads
curl https://hybridcloudworks.com | grep 'id="root"'

# Check for 200 status
curl -I https://hybridcloudworks.com

# Test specific pages
curl https://hybridcloudworks.com/about
curl https://hybridcloudworks.com/contact
curl https://hybridcloudworks.com/aws
```

### Step 7: Manual QA

Visit https://hybridcloudworks.com and verify:

- [ ] HomePage loads with proper hero, 6 provider cards, active feeds
- [ ] Navigation header shows all links
- [ ] Footer visible on all pages
- [ ] /about shows Saul profile, 4 certifications, 3 values
- [ ] /contact shows form with all 5 fields, contact methods, FAQ
- [ ] /aws landing shows orange accent, AWS features
- [ ] /azure landing shows blue accent, Azure features
- [ ] /gcp landing shows red accent, GCP features
- [ ] All navigation links work
- [ ] Dark theme applies throughout
- [ ] Provider accent colors show correctly
- [ ] Responsive on mobile (320px), tablet (768px), desktop
- [ ] No console errors (F12 developer tools)
- [ ] Form on /contact can submit without errors
- [ ] Animations smooth at 60fps

---

## Rollback Procedure (If Issues)

### Quick Rollback to Previous Version

```bash
# List recent deployments
firebase hosting:channel:list --project hybridcloudworks-61e8d

# View deployment history
firebase hosting:versions:list --project hybridcloudworks-61e8d

# Rollback to previous version
firebase hosting:rollback --project hybridcloudworks-61e8d

# Or manually re-deploy a working commit
git checkout <commit-hash>
npm ci
npm run build
firebase deploy --only hosting --project hybridcloudworks-61e8d
```

---

## Performance Targets

After deployment, verify:

- [ ] First Contentful Paint (FCP) < 2 seconds
- [ ] Largest Contentful Paint (LCP) < 2.5 seconds
- [ ] Cumulative Layout Shift (CLS) < 0.1
- [ ] Time to Interactive (TTI) < 3.5 seconds

**Check with Google Lighthouse:**

```
1. Open https://hybridcloudworks.com in Chrome
2. Press F12 → Lighthouse tab
3. Generate report
4. Target: 90+ Performance score
```

---

## Monitoring Post-Deployment

### Firebase Console

- **URL:** https://console.firebase.google.com/project/hybridcloudworks-61e8d
- Monitor: Hosting → Metrics
- Check: Traffic, bandwidth, errors

### Google Analytics (if enabled)

- Track pageviews on HomePage, AboutPage, ContactPage
- Monitor user engagement
- Track bounce rates

### GitHub Actions

- **URL:** https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions
- Monitor: frontend-deploy.yml workflow runs
- Ensure all checks pass

---

## Known Limitations (Post-Launch Improvements)

### Pages with Placeholder Content (13 pages)

These can be implemented post-launch:

- Terraform: Code, Modules, Tools, Blog, RSS pages
- GitHub: Workflows, Code, Tools, Blog, RSS pages
- FinOps: Architecture, Frameworks, FOCUS, Tools, Blog, RSS pages

**Estimated time to complete:** 15-20 hours

### Missing Pages (7 pages)

- Tools: Migration, Comparison, Resources, Decisions
- Templates: Framework, Architecture, Rosetta Stone

**Estimated time to create:** 10-15 hours

### Optional Enhancements

- Form submission to Firebase Cloud Functions
- Audio player components for Audio pages
- Radar chart visualizations for Comparison pages
- RSS feed generation
- Admin interface for content management

---

## Deployment Sign-Off

- [x] Build verified
- [x] Critical pages implemented
- [x] Design system complete
- [x] Firebase config correct
- [x] No technical blockers
- [x] Ready for production

**Deployed by:** Claude Code **Date:** February 10, 2026 **Version:** HCW 2.0 (Post Critical Fixes)
**Status:** 🟢 LIVE

---

## Quick Reference

**Firebase Project:** hybridcloudworks-61e8d **Domain:** hybridcloudworks.com **Hosting:** Firebase
Hosting **Build Tool:** Vite **Framework:** React 18 **Styling:** Tailwind CSS 3 **Analytics:**
Google Analytics (if enabled)

**Key Pages:**

- Home: https://hybridcloudworks.com/
- About: https://hybridcloudworks.com/about
- Contact: https://hybridcloudworks.com/contact
- AWS: https://hybridcloudworks.com/aws
- Azure: https://hybridcloudworks.com/azure
- GCP: https://hybridcloudworks.com/gcp

---

## Support & Maintenance

### If Issues After Deployment

1. Check GitHub Actions workflow logs
2. Check Firebase Hosting errors
3. Use rollback procedure above
4. Review deployment-handover.md for troubleshooting

### For Questions

- See: deployment-handover.md (comprehensive guide)
- See: architecture-system-overview.md (technical details)
- Email: hello@hybridcloudworks.com
