# Frontend - Pages Implementation Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 15, 2026 **Status:** ✅ Current — Firestore-driven architecture with
static fallback **Supersedes**: Old `pageTemplates.js` factory approach (now legacy)

---

## Provider Page Matrix

| Page                                   | AWS | Azure | GCP | FinOps | Terraform | GitHub | VMware | Ansible |
| -------------------------------------- | :-: | :---: | :-: | :----: | :-------: | :----: | :----: | :-----: |
| News (`/rss`)                          | ✅  |  ✅   | ✅  |   ✅   |    ✅     |   ✅   |   ✅   |   ✅    |
| Blog (`/blog`)                         | ✅  |  ✅   | ✅  |   ✅   |    ✅     |   ✅   |   ✅   |   ✅    |
| Architecture (`/architecture-designs`) | ✅  |  ✅   | ✅  |   ✅   |     —     |   —    |   ✅   |    —    |
| Frameworks (`/frameworks`)             | ✅  |  ✅   | ✅  |   ✅   |     —     |   —    |   ✅   |    —    |
| Code (`/code`)                         |  —  |   —   |  —  |   —    |    ✅     |   ✅   |   —    |   ✅    |
| Coder Corner (`/coder-corner`)         | ✅  |  ✅   | ✅  |   ✅   |    ✅     |   ✅   |   ✅   |   ✅    |
| Education (`/education`)               | ✅  |  ✅   | ✅  |   ✅   |    ✅     |   ✅   |   ✅   |   ✅    |
| Landing Page                           | ✅  |  ✅   | ✅  |   ✅   |    ✅     |   ✅   |   ✅   |   ✅    |
| Detail Pages                           | ✅  |  ✅   | ✅  |   ✅   |     —     |   —    |   ✅   |    —    |

**Rules enforced in code (dispatchers in `src/App.jsx`):**

- Architecture: AWS, Azure, GCP, FinOps, VMware
- Frameworks: AWS, Azure, GCP, FinOps, VMware
- Code: Terraform, GitHub, Ansible
- Coder Corner: all 8 providers (`/:provider/coder-corner` list + `/:slug` detail via
  `BlogDetailTemplate` with `section="coder-corner"`)
- News + Blog + Education + Landing: all 8 providers
- Education detail (`/education/:certSlug`): dedicated pages for AWS and Azure; all other
  providers redirect to their education hub
- All 6 original landing pages are live on the shared Hyoga template
  (`src/components/shared/ProviderLandingTemplate.jsx`); VMware and Ansible launched on the same
  template

---

## Architecture: Firestore-Driven Pages with Static Fallback

### The Core Pattern

All listing pages (Architecture, Framework, Blog) use the same pattern:

```jsx
// 1. Fetch from Firestore
const { data: dynamicItems } = useFirestoreQuery('blogs', [
  where('type', '==', 'framework'),
  where('contentStatus', '==', 'published'),
]);

// 2. Filter to this provider client-side
const providerItems = dynamicItems.filter(
  (doc) => (doc.cloudProvider || '').toLowerCase() === 'aws'
);

// 3. Merge: dynamic first, static as permanent fallback
const items = [...providerItems, ...staticFallbackItems];
```

**Why merge order matters:** Dynamic Firestore items render first (newest content); static items are
permanent baseline content that always displays even when Firestore is empty.

### Slug Navigation Guard

Static fallback items have `slug: null`. Only Firestore items have real slugs. The guard prevents
stale static items from attempting slug navigation:

```jsx
onClick={() => item.slug && navigate(`/aws/frameworks/${item.slug}`)}
className={`cursor-pointer ${!item.slug ? 'opacity-60 cursor-default' : ''}`}
```

---

## Routing: Dispatcher Pattern

`App.jsx` uses dispatcher components (not direct `<Route>` declarations) for provider-dynamic pages.
Each dispatcher reads `location.pathname` and routes to the correct component:

```jsx
function ProviderFrameworksDispatcher() {
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean).pop();
  const isDetail = segment !== 'frameworks'; // slug present = detail page

  if (isDetail) return <FrameworkDetailTemplate />;

  if (pathname.includes('/aws'))
    return (
      <Suspense>
        <AWSFrameworksPage />
      </Suspense>
    );
  if (pathname.includes('/azure'))
    return (
      <Suspense>
        <AzureFrameworksPage />
      </Suspense>
    );
  if (pathname.includes('/gcp'))
    return (
      <Suspense>
        <GCPFrameworksPage />
      </Suspense>
    );
  return <NotFoundPage />;
}
```

