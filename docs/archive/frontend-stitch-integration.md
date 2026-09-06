# Stitch Integration Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Overview

This guide details how to translate **Stitch Designs** into **HCW React Components**. We use a
rigorous mapping process to ensure pixel-perfect implementation of the 48 core screens.

---

## 1. The Design Source

**Stitch Project ID:** `1280616977220666111` **Tools:** Stitch MCP (`mcp_stitch`)

We do not guess designs. We pull them directly from Stitch.

### Accessing Designs via MCP

Use the following tools to retrieve design data:

- `stitch_list_screens`: Get list of available screens.
- `stitch_get_screen`: Get detailed metadata for a specific screen (key for layout).
- `stitch_generate_screen_from_text`: (Experimental) Generate code snippets.

---

## 2. The Mapping File

**Reference:** `documentation/frontend-stitch-mapping.md`

This file is the **Source of Truth** linking route keys to Stitch Screen IDs.

**Format:**

```javascript
"aws.landing": "551238783e684b1c8cf2ffbfbf2ac468",
"aws.architecture": "03d2840abff24a7b92043a1e07e44d12",
// ...
```

**Workflow:**

1. Identify the route you are building (e.g., `/aws/architecture`).
2. Look up the key (`aws.architecture`) in the mapping file.
3. Use the Screen ID to fetch design details or inspect the visual reference.

---

## 3. Styling Strategy (Theming)

We do **not** hardcode colors. We use the **Design Tokens** defined in `src/index.css`.

### core Variables (Tailwind)

| Usage                 | Variable       | Tailwind Class               |
| :-------------------- | :------------- | :--------------------------- |
| **Primary Brand**     | `--primary`    | `bg-primary`, `text-primary` |
| **Global Background** | `--background` | `bg-background`              |
| **Card Surface**      | `--card`       | `bg-card`                    |

### Provider-Specific Theming

Every page component is wrapped in a `theme-{provider}` class by the `App.jsx` or `ProviderLayout`.
This automatically re-maps the CSS variables.

**Example: AWS Context**

- `bg-primary` → AWS Orange `#FF9900`
- `font-sans` → `Amazon Ember`

**Example: Azure Context**

- `bg-primary` → Azure Blue `#0078D4`
- `font-sans` → `Aptos`

**Developer Rule:** Always use semantic Tailwind classes (`text-primary`, `border-accent`), NEVER
hardcode hex codes (e.g., `text-[#FF9900]`). This ensures the component works across all 6
providers.

---

## 4. Component Implementation Steps

1.  **Locate Scaffold**: Find the placeholder file (e.g., `src/pages/aws/LandingPage.jsx`).
2.  **Fetch Design**: Use the Stitch Screen ID to view the layout.
3.  **Identify Components**: Break the design into:
    - `Layout` (Header, Footer - already global)
    - `HeroSection`
    - `FeatureGrid`
    - `ContentCard`
4.  **Code with Shadcn/UI**: Use `src/components/ui` primitives.
5.  **Apply Theme**: Use standard Tailwind classes.
6.  **Verify**: Check the page at `http://localhost:5173/aws`.

---

## 5. Visual Asset Handling

- **Images**: Place in `src/assets/images/{provider}/`.
- **Icons**: Use `lucide-react` for UI icons. Use Provider Brand Icons (SVG) for logos.
- **Fonts**: Pre-configured in `src/index.css`. Do not import new fonts manually.

---

**Version:** 2.0 **Date:** February 10, 2026

---

## Consolidated from `frontend-stitch-mapping.md`

_Merged 2026-05-27 during documentation reorganization. Original archived at
`archive/docs/frontend-stitch-mapping.md`._

# Stitch Screen ID → Page Label Mapping (Final Verification)

All 48 screens HTML-verified + 45/48 visually validated via screenshots. Stitch Project:
`1280616977220666111`

---

## FinOps (6 screens)

| #   | Screen ID                          | Correct Label           | Visual ✅ |
| --- | ---------------------------------- | ----------------------- | --------- |
| 1   | `cb86f4cd595943bc9fceeb5a34cea62b` | **FinOps Tools**        | ✅        |
| 2   | `adfeebc70bcb40b2af5838c1b64bf2a4` | **FinOps FOCUS**        | ✅        |
| 3   | `43a0148219c84d15950cffb6d3befb09` | **FinOps Architecture** | ✅        |
| 4   | `9bc1f61fe96241aba86b8cee52a6cece` | **FinOps Landing**      | ✅        |
| 5   | `9e653e7a122643be8dba1f69a0cd1cfb` | **FinOps Blog**         | ✅        |
| 6   | `fb93fb9d2bf043d6a01a2d5128db844c` | **FinOps RSS**          | ✅        |

