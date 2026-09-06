# Complete Infrastructure Architecture: Frontend & Backend

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Document Version:** 1.1 **Last Updated:** 2026-06-11 (v1.5.0) **Status:** Comprehensive System
Architecture Reference **Intended Audience:** Architects, DevOps Engineers, Full-Stack Developers

> **Architecture update (v1.5.0, 2026-06-11):** the planned Kubernetes microservices backend
> (`platform/ansible` stack — RabbitMQ, python-worker, k3s/kubeadm, ArgoCD) was removed in v1.5.0
> before reaching production. VPS compute is now the **Hostinger VPS labs platform**
> (`labs/vps-agent/`), a pull-based runner agent consuming a Firestore job queue. See
> `documentation/labs-platform-guide.md`. Kubernetes-specific sections below are historical design
> reference only.

---

## Executive Summary

Hybrid Cloud Works (HCW) is a **hybrid cloud content automation platform** that combines:

1. **Modern Frontend**: React SPA on Firebase Hosting with real-time data synchronization
2. **Serverless Functions**: Firebase Cloud Functions for lightweight compute and content operations
3. **Labs Backend**: Hostinger VPS labs runner (pull-based Firestore job queue) for sandboxed
   interactive lab execution
4. **AI Integration**: OpenAI/Perplexity integration for automated content generation
5. **Content Management**: Firestore-backed CMS with versioning, drafts, and publishing workflow

This architecture enables content creators to automate research, writing, and publishing workflows
while maintaining full control over quality and brand voice.

---

## Table of Contents