### Route Declarations (relevant excerpt from App.jsx)

```jsx
// Architecture routes
<Route path="/:provider/architecture-designs" element={<ProviderArchitectureDispatcher />} />
<Route path="/:provider/architecture-designs/:slug" element={<ProviderArchitectureDispatcher />} />

// Framework routes
<Route path="/:provider/frameworks" element={<ProviderFrameworksDispatcher />} />
<Route path="/:provider/frameworks/:slug" element={<ProviderFrameworksDispatcher />} />

// Template submission forms (public)
<Route path="/templates/framework" element={<Suspense><FrameworkTemplatePage /></Suspense>} />
<Route path="/templates/architecture" element={<Suspense><ArchitectureTemplatePage /></Suspense>} />
```

---

## Content Types in the `blogs` Collection

The `blogs` Firestore collection is the single source of truth, differentiated by `type`:

| `type` value     | Listing Page                                     | Detail Template              | Review Board              |
| ---------------- | ------------------------------------------------ | ---------------------------- | ------------------------- |
| `'blog'`         | `BlogPage` (all providers)                       | Standard blog viewer         | `BlogReviewBoard`         |
| `'architecture'` | `ArchitectureDesignsPage` (AWS/Azure/GCP/FinOps) | `ArchitectureDetailTemplate` | `ArchitectureReviewBoard` |
| `'framework'`    | `FrameworksPage` (AWS/Azure/GCP)                 | `FrameworkDetailTemplate`    | `FrameworkReviewBoard`    |

---

## Component Map

### Template Pages (Public Submission Forms)

| File                                               | Route                     | Purpose                                                                                     |
| -------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `src/pages/templates/FrameworkTemplatePage.jsx`    | `/templates/framework`    | Gallery of 3 reference cards (AWS/Azure/GCP) + form; submits `type: 'framework'` to `blogs` |
| `src/pages/templates/ArchitectureTemplatePage.jsx` | `/templates/architecture` | Gallery of 6 blueprint cards + form; submits `type: 'architecture'` to `blogs`              |

### Detail Templates

| File                                                      | Used By                          | Key Logic                                                                               |
| --------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/templates/FrameworkDetailTemplate.jsx`    | `ProviderFrameworksDispatcher`   | Queries `blogs` where `slug == :slug` AND `type == 'framework'` with `limit(1)`; 4 tabs |
| `src/components/templates/ArchitectureDetailTemplate.jsx` | `ProviderArchitectureDispatcher` | Tries legacy path → `blogs` collection → static fallback chain; 4 tabs                  |

### Admin Review Boards

| File                                               | Invoked By                                  | Purpose                                                                                     |
| -------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/components/admin/FrameworkReviewBoard.jsx`    | `ReviewPage` when `type === 'framework'`    | Editor: left panel (preview) + right panel (4 tabs: Overview HTML, Pillars, IaC, Resources) |
| `src/components/admin/ArchitectureReviewBoard.jsx` | `ReviewPage` when `type === 'architecture'` | Editor: left panel (preview) + right panel (4 tabs: Overview HTML, Technical, IaC, FinOps)  |

### Provider Listing Pages

| Provider | Architecture Page                              | Frameworks Page                                                |
| -------- | ---------------------------------------------- | -------------------------------------------------------------- |
| AWS      | `src/pages/aws/ArchitectureDesignsPage.jsx`    | `src/pages/aws/FrameworksPage.jsx` ✅ Firestore                |
| Azure    | `src/pages/azure/ArchitectureDesignsPage.jsx`  | `src/pages/azure/FrameworksPage.jsx` ✅ Firestore              |
| GCP      | `src/pages/gcp/ArchitectureDesignsPage.jsx`    | `src/pages/gcp/FrameworksPage.jsx` ✅ Firestore (full rewrite) |
| FinOps   | `src/pages/finops/ArchitectureDesignsPage.jsx` | — (none)                                                       |

---

## Firestore Schemas

### Framework Entry (`type: 'framework'`)

