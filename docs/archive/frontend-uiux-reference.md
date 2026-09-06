# FRONTEND-UIUX-REFERENCE

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 12, 2026 **Status:** Active

This document defines the UI/UX structure and styling decisions for the HCW frontend. It is
organized by cloud provider and shared pages, with an emphasis on consistency, readability, and
visual rhythm.

---

## Shared UI/UX Principles

- **Hero first:** Bold headline, short support copy, and 1-2 CTAs.
- **Small-print CTAs:** Uppercase, tracked micro-copy for secondary actions.
- **Visual rhythm:** Alternate dense sections with breathable panels and divider lines.
- **Motion with intent:** Use staggered reveals and subtle hover lifts for navigation cards.
- **Accessibility:** Maintain readable contrast and visible focus state.

---

## Common Pages

### Home Page

- **Hero badge:** Small-print label above the headline.
- **Primary CTA:** High contrast button; secondary CTA uses glass style.
- **Metrics strip:** Three small cards for quick credibility.
- **Value pillars:** Three-card section (Build, Learn, Share).
- **Inspiration gallery:** 4-card blueprint snapshot grid.

### About Page

- **Hero badge:** Small-print label to set tone.
- **Typography:** Display font on name headline; clean sans for body.
- **CTA micro-link:** Small-print uppercase for archive link.
- **Structure:** Story sections separated by glass panels.

### Contact Page

- **Hero badge:** Small-print label above the headline.
- **Typography:** Display font for the hero headline.
- **Layout:** Two-column split with contact channels and form.

---

## Provider Pages (6 Cloud Providers)

### AWS

- **Hero:** Bold gradient headline + dual CTAs.
- **Cards:** Glass layout with orange glow accents.
- **Focus:** Architecture patterns, cost metrics, reference blueprints.

### Azure

- **Hero:** Enterprise-grade positioning + clear CTA pair.
- **Cards:** Azure blue accent with glass sections.
- **Focus:** Landing zones, governance, microservices patterns.

### GCP

- **Hero:** Clean, modern copy with Google blue accents.
- **Cards:** Subtle gradients with emphasis on data and AI workloads.
- **Focus:** Platform patterns and analytics architecture.

### GitHub

- **Hero:** Developer-first positioning, automation focus.
- **Cards:** Dark neutral + crisp borders to support tooling content.
- **Focus:** CI/CD, workflows, release automation.

### Terraform

- **Hero:** Infrastructure-as-code narrative with strong CTA.
- **Cards:** Violet accent; emphasize modules and reusable stacks.
- **Focus:** Modular infrastructure patterns and governance.

### FinOps

- **Hero:** Cost optimization and forecasting narrative.
- **Cards:** Green accent with financial metric emphasis.
- **Focus:** Savings signals, forecasting, and optimization workflows.

---

## UI/UX Updates Applied (Feb 12, 2026)

- Home: added hero badge, metrics strip, value pillars, and blueprint gallery.
- About: added hero badge, display font for headline, micro-CTA style.
- Contact: added hero badge and display font, improved hero clarity.

---

## News Page (All Providers) — Added Feb 16, 2026

**Route:** `/:provider/rss` (replaces previous static RSS pages) **Component:**
`src/pages/shared/NewsPage.jsx`

### Layout: 50/25/25 Bento Grid

```
Desktop (lg+):
┌──────────────────────────────────────────────────────┐
│ Hero: Provider-branded title + 4 stat cards           │
├────────────────────┬──────────┬───────────────────────┤
│  50% Articles      │ 25% RSS  │ 25% AI Insights      │
│  (Bento Glass)     │ Timeline │ + Weekly Digest       │
└────────────────────┴──────────┴───────────────────────┘
Mobile: Stacked vertically (Articles → RSS → Insights)
```

### Design Tokens

- **Glass cards:** `backdrop-blur-md`, `bg-slate-800/40` (dark), `bg-white/5` (light)
- **Borders:** `border-slate-700/50` (dark), `border-slate-200/20` (light)
- **Hover glow:** `hover:shadow-[0_0_25px_rgba(primary,0.15)]`
- **Category badges:** Color-coded by type (AI/ML=purple, Security=rose, GA=green, Preview=amber)
- **Timeline dots:** Provider-colored left border with animated first dot
- **Insight cards:** Type-specific gradients (digest=primary, trend=amber, tip=emerald)

### Typography Hierarchy

| Element        | Class                                             | Dark             | Light       |
| -------------- | ------------------------------------------------- | ---------------- | ----------- |
| Page title     | `text-5xl font-bold`                              | White + gradient | Same        |
| Section header | `text-sm font-bold uppercase tracking-wide`       | White            | slate-900   |
| Article title  | `text-sm font-bold` (grid) / `text-xl` (featured) | White            | slate-900   |
| Summary text   | `text-xs` / `text-sm`                             | slate-400        | slate-600   |
| Meta text      | `text-[10px]`                                     | slate-500        | slate-500   |
| Badge text     | `text-[10px] font-bold uppercase`                 | Color-coded      | Color-coded |

### Animation Pattern

- Hero: Immediate render
- Stats: `ScrollTrigger slideUp 0.5s`
- Articles column: `ScrollTrigger slideUp 0.6s`
- RSS column: `ScrollTrigger slideUp 0.6s delay=0.1s`
- Insights column: `ScrollTrigger slideUp 0.6s delay=0.2s`
- Individual cards: `ScrollTrigger slideUp 0.4s` with staggered delay

### Responsive Breakpoints

| Breakpoint        | Layout                        |
| ----------------- | ----------------------------- |
| `< lg` (< 1024px) | Single column stack           |
| `lg` (1024px+)    | `grid-cols-[1fr_320px_320px]` |
| `xl` (1280px+)    | `grid-cols-[1fr_350px_350px]` |
| Stats row         | `grid-cols-2 md:grid-cols-4`  |

### Provider Theme Integration

Each provider's theme is automatically applied via CSS custom properties:

- `text-primary` / `bg-primary` — Provider accent color
- `border-primary/30` — Subtle accent borders
- Hero gradient uses provider-specific `from-*` and `to-*` colors
- Glow effects use provider hex color at 30% opacity

---

## Notes

- For new pages, reuse the hero badge pattern and small-print CTA styling.
- Keep the visual rhythm consistent: hero -> value blocks -> gallery -> detailed content.
