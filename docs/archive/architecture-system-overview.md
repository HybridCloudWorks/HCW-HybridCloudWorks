# System Architecture Overview

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / Client                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      React Application                           │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │                   App.jsx (Root)                             │ │
│ │  ┌───────────────────────────────────────────────────────┐   │ │
│ │  │              React Router Setup                       │   │ │
│ │  │  - Header Component (Provider Context Aware)         │   │ │
│ │  │  - ProviderLayout (Context Provider)                 │   │ │
│ │  │  - Page Routes                                        │   │ │
│ │  │  - Footer Component                                   │   │ │
│ │  └───────────────────────────────────────────────────────┘   │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│              Provider Context System                             │
│  (src/context/ProviderContext.jsx)                              │
│                                                                  │
│  ProviderContext ──────────┐                                     │
│  useProvider()             ├─→ Provides: 'aws'|'azure'|'gcp'... │
│  useProviderConfig()       │                                     │
│  VALID_PROVIDERS[]         │                                     │
│                            └─→ Config: theme, color, blogPath   │
└──────────────┬───────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│              Page Component (Example: AWS/LandingPage)           │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  import { LandingPageTemplate } from '@/lib/pageTemplates' │ │
│ │  import { Cloud, Code, Shield, ... } from 'lucide-react'   │ │
│ │                                                              │ │
│ │  const features = [...]  // Array of feature objects        │ │
│ │  const ctaSection = {...} // CTA configuration              │ │
│ │                                                              │ │
│ │  return <LandingPageTemplate {...props} />                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│              Template Factory (pageTemplates.js)                 │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  Templates:                                                  │ │
│ │  • LandingPageTemplate(props) → Hero + Features + CTA       │ │
│ │  • ContentPageTemplate(props) → Title + Sections            │ │
│ │  • CardGridTemplate(props) → Grid of Cards                  │ │
│ │  • BlogTemplate(props) → Featured + Post Grid              │ │
│ │  • ResourceGridTemplate(props) → Resource Cards            │ │
│ │  • ComparisonTemplate(props) → Vertical Comparison         │ │
│ │  • TwoColumnTemplate(props) → Side-by-side Layout         │ │
│ │  • TimelineTemplate(props) → Timeline Events              │ │
│ │                                                              │ │
│ │  Reusable Components:                                        │ │
│ │  • HeroSection(props)                                        │ │
│ │  • FeaturesGrid(props)                                       │ │
│ │                                                              │ │
│ │  Animation Variants:                                         │ │
│ │  • containerVariants (staggered children)                    │ │
│ │  • itemVariants (fade-up)                                    │ │
│ │  • heroVariants (slide-down)                                 │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│              Styling System (index.css)                          │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  CSS Variables:                                              │ │
│ │  • --hcw-bg-primary: #0a0f1a (dark navy)                    │ │
│ │  • --hcw-bg-secondary: #1a1f2e                              │ │
│ │  • --hcw-bg-tertiary: #252d3d                               │ │
│ │  • --hcw-accent: #137fec (blue)                             │ │
│ │  • --hcw-text-primary: #ffffff                              │ │
│ │  • --hcw-text-secondary: #b0b8c8                            │ │
│ │  • --hcw-text-tertiary: #7a8399                             │ │
│ │  • --hcw-border-light: rgba(255,255,255,0.1)              │ │
│ │                                                              │ │
│ │  Theme Classes:                                              │ │
│ │  • .theme-aws (Orange #FF9900)                              │ │
│ │  • .theme-azure (Blue #0078D4)                              │ │
│ │  • .theme-gcp (Red #EA4335)                                 │ │
│ │  • .theme-github (Dark #1C2128)                             │ │
│ │  • .theme-terraform (Purple #7B42BC)                        │ │
│ │  • .theme-finops (Green #1EA482)                            │ │
│ │                                                              │ │
│ │  Glassmorphic Components:                                    │ │
│ │  • .glass-card                                               │ │
│ │  • .glass-button                                             │ │
│ │  • header/footer with blur                                   │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│              External Libraries                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  • Framer Motion (animations)                                │ │
│ │  • Lucide React (icons)                                      │ │
│ │  • React Router v6 (routing)                                 │ │
│ │  • Tailwind CSS (styling)                                    │ │
│ │  • Vite (build tool)                                         │ │
│ └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          User URL                                │
│                 /aws/architectures (example)                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   React Router Resolves                          │
│              Provider: 'aws' extracted from URL                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                ProviderLayout Component                          │
│     Validates provider in VALID_PROVIDERS array                │
│     Wraps with ProviderContext.Provider                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│           Route Page Component (ArchitectureDesignsPage)        │
│  • Imports CardGridTemplate from pageTemplates                  │
│  • Imports icons from lucide-react                              │
│  • Defines cards data array                                     │
│  • Renders: <CardGridTemplate {...props} />                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              CardGridTemplate Component                          │
│  • Receives: title, description, cards[], columns               │
│  • Sets up: containerVariants, itemVariants                     │
│  • Renders:                                                     │
│    - Hero title/description                                     │
│    - Grid of card items (motion.div with animations)            │
│    - Each card: icon, title, description, tags                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Browser Renders & Applies CSS                       │
│  • Dark gradient background from index.css                      │
│  • Provider theme class applied (e.g., .theme-aws)             │
│  • Tailwind classes from template                               │
│  • CSS variables override for provider colors                   │
│  • Framer Motion animates on mount                              │
└─────────────────────────────────────────────────────────────────┘
```

## Component Hierarchy

```
App (root)
├── Header (global)
│   └── Uses useProvider() for theme
├── Routes
│   ├── HomePage (static)
│   ├── ProviderLayout (context provider)
│   │   ├── /aws/*
│   │   │   ├── LandingPage
│   │   │   │   └── LandingPageTemplate
│   │   │   ├── ArchitectureDesignsPage
│   │   │   │   └── CardGridTemplate
│   │   │   ├── BlogPage
│   │   │   │   └── BlogTemplate
│   │   │   ├── EducationPage
│   │   │   │   └── ResourceGridTemplate
│   │   │   ├── FrameworksPage
│   │   │   │   └── CardGridTemplate
│   │   │   └── AudioArchitecturePage
│   │   │       └── ContentPageTemplate
│   │   ├── /azure/*
│   │   │   ├── LandingPage → LandingPageTemplate
│   │   │   ├── ArchitectureDesignsPage → CardGridTemplate
│   │   │   ├── BlogPage → BlogTemplate
│   │   │   ├── EducationPage → ResourceGridTemplate
│   │   │   ├── FrameworksPage → CardGridTemplate
│   │   │   ├── FrameworksPillarsPage → ContentPageTemplate
│   │   │   └── AudioArchitecturePage → ContentPageTemplate
│   │   ├── /gcp/* (similar structure)
│   │   ├── /github/* (similar structure)
│   │   ├── /terraform/* (similar structure)
│   │   └── /finops/* (similar structure)
│   ├── /tools/*
│   │   ├── MigrationPage
│   │   ├── ComparisonPage
│   │   ├── ResourcesPage
│   │   └── DecisionsPage
│   ├── /shared/*
│   │   ├── AboutPage
│   │   └── ContactPage
│   └── /templates/*
│       ├── FrameworkTemplatePage
│       ├── ArchitectureTemplatePage
│       └── RosettaStoneTemplatePage
└── Footer (global)
    └── Uses useProvider() for theme
```

## File Organization

```
src/
├── lib/
│   ├── pageTemplates.js ★ (649 lines - template factory)
│   ├── firebaseConfig.js
│   ├── firebase/
│   │   └── firestore.ts
│   ├── blogUtils.js
│   ├── errorHandler.js
│   ├── functionsBase.js
│   ├── i18n.js
│   └── utils.js
├── context/
│   └── ProviderContext.jsx ★ (provider context & config)
├── pages/
│   ├── aws/ (6 pages - ALL IMPLEMENTED)
│   ├── azure/ (7 pages - ALL IMPLEMENTED)
│   ├── gcp/ (1/6 pages implemented)
│   ├── github/ (1/6 pages implemented)
│   ├── terraform/ (1/6 pages implemented)
│   ├── finops/ (1/6 pages implemented)
│   ├── tools/ (0/4 pages implemented)
│   ├── shared/ (1/3 pages implemented)
│   └── templates/ (0/3 pages implemented)
├── components/
│   ├── Auth.jsx
│   ├── ProtectedRoute.jsx
│   ├── ScrollToTop.jsx
│   ├── shared/
│   │   ├── Header.jsx ★ (provider-aware theming)
│   │   └── Footer.jsx ★ (provider-aware theming)
│   └── ui/ (shadcn components)
├── assets/
├── App.jsx ★ (routes configured)
├── main.jsx
└── index.css ★ (design system + themes)
```

## Template to Page Mapping

```
Template                  → Used By Pages
═══════════════════════════════════════════════════════════════
LandingPageTemplate       → All provider landing pages (6 pages)
                           + Tools comparison intro

CardGridTemplate          → Architectures (6), Frameworks (5),
                           Tools (3), FinOps (3) = ~17 pages

BlogTemplate              → Blog pages (6 total)

ContentPageTemplate       → Audio pages (6), FocusPage, Tools pages,
                           Shared pages, Template pages = ~15 pages

ResourceGridTemplate      → Education pages (5), Tools = ~6 pages

ComparisonTemplate        → Comparison pages, RosettaStone = ~2 pages

TwoColumnTemplate         → AboutPage = 1 page

TimelineTemplate          → (Reserved for future use)
```

## Theme Application Flow

```
User visits /aws/blog
    │
    ├─→ URL contains 'aws'
    │
    ├─→ useParams() extracts 'aws'
    │
    ├─→ ProviderLayout validates against VALID_PROVIDERS
    │
    ├─→ ProviderContext.Provider value="aws"
    │
    ├─→ Page component renders (BlogPage)
    │
    ├─→ Header/Footer use useProvider() → "aws"
    │
    ├─→ useProviderConfig() → { theme: 'theme-aws', color: '#FF9900', ... }
    │
    ├─→ Body element gets class="theme-aws"
    │
    ├─→ CSS variables override:
    │   • --slate-blue: #FF9900
    │   • --accent-color: #FF9900
    │   • Custom fonts: Amazon Ember
    │
    └─→ All child components use semantic Tailwind
        → Colors adapt automatically via CSS variables
```

## Page Template Expansion

```
LandingPageTemplate Props Structure:
├── providerName: string
├── heroTitle: string
├── heroDescription: string
├── heroSubtitle?: string
├── features: Array<{
│   ├── icon: IconComponent
│   ├── title: string
│   ├── description: string
│   └── link?: string
├── primaryCTA: { label, href }
├── secondaryCTA?: { label, href }
└── ctaSection?: {
    ├── title: string
    ├── description: string
    └── cta: { label, href }

CardGridTemplate Props Structure:
├── title: string
├── description: string
├── cards: Array<{
│   ├── icon: IconComponent
│   ├── title: string
│   ├── description: string
│   └── tags: string[]
└── columns: 2|3

BlogTemplate Props Structure:
├── title: string
├── description: string
├── featuredPost: {
│   ├── title: string
│   ├── excerpt: string
│   ├── author: string
│   ├── date: string
│   └── readTime: number
└── posts: Array<{
    ├── title: string
    ├── excerpt: string
    ├── author: string
    ├── date: string
    ├── readTime: number
    └── tags: string[]
```

## Performance Optimizations

```
✅ Implemented:
├── CSS-based animations (GPU accelerated)
├── Tailwind purging (unused CSS removed)
├── Component lazy rendering
├── Semantic HTML (better browser optimization)
├── CSS variables (single source of truth for colors)
├── Dark theme (reduces power consumption on OLED)
└── Icon caching (lucide-react tree-shakeable)

🎯 Potential:
├── Code splitting (route-based)
├── Image optimization (when added)
├── Intersection observers (lazy animation trigger)
├── Service workers (PWA support)
└── CDN caching (static assets)
```

## Future Integration Points

```
Firebase/Firestore Integration:
├── Blog posts fetched from Firestore
├── Dynamic content management
├── Real-time updates
├── Comment sections
└── User-generated content

Search Implementation:
├── Full-text search in blog
├── Filter architectures by tags
├── Resource discovery
└── SEO optimization

Analytics:
├── Page view tracking
├── User behavior analytics
├── Conversion tracking
└── Performance monitoring
```

## Summary

- **15/47 pages implemented** (32% complete)
- **Template factory**: 649 lines, 9 templates
- **Design system**: Dark glassmorphism with 6 provider themes
- **Performance**: GPU-accelerated animations, semantic CSS
- **Extensibility**: Ready for Firestore, search, analytics
- **Maintenance**: Template-based ensures consistency
- **Development time**: ~4-8 hours for remaining 32 pages

This architecture provides a scalable, maintainable foundation for the HCW website with excellent
performance and user experience.

---

## Consolidated from `architecture-system-report.md`

_Merged 2026-05-27 during documentation reorganization. Original archived at
`archive/docs/architecture-system-report.md`._

# Hybrid Cloud Works Refresh - Architecture Analysis Report

**Prepared by:** Antigravity AI
**Date:** February 9, 2026
**Project:** Hybrid Cloud Works Refresh V2 (Stitch Project ID: 1280616977220666111)

---

## Executive Summary

This report provides the corrected architectural analysis of HCW V2 based on the authoritative
**4-tier structure**:

- **Tier 1**: HCW Landing Page (main home)
- **Tier 2**: 6 Provider Landing Pages (3 Cloud + 3 Secondary)
- **Tier 3**: Content Hub Pages (Unique per provider + Shared neutral pages)
- **Tier 4**: Dynamic Template-Generated Pages (Blog posts, Framework details, Architecture details)

**Total Page Structure**:

- **7 Fixed Pages** (Tier 1 + Tier 2)
  - 1 Main Landing
  - 6 Provider Landings
- **36 Content Hub Pages** (Tier 3)
  - 18 Cloud Provider unique pages
  - 12 Secondary Provider unique pages
  - 4 Cloud Tools submenu pages (shared across AWS/Azure/GCP)
  - 2 Shared neutral pages (About, Contact)
- **Unlimited Dynamic Pages** (Tier 4)
  - Blog posts (all 6 providers)
  - Framework details (3 cloud providers only)
  - Architecture details (3 cloud providers only)

---

## Architecture Overview

### 3-Tier Hierarchy

```
TIER 1: HCW Landing Page
   ↓
TIER 2: Six Provider Landing Pages
   ├─ Cloud Providers (3)
   │  ├─ AWS      → [Architecture|Blog|RSS|Framework|Education|Tools] + [About|Contact]
   │  ├─ Azure    → [Architecture|Blog|RSS|Framework|Education|Tools] + [About|Contact]
   │  └─ GCP      → [Architecture|Blog|RSS|Framework|Education|Tools] + [About|Contact]
   └─ Secondary Providers (3)
      ├─ Terraform → [Blog|RSS|Code|Modules|Tools] + [About|Contact]
      ├─ GitHub    → [Blog|RSS|Code|Workflows|Tools] + [About|Contact]
      └─ FinOps    → [Blog|RSS|FOCUS|Architecture|Tools] + [About|Contact]
```

### Key Architectural Principles

1. **Equal Treatment**: All 3 cloud providers get identical navigation structure and content depth
   (6 unique pages each)
2. **Unique vs Shared**:
   - **Cloud providers**: 6 unique pages (Architecture, Blog, RSS, Framework, Education, Tools)
   - **Secondary providers**: 4 unique pages each (Blog, RSS, 2 specialized pages, Tools)
   - **Shared neutral pages**: 2 pages only (About, Contact)
3. **Single Source of Truth**: Shared pages (About, Contact) exist once, not duplicated per provider
4. **Consistent Headers**: Each provider landing shows full navigation with unique pages + neutral
   shared pages
5. **Specialized Content**: Secondary providers have domain-specific pages:
   - **Terraform**: Code (Terraform Code) + Modules (Terraform Modules)
   - **GitHub**: Code (GitHub Code) + Workflows (GitHub Workflows)
   - **FinOps**: FOCUS (FinOps FOCUS) + Architecture (FinOps Architecture)

---

## SME Perspectives

### FED (Frontend & DevOps Engineer)

**Component Architecture:**

```
app/
├── page.tsx                           # Tier 1: Main Landing
├── (providers)/
│   ├── aws/page.tsx                   # Tier 2: AWS Landing
│   ├── aws/architecture/page.tsx      # Tier 3: Unique
│   ├── aws/blog/page.tsx              # Tier 3: Unique
│   ├── aws/rss/page.tsx               # Tier 3: Unique
│   ├── aws/framework/page.tsx         # Tier 3: Unique
│   ├── aws/education/page.tsx         # Tier 3: Unique
│   ├── [azure, gcp]/...               # Same structure
│   ├── terraform/page.tsx             # Tier 2
│   ├── terraform/blog/page.tsx        # Tier 3: Unique
│   ├── terraform/rss/page.tsx         # Tier 3: Unique
│   └── [github, finops]/...           # Same structure
└── tools/page.tsx                     # Tier 3: Shared (NOT per provider)
    about/page.tsx                     # Tier 3: Shared
    contact/page.tsx                   # Tier 3: Shared
```

**Benefits:**

- Shared components reduce bundle size 3x
- Provider-specific pages use dynamic imports
- Faster navigation to About/Contact (already loaded)

### GDEF (Google Developer Expert in Firebase)

**Firestore Schema:**

```javascript
firestore/
├── providers/{providerId}                    // Tier 2 metadata
├── unique_content/{providerId}/{contentType} // Tier 3 unique
│   ├── architecture/  (cloud only)
│   ├── blog/          (all providers)
│   ├── rss/           (all providers)
│   ├── framework/     (cloud only)
│   └── education/     (cloud only)
└── shared_content/{contentType}              // Tier 3 shared (single source)
    ├── tools/
    ├── about/
    └── contact/
```

**Security Rules:**

```javascript
// Validate content type based on provider type
allow create: if (
  (providerId in ['aws', 'azure', 'gcp'] &&
   contentType in ['architecture', 'blog', 'rss', 'framework', 'education'])
  ||
  (providerId in ['terraform', 'github', 'finops'] &&
   contentType in ['blog', 'rss'])
);
```

### GPCA (Google Professional Cloud Architect)

**URL Strategy:**

```
/                    # Tier 1: Main landing
/aws                 # Tier 2: AWS hub
/aws/architecture    # Tier 3: AWS unique
/tools               # Tier 3: Shared (canonical, NOT /aws/tools)
/about               # Tier 3: Shared (canonical)
```

**SEO Benefits:**

- No duplicate content for shared pages
- All authority flows to canonical shared URLs
- Provider-specific pages rank independently

### CGOA (GitOps) & GHE (GitHub Expert)

**Deployment Strategy:**

```yaml
# Shared pages: High-impact, require approval
shared/** → manual approval → affects all providers

# Unique pages: Independent deployment
providers/aws/** → auto-deploy → affects AWS only
providers/azure/** → auto-deploy → affects Azure only
```

**CODEOWNERS:**

```
/shared/                    @architects
/providers/aws/             @aws-team
/providers/azure/           @azure-team
/providers/gcp/             @gcp-team
/providers/terraform/       @iac-team
/providers/github/          @devops-team
/providers/finops/          @finops-team
```

---

## Page Inventory

### Tier 2: Provider Landing Pages (6)

| Provider  | Type      | Screen ID                          | Header Navigation                                                                  | Design Status |
| --------- | --------- | ---------------------------------- | ---------------------------------------------------------------------------------- | ------------- |
| AWS       | Cloud     | `551238783e684b1c8cf2ffbfbf2ac468` | Architecture \| Blog \| RSS \| Framework \| Education \| Tools \| About \| Contact | ✅ Designed   |
| Azure     | Cloud     | NEEDS DESIGN (adapt AWS w/ theme)  | Architecture \| Blog \| RSS \| Framework \| Education \| Tools \| About \| Contact | ⚠️ Pending    |
| GCP       | Cloud     | NEEDS DESIGN (adapt AWS w/ theme)  | Architecture \| Blog \| RSS \| Framework \| Education \| Tools \| About \| Contact | ⚠️ Pending    |
| Terraform | Secondary | `7a5e72be4a9e473fbc038439573c3cc5` | Blog \| RSS \| Code \| Modules \| Tools \| About \| Contact                        | ✅ Designed   |
| GitHub    | Secondary | `ad4b4ffd433d4df6b95269d385c8d370` | Blog \| RSS \| Code \| Workflows \| Tools \| About \| Contact                      | ✅ Designed   |
| FinOps    | Secondary | NEEDS DESIGN                       | Blog \| RSS \| FOCUS \| Architecture \| Tools \| About \| Contact                  | ⚠️ Pending    |

> **Verification Note (Feb 9, 2026):** Screen `6141a4492ce34c52b2dc1216375ece47` was previously
> listed as Azure Landing but is actually titled "AWS Cloud Works Landing Page" in Stitch. Azure and
> GCP Landing Pages will be created by adapting the AWS design with provider-specific theming
> (Option B).

---

### Tier 3A: Cloud Provider Unique Pages (18 total: 6 × 3)

**AWS:**

- Architecture: `03d2840abff24a7b92043a1e07e44d12` → `/aws/architecture`
- Blog: `99c428acd5ce4650979f26e2a4a9b54b` → `/aws/blog`
- RSS: TBD → `/aws/rss`
- Framework: `51a5ac6b1bb044bdb799000ca518964a` → `/aws/framework`
- Education: `95aeb38728b94494832a05a0a6017979` → `/aws/education`
- Tools: `1aae2b648306404b90597f495cf8a544` → `/aws/tools`

**Azure:**

- Architecture: `9e0e1599472b4641a9fb39dd75bef7fd` → `/azure/architecture`
- Blog: `cc1262b758754142a84f2c4c4c680d4c` → `/azure/blog`
- RSS: TBD → `/azure/rss`
- Framework: `9cc5db8c44cd4129b0aa256a7af7b65f` → `/azure/framework`
- Education: `a2f2eb7ff64241299015bc324f76f11e` → `/azure/education`
- Tools: TBD → `/azure/tools`

**GCP:**

- Architecture: `ade8e0695a454e46ba7f8c8d3ea2e3e2` → `/gcp/architecture`
- Blog: `b08368a0cd234450a90667531927d72a` → `/gcp/blog`
- RSS: TBD → `/gcp/rss`
- Framework: `bc285add2ddd448fb2c84162c6a3766b` → `/gcp/framework`
- Education: `6df066d2ebc24fe9a42fa84d8626093b` → `/gcp/education`
- Tools: TBD → `/gcp/tools`

---

### Tier 3B: Secondary Provider Unique Pages (12 total: 4 × 3)

**Terraform:**

- Blog: `86ada6a9ae7d4ebabce2434965437daa` → `/terraform/blog`
- RSS: `f9ce1099135b4788ad4e10d0a2276e3e` → `/terraform/rss`
- Code (Terraform Code): `0bdf80757a294ff1b0539fede7a85b27` → `/terraform/code`
- Modules (Terraform Modules): `d1a89aa74d1f41d5b6738d4a0e3ddf2a` → `/terraform/modules`
- Tools: `eb49ef4fb152441b9db2c7528c1cc74b` → `/terraform/tools`

**GitHub:**

- Blog: `6010d6efc3fa42d8a0831bf6688824ef` → `/github/blog`
- RSS: `55da78137d3746dca916c1f2bcb91149` → `/github/rss`
- Code (GitHub Code): `e908d1d665bf48f68dbb66029de96de5` → `/github/code`
- Workflows (GitHub Workflows): `87478c49a630460ba62f12fdb7134522` → `/github/workflows`
- Tools: TBD → `/github/tools`

**FinOps:**

- Blog: TBD → `/finops/blog`
- RSS: TBD → `/finops/rss`
- FOCUS (FinOps FOCUS): TBD → `/finops/focus`
- Architecture (FinOps Architecture): TBD → `/finops/architecture`
- Frameworks (FinOps Frameworks): TBD → `/finops/frameworks`
- Tools: `43a0148219c84d15950cffb6d3befb09` → `/finops/tools`

---

### Tier 3C: Shared Neutral Pages (2 total - single source of truth)

| Page    | Screen ID                          | Canonical URL | Content                        |
| ------- | ---------------------------------- | ------------- | ------------------------------ |
| About   | `b7ce1cc29ebe4276bf5fbbf38a737ea3` | `/about`      | About Saul Patino, HCW mission |
| Contact | `1bd62409218d4884b53c0f45c454913c` | `/contact`    | Contact form                   |

**Important**: These are NOT duplicated (no `/aws/about`, `/azure/contact`, etc.) - single pages
accessible from all provider headers.

---

### Tier 3D: Cloud Tools Submenu (4 pages - shared across AWS/Azure/GCP)

**Accessible from**: AWS, Azure, and GCP Tools pages only

The "Tools" header link on cloud provider pages opens to a Tools Hub with 4 submenu options:

| Tool Page                      | Screen ID                          | URL Pattern             | Description                             |
| ------------------------------ | ---------------------------------- | ----------------------- | --------------------------------------- |
| Cloud Tool Migration           | `2c9e7a67364446ecb9988dbec0509245` | `/aws/tools/migration`  | Migration assessment and planning tools |
| Cloud Tool Comparison          | `201a3994b77241f398aaa79b70e98649` | `/aws/tools/comparison` | Cross-cloud service comparison          |
| Cloud Tool Decision Logic      | `ea145bc0e5ec44d08e288658cafa56d3` | `/aws/tools/decision`   | Decision tree for cloud selection       |
| Cloud Tool Resource Comparison | `d38bb88adb294d62aa8ee217ec15a421` | `/aws/tools/resource`   | Resource pricing and features           |

**Note**: Same 4 tools appear under `/azure/tools/*` and `/gcp/tools/*` - content adapts based on
provider context.

---

## Tier 4: Dynamic Template-Generated Content Pages

### Overview

Tier 4 pages are **automatically generated from templates** when new content is created. These
pages:

- Use provider-specific theming (colors match parent landing page)
- Are created on-demand without code deployment
- Scale to unlimited content (hundreds/thousands of pages)

### 4A: Blog Posts (All 6 Providers)

**Template**: Blog Template (universal - applies to all providers)

**URL Pattern**: `/{provider}/blog/{slug}`

| Provider  | Example URL                          | Theme Color          |
| --------- | ------------------------------------ | -------------------- |
| AWS       | `/aws/blog/lambda-best-practices`    | AWS Orange (#FF9900) |
| Azure     | `/azure/blog/aks-deployment-guide`   | Azure Blue (#0078D4) |
| GCP       | `/gcp/blog/cloud-run-optimization`   | GCP Blue/Yellow      |
| Terraform | `/terraform/blog/module-composition` | Terraform Purple     |
| GitHub    | `/github/blog/actions-ci-cd`         | GitHub Black         |
| FinOps    | `/finops/blog/cost-allocation-tags`  | FinOps Green         |

**Content Management**:

- Blog landing page (Tier 3) shows list of all blog posts for that provider
- Clicking a post navigates to Tier 4 page: `/{provider}/blog/{slug}`
- Each blog post inherits theme from its parent provider
- **New blog posts are generated automatically** when content is added to Firestore

### 4B: Framework Details (Cloud Providers Only)

**Template**: Framework Template (cloud providers only)

**URL Pattern**: `/{cloud-provider}/framework/{slug}`

| Provider | Example URL                                         | Content Focus                          |
| -------- | --------------------------------------------------- | -------------------------------------- |
| AWS      | `/aws/framework/well-architected-security`          | AWS Well-Architected Framework pillars |
| Azure    | `/azure/framework/cloud-adoption-framework`         | Azure CAF methodologies                |
| GCP      | `/gcp/framework/architecture-framework-reliability` | GCP Architecture Framework principles  |

**Content Management**:

- Framework landing page (Tier 3) shows all framework topics
- Clicking a framework navigates to Tier 4 detail page
- **New framework pages auto-generated** when content is added

### 4C: Architecture Details (Cloud Providers Only)

**Template**: Architecture Template (cloud providers only)

**URL Pattern**: `/{cloud-provider}/architecture/{slug}`

| Provider | Example URL                                    | Content Focus               |
| -------- | ---------------------------------------------- | --------------------------- |
| AWS      | `/aws/architecture/multi-region-active-active` | AWS architecture patterns   |
| Azure    | `/azure/architecture/hub-spoke-network`        | Azure network topologies    |
| GCP      | `/gcp/architecture/global-load-balancing`      | GCP infrastructure patterns |

**Content Management**:

- Architecture landing page (Tier 3) shows all architecture patterns
- Clicking a pattern navigates to Tier 4 detail page
- **New architecture pages auto-generated** when content is added

---

## Dynamic Content Generation Mechanism

**See full technical architecture in**: `HCW_V2_Dynamic_Content_architecture.md`

### High-Level Workflow

```
1. Content Creator adds new blog post to Firestore
   └─ Document: /unique_content/aws/blog/lambda-best-practices

2. Cloud Function automatically triggered
   └─ Fetches AWS provider theme (orange color scheme)
   └─ Fetches Blog Template

3. Next.js ISR (Incremental Static Regeneration) generates page
   └─ Creates: /aws/blog/lambda-best-practices
   └─ Applies AWS theme to Blog Template

4. Firebase Hosting CDN distributes globally
   └─ Page is live within 60 seconds

5. No code deployment required!
```

### Template Theming

Each template receives provider-specific theme data:

```typescript
interface ProviderTheme {
  primaryColor: string;    // e.g., "#FF9900" for AWS
  accentColor: string;
  fontFamily: string;
  // ... other theme properties
}

// Blog Template applies theme
<article style={{
  '--primary-color': theme.primaryColor,
  borderBottom: '2px solid var(--primary-color)'
}}>
```

### Content Status & Publishing

All Tier 4 content supports draft/published workflow:

- **Draft**: Content exists in Firestore but page not generated
- **Published**: Cloud Function triggers, page generated automatically
- **Scheduled**: Content publishes at future date/time

---

## Complete Page Hierarchy Visualization

```
TIER 1: HCW Landing
   ↓
TIER 2: Provider Landings (6)
   ├─ AWS
   ├─ Azure
   ├─ GCP
   ├─ Terraform
   ├─ GitHub
   └─ FinOps
   ↓
TIER 3: Content Hubs (36 pages)
   ├─ Cloud Provider Pages (AWS/Azure/GCP)
   │  ├─ Architecture (mini-hub) → Tier 4 detail pages
   │  ├─ Blog (mini-hub) → Tier 4 blog posts
   │  ├─ RSS
   │  ├─ Framework (mini-hub) → Tier 4 framework details
   │  ├─ Education
   │  └─ Tools
   │     ├─ Migration
   │     ├─ Comparison
   │     ├─ Decision Logic
   │     └─ Resource Comparison
   ├─ Secondary Provider Pages (TF/GH/FinOps)
   │  ├─ Blog (mini-hub) → Tier 4 blog posts
   │  ├─ RSS
   │  ├─ Specialized Pages (Code, Modules, Workflows, FOCUS, Architecture)
   │  └─ Tools
   └─ Shared Neutral (2)
      ├─ About
      └─ Contact
   ↓
TIER 4: Dynamic Content (Unlimited)
   ├─ Blog Posts (all providers)
   │  └─ /{provider}/blog/{slug}
   ├─ Framework Details (cloud only)
   │  └─ /{cloud}/framework/{slug}
   └─ Architecture Details (cloud only)
      └─ /{cloud}/architecture/{slug}
```

---

## Naming Convention

### Pattern: `{tier}_{section}_{provider}_{page}.jsx`

**Examples:**

- `tier1_landing_main.jsx` - Main HCW landing
- `tier2_landing_aws.jsx` - AWS provider landing
- `tier2_landing_terraform.jsx` - Terraform provider landing
- `tier3_architecture_aws.jsx` - AWS architecture (unique)
- `tier3_blog_azure.jsx` - Azure blog (unique)
- `tier3_tools_shared.jsx` - Tools (shared)
- `tier3_about_shared.jsx` - About (shared)

**Component Names:**

- `Tier1LandingMain`
- `Tier2LandingAws`
- `Tier3ArchitectureAws`
- `Tier3BlogAzure`
- `Tier3ToolsShared`
- `Tier3AboutShared`

---

## Navigation Flow

### Navigation Behavior

**From Provider Pages to Tools:**

- User on `/aws/blog` → clicks "Tools" → navigates to `/aws/tools` (AWS-specific tools)
- User on `/azure/framework` → clicks "Tools" → navigates to `/azure/tools` (Azure-specific tools)
- User on `/terraform/blog` → clicks "Tools" → navigates to `/terraform/tools` (Terraform-specific
  tools)

**From Provider Pages to Neutral Shared Pages:**

- User on `/aws/architecture` → clicks "About" → navigates to `/about` (shared, NOT `/aws/about`)
- User on `/gcp/blog` → clicks "Contact" → navigates to `/contact` (shared, NOT `/gcp/contact`)

**From Shared Pages to Provider Pages:**

- User on `/about` → clicks "AWS" in navigation → navigates to `/aws` (provider landing)
- User on `/contact` → clicks "GitHub" in navigation → navigates to `/github` (provider landing)

**Breadcrumb Examples:**

- `/aws/architecture` → Home > AWS > Architecture
- `/terraform/modules` → Home > Terraform > Modules
- `/finops/focus` → Home > FinOps > FOCUS
- `/aws/tools` → Home > AWS > Tools (provider-specific)
- `/about` → Home > About (neutral, no provider)
- `/contact` → Home > Contact (neutral, no provider)

---

## Recommendations

### Short-Term (0-3 months)

1. Implement provider context for dynamic header rendering
2. Create shared component library (Tools, About, Contact)
3. Set up Firebase collections matching schema above
4. Implement breadcrumb navigation

### Medium-Term (3-6 months)

1. Add search across all provider content
2. Implement user preferences (favorite provider)
3. Create comparison matrix tool
4. Add RSS aggregation backend

### Long-Term (6-12 months)

1. Personalized content recommendations
2. AI-powered decision assistant
3. Community features (comments, ratings)
4. Multi-language support

---

## Stitch Verification Summary (Feb 9, 2026)

**48 Stitch screens** verified against this architecture:

| Category                     | Count           | Notes                                                                                     |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| Mapped to architecture       | 15 unique pages | Correctly matched                                                                         |
| Design iterations (variants) | 33 screens      | 20 FinOps, 8 Framework, 6 Azure Arch, 4 AWS Landing                                       |
| Pages needing Stitch designs | 13              | RSS (×3), Azure/GCP Tools (×2), FinOps suite (×5), Azure/GCP Landing (×2), HCW V2 Landing |
| Critical mismatches fixed    | 1               | Azure Landing screen ID was actually AWS                                                  |

---

**Report Version**: 3.0 (Updated with Stitch verification, corrected screen IDs, Cloud Backend
Layer 2)
**Verification Date**: February 9, 2026
**SME Consultation**: FED, GDEF, GPCA, CGOA, GHE, AAI from personas.md