## Terraform (6 screens)

| #   | Screen ID                          | Correct Label         | Visual ✅ |
| --- | ---------------------------------- | --------------------- | --------- |
| 7   | `7a5e72be4a9e473fbc038439573c3cc5` | **Terraform Landing** | HTML      |
| 8   | `0bdf80757a294ff1b0539fede7a85b27` | **Terraform Code**    | HTML      |
| 9   | `d1a89aa74d1f41d5b6738d4a0e3ddf2a` | **Terraform Modules** | HTML      |
| 10  | `eb49ef4fb152441b9db2c7528c1cc74b` | **Terraform Tools**   | HTML      |
| 11  | `86ada6a9ae7d4ebabce2434965437daa` | **Terraform Blog**    | HTML      |
| 12  | `f9ce1099135b4788ad4e10d0a2276e3e` | **Terraform RSS**     | HTML      |

## GitHub (6 screens)

| #   | Screen ID                          | Correct Label        | Visual ✅ |
| --- | ---------------------------------- | -------------------- | --------- |
| 13  | `ad4b4ffd433d4df6b95269d385c8d370` | **GitHub Landing**   | HTML      |
| 14  | `87478c49a630460ba62f12fdb7134522` | **GitHub Workflows** | HTML      |
| 15  | `e908d1d665bf48f68dbb66029de96de5` | **GitHub Code**      | HTML      |
| 16  | `1aae2b648306404b90597f495cf8a544` | **GitHub Tools**     | HTML      |
| 17  | `6010d6efc3fa42d8a0831bf6688824ef` | **GitHub Blog**      | HTML      |
| 18  | `55da78137d3746dca916c1f2bcb91149` | **GitHub RSS**       | HTML      |

## AWS (5 screens)

| #   | Screen ID                          | Correct Label        | Visual ✅ |
| --- | ---------------------------------- | -------------------- | --------- |
| 19  | `551238783e684b1c8cf2ffbfbf2ac468` | **AWS Landing**      | ✅        |
| 20  | `03d2840abff24a7b92043a1e07e44d12` | **AWS Architecture** | ✅        |
| 21  | `6a58c42dc89247d78ff7da1c9035cbc8` | **AWS Frameworks**   | ✅        |
| 22  | `99c428acd5ce4650979f26e2a4a9b54b` | **AWS Blog**         | ✅        |
| 23  | `95aeb38728b94494832a05a0a6017979` | **AWS Education**    | ✅        |

## Azure (7 screens)

| #   | Screen ID                          | Correct Label          | Visual ✅ |
| --- | ---------------------------------- | ---------------------- | --------- |
| 24  | `6141a4492ce34c52b2dc1216375ece47` | **Azure Landing**      | ✅        |
| 25  | `9e0e1599472b4641a9fb39dd75bef7fd` | **Azure Architecture** | ✅        |
| 26  | `a2b002ec242a43a0873f456194639237` | **Azure Frameworks**   | ✅        |
| 27  | `cc1262b758754142a84f2c4c4c680d4c` | **Azure Blog**         | ✅        |
| 28  | `a2f2eb7ff64241299015bc324f76f11e` | **Azure Education**    | ✅        |
| 29  | `631f6c2fcc714b0eb820259731f0bf59` | **Cloud Tool WAR**     | ✅        |
| 30  | `9cc5db8c44cd4129b0aa256a7af7b65f` | **Azure Audio**        | ✅        |

## GCP (5 screens)

| #   | Screen ID                          | Correct Label        | Visual ✅ |
| --- | ---------------------------------- | -------------------- | --------- |
| 31  | `9f60a0ef434345548d491ef3e6de2b9a` | **GCP Landing**      | ✅        |
| 32  | `ade8e0695a454e46ba7f8c8d3ea2e3e2` | **GCP Architecture** | ✅        |
| 33  | `bc285add2ddd448fb2c84162c6a3766b` | **GCP Frameworks**   | ✅        |
| 34  | `b08368a0cd234450a90667531927d72a` | **GCP Blog**         | ✅        |
| 35  | `6df066d2ebc24fe9a42fa84d8626093b` | **GCP Education**    | ✅        |
| 36  | `912a8f9541704b0daebbe213a5b1c30a` | **GCP Audio**        | ✅        |