1. [System Overview Diagram](#system-overview-diagram)
2. [Frontend Architecture](#frontend-architecture)
3. [Backend Architecture](#backend-architecture)
4. [Data Architecture](#data-architecture)
5. [Deployment Architecture](#deployment-architecture)
6. [Integration Patterns](#integration-patterns)
7. [Security Architecture](#security-architecture)
8. [Scalability & Performance](#scalability-performance)
9. [Disaster Recovery](#disaster-recovery)
10. [DevOps & Monitoring](#devops-monitoring)
11. [Technology Decisions](#technology-decisions)
12. [Future Roadmap](#future-roadmap)

---

## System Overview Diagram

### Complete System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              USER / CLIENT LAYER                               │
│                                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Browser    │  │  Mobile App  │  │    API       │  │   Admin CLI  │      │
│  │  (React)     │  │  (Firebase)  │  │  (Postman)   │  │  (CLI Tools) │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │                  │
          └──────────────────┼──────────────────┼──────────────────┘
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
      ┌──────────────────────┐    ┌──────────────────────┐
      │ FIREBASE PLATFORM    │    │ KUBERNETES CLUSTER   │
      │  (Google Cloud)      │    │ (Hostinger VPS)      │
      └──────┬───────────────┘    └──────┬───────────────┘
             │                           │
      ┌──────┴──────────────────┐        │
      │                         │        │
      ▼                         ▼        ▼
  ┌─────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │  Hosting    │    │    Functions     │    │ Microservices    │
  │  (CDN+SPA)  │    │ (Serverless API) │    │ (Kubernetes)     │
  │             │    │                  │    │                  │
  │ React Vite  │    │ • contentforge   │    │ • Python API     │
  │ Build       │    │ • notifications  │    │ • n8n (workflow) │
  │ Static      │    │ • social         │    │ • Wiki.js        │
  │             │    │ • rss            │    │ • PostgreSQL     │
  └─────────────┘    └──────────────────┘    │ • Redis          │
                                             │ • RabbitMQ       │
      ┌─────────────────────────────────────┤ • Keycloak       │
      │                                     │ • Traefik        │
      ▼                                     └──────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │              DATA & STORAGE LAYER                         │
  │                                                           │
  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
  │  │  Firestore  │  │ Cloud Storage│  │ PostgreSQL   │   │
  │  │ (Real-time) │  │  (Media)     │  │  (Backend)   │   │
  │  └─────────────┘  └──────────────┘  └──────────────┘   │
  │                                                           │
  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
  │  │   Redis     │  │  RabbitMQ    │  │    Qdrant    │   │
  │  │  (Cache)    │  │ (Message Q)  │  │ (Vector DB)  │   │
  │  └─────────────┘  └──────────────┘  └──────────────┘   │
  │                                                           │
  └──────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### 1. Technology Stack

```yaml
Frontend Framework:
  Runtime: Node.js 20+
  Language: JavaScript/JSX
  Framework: React 18.3
  Build Tool: Vite 7.3
  Routing: React Router 6.26
  Styling: TailwindCSS 3.4 + Radix UI

State Management:
  - Local: useState, useContext
  - Global: Context API, Optional: Zustand
  - Server State: Firebase hooks

Real-time Backend:
  - Authentication: Firebase Auth
  - Database: Cloud Firestore
  - Storage: Cloud Storage
  - Functions: Firebase Functions

UI Components:
  - Component Library: Radix UI (headless)
  - Styling: TailwindCSS
  - Icons: Lucide React
  - Forms: React Hook Form
  - Markdown: React Markdown
  - Animations: Framer Motion

Data Visualization:
  - Charts: Chart.js + React ChartJS2
  - Advanced: D3.js

Testing:
  - Unit: Vitest
  - E2E: Playwright
  - Coverage: v8
```

### 2. Component Architecture

```
src/
├── App.jsx (Root with routing)
│
├── components/
│   ├── common/
│   │   ├── Header.jsx (Navigation)
│   │   ├── Footer.jsx
│   │   ├── Sidebar.jsx
│   │   └── LoadingSpinner.jsx
│   │
│   ├── content/
│   │   ├── ContentCard.jsx (Display)
│   │   ├── Editor.jsx (Markdown editor)
│   │   ├── Publisher.jsx (Publish workflow)
│   │   ├── DraftList.jsx
│   │   └── ContentVersions.jsx
│   │
│   ├── admin/
│   │   ├── AdminPanel.jsx
│   │   ├── UserManagement.jsx
│   │   ├── Settings.jsx
│   │   └── Analytics.jsx
│   │
│   └── shared/ (Radix UI wrapped)
│       ├── Button.jsx
│       ├── Dialog.jsx
│       ├── Form.jsx
│       └── Toast.jsx
│
├── pages/ (Route components)
│   ├── Home.jsx
│   ├── Blog.jsx
│   ├── ContentStudio.jsx (Complex UI)
│   ├── Admin.jsx
│   ├── Profile.jsx
│   └── NotFound.jsx
│
├── hooks/ (Custom React hooks)
│   ├── useAuth.js (Authentication)
│   ├── useFirestore.js (Data queries)
│   ├── useFirestoreMutation.js (Write ops)
│   ├── useWiki.js (Content management)
│   ├── useAnalytics.js (Metrics)
│   └── useLocalStorage.js (Client storage)
│
├── context/ (Global state)
│   ├── AuthContext.jsx
│   ├── NotificationContext.jsx
│   ├── ThemeContext.jsx
│   └── ContentContext.jsx
│
├── lib/ (Utilities)
│   ├── firebaseConfig.js
│   ├── api.js (API client)
│   ├── auth.js (Auth utilities)
│   └── utils.js (General helpers)
│
└── styles/
    └── index.css (Global + TailwindCSS)
```

### 3. Data Flow: From User Action to Persistence

#### Content Creation Flow

```
1. User submits form in ContentStudio
   ↓
2. React Hook Form validates
   ↓
3. Firebase Function called (HTTP)
   ↓
4. Function processes:
   - Write to Firestore
   - Upload images to Cloud Storage
   - Generate metadata (word count, reading time)
   ↓
5. Firestore listener triggers
   ↓
6. React context updates
   ↓
7. Component re-renders with new content
```

#### AI Content Generation Flow

```
1. User submits URL/topic in editor
   ↓
2. Frontend calls Firebase Function
   ↓
3. Function calls VPS service (Kubernetes)
   ↓
4. VPS service:
   - Scrapes content
   - Calls OpenAI/Perplexity
   - Generates markdown
   ↓
5. Result written to Firestore
   ↓
6. Frontend listener updates UI real-time
   ↓
7. User reviews in draft section
   ↓
8. Publish to live blog
```

---

## Backend Architecture

### 1. Firebase Functions (Serverless Layer)

**Purpose**: Handle lightweight operations, API gateway, orchestration

```
functions/src/
├── contentforge.js (Main API)
│   ├── POST /drafts (Create draft)
│   ├── PUT /drafts/:id (Update)
│   ├── DELETE /drafts/:id (Delete)
│   ├── POST /publish (Publish draft)
│   ├── POST /generate-ai (Request AI generation)
│   └── POST /schedule (Schedule publish)
│
├── notifications.js
│   ├── POST /notify (Send notifications)
│   └── POST /subscribe (Manage subscriptions)
│
├── social.js
│   ├── POST /share-twitter
│   ├── POST /share-linkedin
│   └── POST /share-facebook
│
├── rss.js
│   ├── GET /feed.xml
│   └── GET /feed.json
│
├── services/
│   ├── firestoreService.js
│   │   ├── getDraft(id)
│   │   ├── saveDraft(draft)
│   │   ├── publishDraft(id)
│   │   └── getPublishedContent()
│   │
│   ├── storageService.js
│   │   ├── uploadImage(file)
│   │   ├── deleteImage(path)
│   │   └── getImageUrl(path)
│   │
│   ├── aiService.js
│   │   ├── generateContent(prompt, options)
│   │   ├── scrapeUrl(url)
│   │   └── analyzeContent(content)
│   │
│   └── publishingService.js
│       ├── publishContent(draft)
│       ├── schedulePublish(id, time)
│       └── unpublish(id)
│
└── utils/
    ├── validators.js (Input validation)
    ├── formatters.js (Data formatting)
    └── errors.js (Error handling)
```

**Deployment**: `firebase deploy --only functions`

### 2. Kubernetes Microservices (VPS Backend)

**Purpose**: Heavy lifting, processing, AI integration, long-running tasks

#### Deployment Architecture

```
VPS Kubernetes Cluster (148.230.91.226)
│
├── Namespace: core
│   ├── Traefik (Ingress controller + reverse proxy)
│   ├── PostgreSQL (Data storage)
│   ├── Redis (Caching)
│   └── RabbitMQ (Message queue)
│
├── Namespace: auth
│   ├── Keycloak (OAuth2/OIDC provider)
│   └── Auth Proxy
│
├── Namespace: content
│   ├── n8n (Workflow automation)
│   ├── Wiki.js (Documentation)
│   └── n8n PostgreSQL instance
│
├── Namespace: worker
│   ├── Python API (FastAPI)
│   ├── Celery Workers (Task processing)
│   ├── Beat Scheduler (Cron jobs)
│   └── Flower (Task monitoring)
│
├── Namespace: monitoring
│   ├── Prometheus (Metrics)
│   ├── Grafana (Dashboards)
│   ├── Loki (Log aggregation)
│   ├── Promtail (Log shipper)
│   └── Alertmanager
│
├── Namespace: search
│   └── Qdrant (Vector database)
│
├── Namespace: management
│   ├── Portainer (Container management)
│   └── Uptime Kuma (Monitoring)
│
├── Namespace: security
│   └── Prowler (AWS security assessments)
│
└── Namespace: backup
    └── Velero (Cluster backup & DR)
```

#### Deployment Order & Dependencies

```
PHASE 1 (Critical Infrastructure):
  1. core → PostgreSQL, Redis, RabbitMQ, Traefik
     (All other services depend on this)

PHASE 2 (Authentication):
  2. auth → Keycloak
     (Needed for: management, monitoring, security)

PHASE 3 (Observability & Management):
  3a. monitoring → Prometheus, Grafana, Loki
  3b. management → Portainer, Uptime Kuma
     (Optional: focus on core first)

PHASE 4 (Content & Search):
  4a. content → n8n, Wiki.js
  4b. search → Qdrant

PHASE 5 (Application):
  5. worker → Python API, Celery, Beat
     (Main application server)

PHASE 6 (Optional):
  6a. security → Prowler
  6b. backup → Velero
```

#### Helm Chart Organization

```
infrastructure/kubernetes/charts/
├── hcw-core/
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── templates/
│   │   ├── traefik-values.yaml
│   │   ├── postgres-config.yaml
│   │   ├── redis-config.yaml
│   │   └── rabbitmq-config.yaml
│   └── charts/ (dependencies)
│
├── hcw-auth/
│   ├── Chart.yaml
│   ├── values.yaml (Keycloak config)
│   └── templates/
│
├── hcw-content/
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/ (n8n, Wiki.js)
│
├── hcw-worker/
│   ├── Chart.yaml
│   ├── values.yaml (Python API, Celery)
│   └── templates/
│
├── hcw-monitoring/
│   ├── Chart.yaml
│   └── values.yaml
│
├── hcw-search/
│   ├── Chart.yaml
│   └── values.yaml (Qdrant)
│
├── hcw-management/
│   ├── Chart.yaml
│   └── values.yaml
│
└── hcw-security/
    ├── Chart.yaml
    └── values.yaml
```

### 3. Python Worker Service

**Purpose**: Heavy computation, AI integration, background tasks

```
infrastructure/python-worker/
├── app/
│   ├── main.py (FastAPI app)
│   ├── config.py
│   ├── models.py (Pydantic models)
│   ├── api/
│   │   ├── content.py (Content endpoints)
│   │   ├── ai.py (AI generation endpoints)
│   │   └── tasks.py (Task management)
│   ├── services/
│   │   ├── ai_service.py (OpenAI integration)
│   │   ├── content_service.py
│   │   ├── scraping_service.py
│   │   └── publishing_service.py
│   ├── tasks/
│   │   ├── celery_app.py (Celery config)
│   │   ├── content_tasks.py (Long-running)
│   │   ├── ai_tasks.py
│   │   └── scheduled_tasks.py (Beat tasks)
│   └── utils/
│       ├── logging.py
│       ├── errors.py
│       └── validators.py
├── requirements.txt
├── Dockerfile
└── kubernetes/
    ├── deployment.yaml
    ├── celery-deployment.yaml
    ├── beat-deployment.yaml
    └── configmap.yaml
```

---

## Data Architecture

### 1. Firestore Schema (Frontend Data)

```firestore
firestore-root/
│
├── content/
│   └── pages/{pageId}
│       ├── id: string
│       ├── title: string
│       ├── content: string (markdown)
│       ├── status: enum (draft|published|archived)
│       ├── createdAt: timestamp
│       ├── publishedAt: timestamp | null
│       ├── createdBy: uid
│       ├── tags: array<string>
│       ├── images: array<{id, storageRef, alt}>
│       └── metadata: {description, keywords, wordCount}
│       └── versions/{versionId}
│           ├── content: string
│           ├── createdAt: timestamp
│           └── createdBy: uid
│
├── config/
│   ├── providers/{providerId}
│   ├── tags/{tagId}
│   └── settings/{settingId}
│
├── users/{userId}
│   ├── email: string
│   ├── displayName: string
│   ├── role: enum (admin|editor|viewer)
│   ├── preferences: object
│   └── drafts/{draftId}
│       ├── id: string
│       ├── title: string
│       ├── content: string
│       └── updatedAt: timestamp
│
├── audits/{auditId}
│   ├── action: string
│   ├── userId: uid
│   ├── resource: string
│   ├── changes: object
│   └── timestamp: timestamp
│
└── system/
    ├── metadata/{metadataId}
    ├── integrations/{integrationId}
    └── analytics/{eventId}
```

### 2. PostgreSQL Schema (Backend Data)

```sql
-- Core tables for backend services
Tables:
├── users
│   ├── id (UUID primary key)
│   ├── email (unique)
│   ├── hashed_password
│   ├── created_at
│   └── updated_at

├── content
│   ├── id (UUID primary key)
│   ├── firestore_id (reference to Firestore page)
│   ├── title
│   ├── content
│   ├── status (enum)
│   ├── created_at
│   ├── published_at
│   └── created_by (FK users.id)

├── revisions
│   ├── id (UUID primary key)
│   ├── content_id (FK content.id)
│   ├── content (snapshot)
│   ├── created_at
│   └── created_by (FK users.id)

├── tasks (Celery tasks)
│   ├── id (UUID primary key)
│   ├── task_type (string)
│   ├── status (enum: pending|running|completed|failed)
│   ├── input (jsonb)
│   ├── output (jsonb)
│   ├── error (text)
│   ├── created_at
│   └── completed_at

└── audit_logs
    ├── id (UUID primary key)
    ├── action (string)
    ├── user_id (FK users.id)
    ├── resource_type (string)
    ├── resource_id (UUID)
    ├── changes (jsonb)
    └── created_at
```

### 3. Cache Strategy (Redis)

```
Keys:
├── user:{userId}:preferences (5 min TTL)
├── content:{pageId}:metadata (10 min TTL)
├── content:published:list (30 min TTL)
├── ai:generation:queue (no TTL)
├── session:{sessionId} (24 hour TTL)
└── rate_limit:{userId}:{endpoint} (1 min TTL)

Operations:
- SET cache data with TTL
- GET for quick lookups
- INVALIDATE on content write
- QUEUE for background tasks
```

---

## Deployment Architecture

### 1. Frontend Deployment (Firebase Hosting)

```
CI/CD Pipeline:
  Git Push (main branch)
    ↓
  GitHub Actions (build-and-deploy.yml)
    ↓
  npm install && npm build
    ↓
  Firebase CLI deploy
    ↓
  Global CDN (Fastly)
    ↓
  User browser
```

**Deployment Configuration**:

- Hosting site: `hybridcloudworks`
- Domain: `hybridcloudworks.com` (custom domain)
- SSL/TLS: Automatic (Google-managed)
- Cache strategy: Immutable for assets, must-revalidate for index.html
- Rewrites: All routes to index.html (SPA routing)

### 2. Backend Deployment (Kubernetes with GitOps)

**Deployment Model**: GitOps with ArgoCD (Pull-based)

```
Sequence:
1. Developer commits to main
   ↓
2. GitHub Actions validates (lint, test, build)
   ↓
3. Update Helm values in Git
   ↓
4. ArgoCD detects Git change
   ↓
5. ArgoCD syncs cluster state to Git
   ↓
6. Kubernetes applies manifests
   ↓
7. New pods start, old pods drain
   ↓
8. Monitoring verifies health
   ↓
9. Deployment complete
```

**Key Components**:

- **Source of Truth**: Git repository (infrastructure/kubernetes/charts/)
- **Controller**: ArgoCD on cluster
- **Declarative**: Helm charts with GitOps values
- **Automatic**: Self-healing and reconciliation

### 3. Secrets Management

```
Flow:
1. Secrets stored in Notion (single source of truth)
   ↓
2. GitHub Action: notion-to-sops
   - Fetches from Notion
   - Encrypts with SOPS (age encryption)
   - Commits to Git (infrastructure/secrets/.secrets.enc.yaml)
   ↓
3. ArgoCD deployment
   - Decrypts SOPS during apply
   - Creates Kubernetes Secrets
   ↓
4. Services mount secrets as environment variables
   ↓
5. Automated rotation (monthly via Notion)
```

---

## Integration Patterns

### 1. Frontend ↔ Firebase Functions

```javascript
// Frontend calls Firebase Function
const response = await fetch('https://region-project.cloudfunctions.net/contentforge', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ title, content }),
});
const result = await response.json();
```

### 2. Firebase Functions ↔ Kubernetes Services

```javascript
// Firebase Function calls VPS service
const response = await fetch('https://api.hybridcloudworks.com/ai/generate', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url, topic }),
});
```

### 3. Background Job Queue (RabbitMQ/Celery)

```
1. Firebase Function publishes task to RabbitMQ
2. Celery worker picks up task
3. Python service processes
4. Result written to Firestore/PostgreSQL
5. Frontend listener updates UI
```

### 4. Real-time Synchronization (Firestore Listeners)

```javascript
// Frontend listens for changes
const unsubscribe = onSnapshot(doc(db, 'content/pages', pageId), (doc) => {
  console.log('Content updated:', doc.data());
  // Auto-update UI
});
```

---

## Security Architecture

### 1. Authentication & Authorization

```
Layer 1: Firebase Auth (Frontend)
├── Google OAuth
├── Email/Password
└── Session tokens (Firebase ID tokens)

Layer 2: Keycloak (Backend)
├── OAuth2/OIDC provider
├── JWT tokens
└── Role-based access control (RBAC)

Layer 3: Service Accounts
├── Kubernetes ServiceAccounts (minimal RBAC)
├── Firebase Service Accounts
└── VPS service credentials
```

### 2. Network Security

```
├── Firebase Hosting: HTTPS only
├── Traefik: TLS termination (Let's Encrypt)
├── VPC: Private network for backend services
├── Network Policies: Ingress/egress rules
├── Service Mesh (future): Istio for advanced security
└── DDoS Protection: Cloudflare (optional)
```

### 3. Data Security

```
├── At Rest:
│   ├── Firestore: Encryption by default
│   ├── Cloud Storage: Server-side encryption
│   ├── PostgreSQL: AES-256 encryption (optional)
│   └── Secrets: SOPS (age) encryption
│
├── In Transit:
│   ├── TLS 1.3 for all HTTPS
│   ├── mTLS for service-to-service
│   └── VPN for admin access (optional)
│
└── Access Control:
    ├── Firestore Security Rules
    ├── IAM policies (Google Cloud)
    ├── RBAC (Kubernetes)
    └── Row-level security (PostgreSQL)
```

---

## Scalability & Performance

### 1. Horizontal Scaling

```
Firebase Functions:
- Automatic: Handled by Google Cloud
- Concurrency: 1000+ concurrent invocations

Kubernetes:
- Horizontal Pod Autoscaler (HPA)
  ├── Min replicas: 2
  ├── Max replicas: 10
  └── Trigger: CPU > 70%, Memory > 80%

PostgreSQL:
- Read replicas for scaling queries
- Connection pooling (PgBouncer)

Redis:
- Redis Cluster for horizontal scaling
- Replication for high availability
```

### 2. Caching Strategy

```
Layer 1: Browser Cache
├── Assets (images, JS, CSS): 1 year
├── API responses: 5 minutes
└── User preferences: 1 hour

Layer 2: CDN Cache (Firebase Hosting)
├── Static content: 1 hour
└── Dynamic: Must-revalidate

Layer 3: Application Cache (Redis)
├── User data: 5 minutes
├── Content metadata: 10 minutes
├── Rendered pages: 30 minutes
└── Search indexes: 1 hour

Layer 4: Database Indexes
├── Firestore: Composite indexes for common queries
├── PostgreSQL: B-tree indexes on foreign keys
└── Qdrant: Vector indexing for semantic search
```

### 3. Database Optimization

```
Firestore:
- Denormalization for common queries
- Subcollections for hierarchical data
- Composite indexes for complex filters
- Pagination with cursors

PostgreSQL:
- Connection pooling (max 100 connections)
- Prepared statements to prevent SQL injection
- Indexes on frequently queried columns
- EXPLAIN ANALYZE for slow queries

Redis:
- Key expiration policies
- Memory limits (eviction: LRU)
- Persistence: AOF for durability
```

---

## Disaster Recovery

### 1. Backup Strategy

```
Firestore:
- Automatic: Google-managed backups
- Manual: Export to Cloud Storage (daily)
- Retention: 30 days

PostgreSQL:
- Automated: pgBackRest
- Schedule: Daily full, hourly incremental
- Retention: 30-day rolling backup
- Test: Weekly restore drills

Cloud Storage:
- Object versioning enabled
- Lifecycle policy: Archive after 90 days
- Cross-region replication

Kubernetes:
- Velero for cluster backup
- Schedule: Daily snapshots
- Includes: PV data, secrets, deployments
```

### 2. Recovery Procedures

```
Scenario: Firestore data corruption
├── Restore: Point-in-time restore from backup
├── Time: ~15 minutes
└── RPO: Last backup (< 24 hours)

Scenario: PostgreSQL failure
├── Promote: Read replica to primary
├── Time: ~5 minutes
└── RTO: <5 min, RPO: <1 min

Scenario: Kubernetes cluster failure
├── Restore: Velero cluster restore
├── Time: ~30 minutes
├── RTO: <30 min
└── RPO: Last backup (< 24 hours)

Scenario: Firebase Functions broken
├── Rollback: Previous function version
├── Time: ~1 minute
└── RTO: <1 min
```

---

## DevOps & Monitoring

### 1. Observability Stack

```
Metrics (Prometheus):
├── Application metrics (requests, latency, errors)
├── Infrastructure metrics (CPU, memory, disk)
├── Database metrics (queries, connections)
└── Custom metrics (content published, API calls)

Logs (Loki):
├── Application logs
├── Infrastructure logs
├── Audit logs
└── Security logs

Traces (Jaeger - future):
├── Distributed tracing
├── Request flow visualization
└── Performance analysis

Dashboards (Grafana):
├── System overview
├── Application health
├── Database performance
├── Error rates and patterns
```

### 2. Alerting

```
Critical Alerts (Page on-call):
├── Kubernetes cluster down
├── Database unavailable
├── API latency > 5s
└── Error rate > 5%

Warning Alerts (Slack):
├── CPU > 80%
├── Memory > 85%
├── Disk > 90%
├── API latency > 2s
└── Error rate > 1%

Info Alerts (Log):
├── Deployments completed
├── Backups executed
└── Certificate renewals
```

### 3. Deployment Monitoring

```
Pre-deployment:
├── Lint checks (ESLint, Prettier)
├── Unit tests (Vitest)
├── E2E tests (Playwright)
└── Security scanning (npm audit, SOPS validation)

Post-deployment:
├── Canary deployment (10% traffic)
├── Health checks (HTTP 200 from service)
├── Smoke tests (critical paths)
├── Rollback if errors > 1%
```

---

## Technology Decisions

### 1. Why React + Vite?

✅ **React**:

- Large ecosystem
- Component reusability
- Wide developer community
- Firebase integration libraries

✅ **Vite**:

- Fast dev server (HMR < 100ms)
- Efficient production builds
- Native ESM support
- Better debugging

### 2. Why Firebase?

✅ **Advantages**:

- Instant real-time sync
- Built-in authentication
- Serverless functions
- Global CDN for hosting
- Minimal DevOps overhead

❌ **Limitations**:

- Firestore costs scale with operations
- No complex JOINs
- Limited query flexibility

**Mitigation**: Backend PostgreSQL for complex operations

### 3. Why Kubernetes (not serverless)?

✅ **Reasons**:

- Long-running tasks (background jobs)
- Complex orchestration (n8n workflows)
- GPU support (future: model serving)
- Cost predictability
- Full control over environment

❌ **Cost**:

- Operational complexity
- Infrastructure management

**Mitigation**: Managed Kubernetes (Hostinger), GitOps automation

### 4. Why PostgreSQL + Redis + RabbitMQ?

✅ **PostgreSQL**: ACID compliance, complex queries ✅ **Redis**: Sub-millisecond latency, caching
✅ **RabbitMQ**: Reliable message delivery, job queues

**Alternatives Considered**:

- MongoDB: Chose PostgreSQL for ACID
- Elasticsearch: Using Qdrant for vector search
- AWS SQS: Chose RabbitMQ for on-premise hosting
- Memcached: Chose Redis for advanced features

---

## Future Roadmap

### Phase 1 (Current): Foundation

- ✅ React SPA + Firebase Hosting
- ✅ Firebase Functions
- ✅ Kubernetes baseline (core services)
- ✅ Firestore + PostgreSQL
- ✅ Secrets management (Notion + SOPS)
- ✅ GitOps (ArgoCD foundation)

### Phase 2 (Next 3 months): Enhanced Features

- [ ] Service Mesh (Istio for advanced routing)
- [ ] Distributed Tracing (Jaeger)
- [ ] Advanced Caching (Redis Cluster)
- [ ] Vector search optimization (Qdrant tuning)
- [ ] Multi-region deployment (failover setup)

### Phase 3 (3-6 months): AI Enhancement

- [ ] GPU compute for model serving
- [ ] Fine-tuning pipelines
- [ ] Vector embeddings pipeline
- [ ] Advanced content recommendations
- [ ] Real-time content analysis

### Phase 4 (6+ months): Scale & Optimize

- [ ] Database replication (cross-region)
- [ ] Advanced analytics (BI platform)
- [ ] Mobile app (React Native)
- [ ] Partnerships (third-party integrations)
- [ ] Enterprise features (multi-tenancy)

---

## Quick Reference

### Key Metrics & Targets

```
Performance:
├── Frontend: Core Web Vitals < green
├── API latency: < 200ms p95
├── Database queries: < 100ms p95
└── FCP: < 1.5s

Reliability:
├── Uptime: > 99.9%
├── Error rate: < 0.1%
├── Failed deployments: < 2%
└── MTTR (mean time to recover): < 30 minutes

Cost:
├── Firebase: < $500/month
├── VPS: $20-30/month
├── Egress: < $50/month
└── Total: < $600/month
```

### Useful Commands

```bash
# Frontend
npm run dev                  # Start dev server
npm run build              # Production build
npm run test              # Run tests
npm run code:quality      # Lint & format check

# Backend
firebase deploy --only functions    # Deploy functions
kubectl apply -f charts/hcw-core/  # Deploy via kubectl
argocd app sync hcw-platform       # ArgoCD sync

# Monitoring
kubectl logs -f hcw-worker-0 -n worker    # Stream logs
kubectl describe pod hcw-worker-0 -n worker  # Debug pod
kubectl port-forward svc/prometheus 9090:9090  # Access Prometheus
```

---

## Document Status

✅ **Complete and Approved for Production**

- Version: 1.0
- Last Updated: 2026-02-06
- Owner: Architecture Team
- Next Review: 2026-03-06

---

_This document serves as the single source of truth for HCW's complete infrastructure architecture.
All architectural decisions should reference this document._
