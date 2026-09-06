# Firebase Architecture & Configuration

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 15, 2026 **Version:** 2.2

## Overview

We utilize the **Firebase ecosystem** to provide a serverless backend for **HCW**. This simplifies
operations while providing enterprise-grade scalability and security.

---

## 1. Authentication (Firebase Auth)

- **Providers**: Google Sign-In (primary).
- **Custom Claims**:
  - `admin: true`: Grants write access to Firestore and Storage.
- **Session Management**: Handled by Firebase SDK (persisted local state).
- **Authorized Domains**: `localhost`, `hcw-website.firebaseapp.com`, `hybridcloudworks.com`.

### User Flow

1.  User clicks "Admin Login" (hidden trigger).
2.  Google Pop-up authenticates user.
3.  Cloud Function `onUserCreate` checks whitelist (e.g., `saul.patino@...`).
4.  If whitelisted, assigns `admin` claim.
5.  App refreshes token to get claim.

---

## 2. Data Layer (Cloud Firestore)

**Database ID**: `(default)` **Location**: `us-central1`

### Data Modeling

#### **Collection: `providers`**

Metadata for provider Landing Pages.

- **Doc ID**: `aws`, `azure`, `gcp`, `terraform`, `github`, `finops`
- **Fields**: `name`, `theme: { primary, font }`, `description`

---

#### **Collection: `blogs`** ← Primary Content Store

The `blogs` collection is the **single source of truth** for all multi-type content on the platform.
Documents are differentiated by the `type` field, which controls routing to the correct listing
page, detail template, and admin review board.

**Content Type Routing:**

| `type` value     | Listing Page                                     | Detail Template              | Review Board              |
| ---------------- | ------------------------------------------------ | ---------------------------- | ------------------------- |
| `'blog'`         | `BlogPage` (all 6 providers)                     | Standard blog viewer         | `BlogReviewBoard`         |
| `'architecture'` | `ArchitectureDesignsPage` (AWS/Azure/GCP/FinOps) | `ArchitectureDetailTemplate` | `ArchitectureReviewBoard` |
| `'framework'`    | `FrameworksPage` (AWS/Azure/GCP only)            | `FrameworkDetailTemplate`    | `FrameworkReviewBoard`    |

**Framework Entry Schema (`type: 'framework'`):**

```javascript
{
  type: 'framework',
  contentStatus: 'ingested' | 'published',
  slug: 'aws-well-architected-framework',
  title: 'string',
  summary: 'string',
  cloudProvider: 'AWS' | 'Azure' | 'GCP',
  category: 'string',
  complexity: 'Beginner' | 'Intermediate' | 'Advanced',
  tags: ['string'],
  docLink: 'https://...',
  overviewHtml: '<p>...</p>',
  commandExample: 'aws cloudformation ...',
  keyPillars: ['string'],
  patterns: ['string'],
  terraformCode: '# HCL',
  featured: false,
  source: 'template-form' | 'admin' | 'pipeline',
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**Architecture Entry Schema (`type: 'architecture'`):**

```javascript
{
  type: 'architecture',
  contentStatus: 'ingested' | 'published',
  slug: 'aws-multi-region-dr',
  title: 'string',
  summary: 'string',
  cloudProvider: 'AWS' | 'Azure' | 'GCP' | 'FinOps',
  category: 'string',
  complexity: 'Beginner' | 'Intermediate' | 'Advanced',
  tags: ['string'],
  diagramUrl: 'https://...',
  overviewHtml: '<p>...</p>',
  technicalSpecs: {
    components: ['ELB', 'RDS', 'EC2'],
    patterns: [],
  },
  costAnalysis: {
    estimatedMonthly: 450,
    breakdown: [],
  },
  terraformCode: '# HCL',
  featured: false,
  source: 'template-form' | 'admin' | 'pipeline',
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**Querying pattern (all listing pages):**

```javascript
// Fetch from Firestore
const { data } = useFirestoreQuery('blogs', [
  where('type', '==', 'framework'),
  where('contentStatus', '==', 'published'),
]);
// Filter to provider client-side
const providerItems = data.filter((doc) => (doc.cloudProvider || '').toLowerCase() === 'aws');
// Merge with static fallback (dynamic first)
const items = [...providerItems, ...staticFallbackItems];
```

---

#### **Collection: `unique_content`** ⚠️ LEGACY — Do Not Use

The `unique_content/{providerId}/{contentType}/{slug}` nested path was the original content
architecture. It is **superseded** by the flat `blogs` collection. Existing documents may remain for
backward compatibility but no new content should be written here.

- `ArchitectureDetailTemplate` still falls back to this path as a legacy chain before checking
  `blogs`.
- All other components use `blogs` exclusively.

---

#### **Collection: `shared_content`**

Single source of truth for shared pages.

- **Path**: `shared_content/{pageId}`
- **Page IDs**: `about`, `contact`, `tools_comparison`, `tools_migration`
- **Fields**: same structure as `blogs`.

### Indexing

- **Composite Indexes**: Required for querying `blogs` by `contentStatus` + `type` +
  `cloudProvider` + `createdAt`.

---

## 3. Storage (Cloud Storage)

**Bucket**: `gs://hcw-website.appspot.com`

- **Structure**:
  - `/images/{provider}/{slug}/` - Blog/Article images.
  - `/assets/` - Static site assets (logos, icons).
  - `/users/{userId}/` - User uploads (future).

---

## 4. Hosting (Firebase Hosting)

**Site**: `hcw-website`

- **Configuration**:
  - **Rewrites**: All traffic to `index.html` (SPA routing).
  - **Headers**: Cache-Control for static assets (1 year).
  - **CDN**: Global edge caching for assets.

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

---

## 5. Security Rules (Firestore)

**Strategy**: Public Read / Admin Write.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /{document=**} {
      allow read: if true;
    }
    match /{document=**} {
      allow write: if isAdmin();
    }
  }
}
```

---

## 6. Hybrid Compute Architecture (The "Power Zone")

Heavy computational tasks are offloaded to the Kubernetes VPS via secure API calls.

- **Trigger**: User initiates complex action (e.g., "Calculate FinOps Score", "Run Assessment").
- **Flow**:
  1. Frontend calls `api.hybridcloudworks.com/v1/...` (Traefik Gateway).
  2. Gateway routes to appropriate Microservice (Python FastAPI / n8n Workflow).
  3. Backend performs heavy calculation.
  4. Result returned to Frontend or stored in Firestore.

---

**Version**: 2.2 | **Date**: February 15, 2026

```

## 6. Hybrid Compute Architecture (The "Power Zone")

While the frontend is static (Vite), heavy computational tasks are offloaded to our Kubernetes VPS via secure API calls.

- **Trigger**: User initiates complex action (e.g., "Calculate FinOps Score", "Run Assessment").
- **Flow**:
  1.  Frontend calls `api.hybridcloudworks.com/v1/...` (Traefik Gateway).
  2.  Gateway routes to appropriate Microservice (Python FastAPI / n8n Workflow).
  3.  Backend performs heavy calculation.
  4.  Result returned to Frontend or stored in Firestore.
- **SSR Roadmap**: The backend infrastructure (Stage 3) is designed to host containerized SSR frontends later if SEO requirements demand it.

---

**Version**: 2.1
**Date**: February 10, 2026
```