## Audio (3 screens — shared across providers)

| #   | Screen ID                          | Correct Label | Visual ✅ |
| --- | ---------------------------------- | ------------- | --------- |
| 37  | `51a5ac6b1bb044bdb799000ca518964a` | **AWS Audio** | ✅        |
| 28  | _(Azure Audio above)_              |               |           |
| 34  | _(GCP Audio above)_                |               |           |

## Cloud Tools (3 screens)

| #   | Screen ID                          | Correct Label             | Visual ✅   |
| --- | ---------------------------------- | ------------------------- | ----------- |
| 38  | `2c9e7a67364446ecb9988dbec0509245` | **Cloud Tool Migration**  | HTML + Code |
| 39  | `201a3994b77241f398aaa79b70e98649` | **Cloud Tool Comparison** | HTML        |
| 40  | `d38bb88adb294d62aa8ee217ec15a421` | **Cloud Tool Resources**  | HTML        |

## Templates (4 screens)

| #   | Screen ID                          | Correct Label                | Visual ✅ |
| --- | ---------------------------------- | ---------------------------- | --------- |
| 41  | `def5f38194b04844bb4e9aeae372d05c` | **Framework Template**       | ✅        |
| 42  | `f672e1dd7b854b518e4ba609ab41b6db` | **Architecture Template**    | ✅        |
| 43  | `e999af0786b34ea593b0f0e85ebcb762` | **Rosetta Stone Template**   | ✅        |
| 44  | `ea145bc0e5ec44d08e288658cafa56d3` | **Cloud Tool Decision Tree** | HTML      |

## Shared (4 screens)

| #   | Screen ID                          | Correct Label     | Visual ✅ |
| --- | ---------------------------------- | ----------------- | --------- |
| 45  | `e23496299d45431bb84ecd2a30c11a09` | **Main Landing**  | ✅        |
| 46  | `b7ce1cc29ebe4276bf5fbbf38a737ea3` | **About**         | ✅        |
| 47  | `1bd62409218d4884b53c0f45c454913c` | **Contact**       | ✅        |
| 48  | `4a7d6caa381e49ce8e3ccc578089555d` | **Blog Template** | HTML      |

---

## Summary

| Category    | Count  | Pages                                                                     |
| ----------- | ------ | ------------------------------------------------------------------------- |
| FinOps      | 6      | Landing, Blog, RSS, Tools, FOCUS, Architecture                            |
| Terraform   | 6      | Landing, Code, Modules, Tools, Blog, RSS                                  |
| GitHub      | 6      | Landing, Workflows, Code, Tools, Blog, RSS                                |
| AWS         | 5      | Landing, Architecture, Frameworks, Blog, Education                        |
| Azure       | 7      | Landing, Architecture, Frameworks, Cloud Tool WAR, Blog, Education, Audio |
| GCP         | 6      | Landing, Architecture, Frameworks, Blog, Education, Audio                 |
| Cloud Tools | 3      | Migration, Cloud Tool Comparison, Resources                               |
| Templates   | 4      | Framework, Architecture, Rosetta Stone, Cloud Tool Decision Tree          |
| Shared      | 4      | Main Landing, About, Contact, Blog Template                               |
| Audio (AWS) | 1      | AWS Audio                                                                 |
| **Total**   | **48** | **All unique — zero iterations**                                          |

## ⚠️ Blog Template — Not in Stitch

"Universal Technical Blog Template" (user-provided HTML code) does not match any of the 48 screens.

## Key Findings

1. **Zero design iterations** — all 48 screens are unique pages
2. **Azure & GCP Landings exist** — hidden under "AWS Cloud Works Landing Page" title
3. **"Architecture" vs "Frameworks"**: Architecture = Design Hubs/Blueprints; Frameworks =
   Architecture & Insights (WAF/CAF)
4. **All Stitch titles are misleading** — 20 screens titled "FinOps Tools Hub" contain 3 different
   providers