```js
{
  type: 'framework',
  contentStatus: 'ingested' | 'published',
  slug: 'aws-well-architected-framework',
  title: 'AWS Well-Architected Framework',
  summary: 'Short description...',
  cloudProvider: 'AWS' | 'Azure' | 'GCP',
  category: 'Security' | 'Reliability' | 'Performance' | 'Cost' | 'Operations' | 'Sustainability',
  complexity: 'Beginner' | 'Intermediate' | 'Advanced',
  tags: ['string'],
  docLink: 'https://...',
  overviewHtml: '<p>...</p>',
  commandExample: 'aws cloudformation deploy ...',
  keyPillars: ['Operational Excellence', 'Security', ...],
  patterns: ['string'],
  terraformCode: '# HCL code here',
  featured: false,
  source: 'template-form' | 'admin' | 'pipeline',
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

### Architecture Entry (`type: 'architecture'`)

```js
{
  type: 'architecture',
  contentStatus: 'ingested' | 'published',
  slug: 'aws-multi-region-dr',
  title: 'Multi-Region Disaster Recovery',
  summary: 'Short description...',
  cloudProvider: 'AWS' | 'Azure' | 'GCP' | 'FinOps',
  category: 'string',
  complexity: 'Beginner' | 'Intermediate' | 'Advanced',
  tags: ['string'],
  diagramUrl: 'https://...',
  overviewHtml: '<p>...</p>',
  technicalSpecs: {
    components: ['ELB', 'EC2 Auto Scaling', 'RDS Multi-AZ'],
    patterns: [],
  },
  costAnalysis: {
    estimatedMonthly: 450,
    breakdown: [],
  },
  terraformCode: '# HCL code here',
  featured: false,
  source: 'template-form' | 'admin' | 'pipeline',
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

---

## Hooks Reference

### `useFirestoreQuery(collection, constraints)`

```jsx
import { useFirestoreQuery } from '@/hooks/useFirestoreQuery';
import { where, orderBy, limit } from 'firebase/firestore';

const { data, loading, error } = useFirestoreQuery('blogs', [
  where('type', '==', 'framework'),
  where('contentStatus', '==', 'published'),
  orderBy('createdAt', 'desc'),
]);
```

### `useBlogData(provider)`

Convenience hook used by all Blog listing pages. Internally filters `blogs` collection by
`type === 'blog'` and provider:

```jsx
import { useBlogData } from '@/hooks/useBlogData';
const { posts, loading } = useBlogData('aws');
```

---

## Color / Theme System

Each provider has a CSS theme class applied at the layout level. Templates use semantic Tailwind
classes that adapt automatically.

| Provider  | Theme Class        | Primary Color |
| --------- | ------------------ | ------------- |
| AWS       | `.theme-aws`       | `#FF9900`     |
| Azure     | `.theme-azure`     | `#0078D4`     |
| GCP       | `.theme-gcp`       | `#EA4335`     |
| GitHub    | `.theme-github`    | `#1C2128`     |
| Terraform | `.theme-terraform` | `#4040B2`     |
| FinOps    | `.theme-finops`    | `#1EA482`     |

---

## Design System Quick Reference

```css
/* Glass Card */
p-8 rounded-xl border border-white/10 bg-white/[0.02] backdrop-blur-sm

/* Hover State */
hover:bg-white/[0.05] hover:border-white/20 transition-all duration-300

/* Gradient Text */
bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 bg-clip-text text-transparent

/* Animation variants (from framer-motion) */
containerVariants  — staggered children
itemVariants       — individual item fade-up
heroVariants       — hero section slide-down
```

---

## Legacy: pageTemplates.js Factory

`src/lib/pageTemplates.js` still exists and exports `LandingPageTemplate`, `CardGridTemplate`,
`BlogTemplate`, `ContentPageTemplate`, etc. These are **no longer used** for Firestore-connected
pages. LandingPages and static content pages may still reference them.

**Do not** use `pageTemplates.js` factory for new pages that pull from Firestore. Use the
Firestore-driven pattern described above.

---

## File Naming Convention

```
src/pages/{provider}/{PageName}.jsx        # Listing pages
src/pages/templates/{Name}Page.jsx         # Public submission forms
src/components/templates/{Name}Template.jsx # Detail page templates
src/components/admin/{Name}ReviewBoard.jsx  # Admin editor boards
src/hooks/use{Name}.js                     # Firestore hooks
```

---

## Next Steps (Remaining Work)

1. **Real Data Phase 1**: Replace static fallback cards with real Firestore-seeded content for all
   Architecture and Framework pages (see `todo.md`)
2. **FinOps Architecture**: Seed real FinOps architecture blueprints via template form or admin
3. **RSS Feeds**: Build ingestion engine to auto-populate queue
4. **Email Digest**: Scheduled Cloud Function for review queue summary
