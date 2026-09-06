# Design Issue Report: Stitch Design Gap Analysis

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Date:** February 10, 2026 **Reference Project:** "Hybrid Cloud Works Refresh" (Stitch ID:
`1280616977220666111`)

## 🚨 Critical Discrepancies (The "Bait and Switch")

The current deployment fails to meet the visual fidelity of the Stitch designs in three major areas:
**Theme Core, Layout Complexity, and Content Density.**

### 1. Theme Core Drift

- **Background Color:** Deployed site uses standard Shadcn dark mode (`#020817`). Stitch specifies a
  deep navy (`#0a0f1a`).
- **Glassmorphism:** The "beautiful spacing theme" provided by glassmorphic cards (blur,
  semi-transparent borders) is entirely absent in the actual page implementations.
- **Typography:** The deployed site uses standard sans-serif stacks. Stitch requires specific
  heading weights (700) and sizes (48-64px) with provider-specific font families (Genos, Amazon
  Ember, Aptos).

### 2. Layout & Organization Gaps

- **Template Scalability:** All pages currently rely on a single, simplistic `LandingPageTemplate`.
- **Missing Patterns:** Stitch defines **7 distinct layout patterns** (Provider Landing,
  Architecture Gallery, Blog Feed, Education Path, Tools Suite, Comparison Matrix, Form Page). None
  of these are correctly implemented as functional React components.
- **Organization:** The organization of content blocks (Hero, Features, Updates, Code Blocks) is
  generic and doesn't follow the "Pixel-Perfect" requirements in the Stitch mapping.

### 3. Content & Dynamic Data

- **Empty Scaffolds:** 47 of 48 pages are currently "scaffolds" or placeholders with minimal generic
  content.
- **Visual Assets:** Provider-specific graphics (wavy for AWS, diagonal for Azure) are missing from
  the hero sections.
- **Interactive Elements:** Features like filtering, sorting, and code syntax highlighting are not
  implemented.

## 📊 Gap Analysis Table

| Feature                | Stitch Requirement             | Deployed State          | Gap Severity |
| :--------------------- | :----------------------------- | :---------------------- | :----------- |
| **Primary Background** | `#0a0f1a` (Deep Navy)          | `#020817` (Shadcn Dark) | 🔴 High      |
| **Glassmorphism**      | `backdrop-filter: blur(10px)`  | None                    | 🔴 High      |
| **Hub Grid**           | Branded Icons + Custom Metrics | Standard Lucide Icons   | 🟡 Medium    |
| **Page Layouts**       | 7 Unique Patterns              | 1 Generic Template      | 🔴 High      |
| **Typography**         | Branded Fonts (Ember, Aptos)   | Standard Sans           | 🟡 Medium    |
| **Animations**         | 0.3s ease + Glow Hover         | None                    | 🟡 Medium    |

## 🛠️ Root Cause

The development phase focused on "Technical Deployment" and "Scaffolding" rather than "Visual
Fidelity Sync." The components were built as shells to pass CI/CD rather than as production-quality
UI matching the "Refresh" project.
