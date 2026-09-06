# Typography and Theme Standards

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 26, 2026 **Status:** Active - Professional Font and Color System

---

## 1. Typography Philosophy

The HCW typography system is:

- **Professional first**: Prioritizes readability and brand trust over futuristic styling.
- **Provider-specific**: Each cloud provider uses its official brand font where possible.
- **System-resilient**: Uses modern system fallbacks for reliability.
- **Accessible**: Legible sizes, consistent line-height, strong contrast.

---

## 2. Font Inventory

### Primary Fonts

| Font                  | Usage                       | Notes                                                  |
| :-------------------- | :-------------------------- | :----------------------------------------------------- |
| **Inter**             | Default, neutral, site-wide | Google's professional sans-serif, widely used in tech. |
| **Segoe UI Semibold** | Microsoft/Azure theme       | Replacement for Aptos. Use weight 600 for headings.    |
| **Amazon Ember**      | AWS theme                   | Official Amazon branding.                              |
| **Google Sans**       | GCP theme                   | Official Google branding.                              |
| **Mona Sans**         | GitHub theme                | Official GitHub branding.                              |

### Secondary Fonts

| Font                | Usage                 | Notes                                              |
| :------------------ | :-------------------- | :------------------------------------------------- |
| **System UI stack** | Default fallback      | `system-ui, -apple-system, 'Segoe UI', sans-serif` |
| **Cascadia Code**   | Code blocks, terminal | Primary monospace font.                            |
| **Roboto Mono**     | Monospace fallback    | Fallback if Cascadia unavailable.                  |

### Deprecated Fonts

- **Genos**: Removed (too futuristic).
- **Aptos**: Removed (replaced by Segoe UI Semibold).
- **Turret Road**: Removed (too futuristic).

---

## 3. Typography Hierarchy & Usage

### 3.1 Default/Neutral Sections

| Element             | Font  | Size    | Weight  | Usage                       |
| :------------------ | :---- | :------ | :------ | :-------------------------- |
| **Body/Paragraph**  | Inter | 16px    | 400     | Main content, descriptions. |
| **Small Text**      | Inter | 14px    | 400     | Captions, metadata.         |
| **H1 (Hero)**       | Inter | 48px    | 700     | Page titles, hero headings. |
| **H2 (Section)**    | Inter | 36px    | 700     | Section headers.            |
| **H3 (Subsection)** | Inter | 24px    | 600     | Subsection headers.         |
| **H4-H6**           | Inter | 18-20px | 500-600 | Content subsections.        |

### 3.2 Provider Themes

Each provider gets their **official brand font** applied to all text when inside a
`theme-{provider}` container.

| Theme                 | Primary Font      | Secondary/Fallback | Notes                                                          |
| :-------------------- | :---------------- | :----------------- | :------------------------------------------------------------- |
| **Azure / Microsoft** | Segoe UI Semibold | Inter              | Use weight 600 for headings. Feels "Microsoft native".         |
| **AWS**               | Amazon Ember      | Inter              | Feels "Amazon native". Fallback to Bookerly (serif) optional.  |
| **GCP**               | Google Sans       | Inter              | Feels "Google native". Geometric but professional.             |
| **GitHub**            | Mona Sans         | Inter              | Feels "GitHub native". Modern, techy.                          |
| **Terraform**         | Inter             | System UI          | Neutral tooling identity. Distinctive purple color scheme.     |
| **FinOps**            | Inter             | System UI          | Professional, data-first tone. Distinctive green color scheme. |

### 3.3 Code & Technical Content

| Context               | Font          | Size    | Notes                                 |
| :-------------------- | :------------ | :------ | :------------------------------------ |
| **Code Blocks**       | Cascadia Code | 13-14px | Primary monospace for developer docs. |
| **Terminal Examples** | Cascadia Code | 13px    | Consistent monospace output.          |
| **Inline Code**       | Roboto Mono   | 13px    | Fallback if Cascadia unavailable.     |

---

## 4. Color Palettes & Theming

### 4.1 Shared Colors (All Pages)

- **White:** `#FFFFFF`
- **Black:** `#000000`

### 4.2 Azure Palette (Official)

- **Azure Blue:** `#00A4EF` (PMS 2191 C)
- **Azure Gray:** `#737373` (PMS 7549 C)

### 4.3 AWS Palette (Official)

- **AWS Navy Blue:** `#252F3E` (PMS 7546 C)
- **AWS Orange:** `#FF9900` (PMS 1375 C)

### 4.4 Terraform Palette (Official)

- **Terraform Purple (Primary):** `#7B42BC` (PMS 266 C)
- **Alternate Terraform:** `#A067DA` (PMS 265 C)
- **Neutrals:** Cool Gray 4 (`#BFBFC0`) & Cool Gray 3 (`#DBDBDC`)

### 4.5 Google Palette (Official)

- **Primary Blue:** `#4285F4`
- **Accent Red:** `#DB4437`
- **Accent Yellow:** `#F4B400`
- **Accent Green:** `#0F9D58`
- **Grays:** Scale from `#F2F2F2` (Gray 100) to `#1A1A1A` (Gray 950).
- _Usage:_ Blue for primary actions; grays for layout; red/yellow/green for small accents.

### 4.6 GitHub Palette (Official)

- **Grays (Primary):** Gray 4 (`#909692`), Gray 5 (`#232925`), Gray 6 (`#101411`).
- **Greens (Accent):** Green 5 (`#08872B`), Green 6 (`#0A241B`).
- _Usage:_ Grays drive layout and typography. Greens for highlights.

### 4.7 FinOps Foundation Palette (Official)

- **Mountain Meadow (Primary):** `#1EA482`
- **Lilac Bush (Accent):** `#9778D1`
- **Caribbean Green (Alt):** `#00C693`
- _Usage:_ Mountain Meadow for primary actions; Lilac Bush for small accents.

---

## 5. Implementation Reference

### 5.1 CSS Font Stacks

```css
/* Default Body */
body {
  font-family:
    'Inter',
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}

/* Code Blocks */
.code-block {
  font-family: 'Cascadia Code', 'Roboto Mono', monospace;
}
```

### 5.2 Theme Classes

```css
.theme-azure {
  font-family: 'Segoe UI', 'Inter', sans-serif;
}
.theme-aws {
  font-family: 'Amazon Ember', 'Inter', sans-serif;
}
.theme-gcp {
  font-family: 'Google Sans', 'Inter', sans-serif;
}
.theme-github {
  font-family: 'Mona Sans', 'Inter', sans-serif;
}
.theme-terraform {
  font-family: 'Inter', system-ui, sans-serif; /* Distinction via color */
}
.theme-finops {
  font-family: 'Inter', system-ui, sans-serif; /* Distinction via color */
}
```

---

## 6. Performance & Optimization

- **Google Fonts:** Cached (~45KB total for Inter, Cascadia Code, Roboto Mono).
- **Custom Fonts:** Lazy load provider fonts (AWS, etc.) only in their specific sections to reduce
  initial bundle size.
- **Subsetting:** Use `font-display: swap` for all custom fonts.

---

## 7. Related Documents

- [frontend-uiux-reference.md](../archive/frontend-uiux-reference.md)
- [design-visual-validation.md](../archive/design-visual-validation.md)
- [frontend-component-library.md](../archive/frontend-component-library.md)
