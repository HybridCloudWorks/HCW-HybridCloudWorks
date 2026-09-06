# Frontend Theming Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


How light/dark mode works in this codebase, the rules every component must follow, and how the
failsafe contrast pipeline catches regressions before they ship.

## The contract (TL;DR)

1. **Never hardcode colors in inline `style`.** Inline `style={{ color: '#...' }}` cannot respond to
   the theme toggle. ESLint flags this.
2. **Pair every light-mode color with a `dark:` variant**, or use a token that adapts on its own
   (`text-foreground`, `bg-background`, `bg-card`, etc.).
3. **Maintain ≥4.5:1 contrast** for normal text in both themes. The CI gate enforces this — no
   exceptions for "it's just a small label."
4. **Only one theme toggle exists** — the floating button at bottom-right
   ([src/App.jsx](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/src/App.jsx)). Do not add others.

## How the theme is applied

Theme resolution happens in three layers, in this order:

1. **Pre-hydration script** in [index.html](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/index.html). Runs before React mounts, reads
   `localStorage['hcw-theme']` (or `prefers-color-scheme` if no saved preference), and sets
   `<html class="dark">` + `data-theme` + `color-scheme`. This is what prevents FOUC.
2. **`ThemeProvider`** in [src/context/ThemeContext.jsx](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/src/context/ThemeContext.jsx) takes over
   after hydration. It listens for OS-level preference changes and only overrides them if the user
   has explicitly toggled.
3. **CSS custom properties** in [src/index.css](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/src/index.css) under `:root` (light) and `.dark`
   (dark) define every semantic color. Tailwind utilities like `bg-background` / `text-foreground`
   resolve through these.

If you ever need to read the theme in JS, use `useTheme()` from `src/context/ThemeContext.jsx`. Do
not read the `<html>` class directly.

## Color tokens

| Token                                          | Light           | Dark              | Use for                                                |
| ---------------------------------------------- | --------------- | ----------------- | ------------------------------------------------------ |
| `--background` / `bg-background`               | white           | `#0f172a`         | page background                                        |
| `--foreground` / `text-foreground`             | `#111827`       | white             | primary text                                           |
| `--card` / `bg-card`                           | white           | `#0a0f1c`         | card surfaces                                          |
| `--muted` / `bg-muted`                         | `#f3f4f6`       | `#1c2233`         | subdued surfaces                                       |
| `--muted-foreground` / `text-muted-foreground` | mid-gray (~5:1) | mid-light (~10:1) | secondary text                                         |
| `--primary`                                    | dark text color | white             | primary actions (overridden per provider theme)        |
| `--accent`                                     | very light gray | mid-dark          | accent surfaces — **not for text bg without override** |

### When to use a token vs a Tailwind utility

- **Use the token** (`text-foreground`, `bg-card`, etc.) when the color should follow the theme.
  This is the default choice.
- **Use a Tailwind utility with `dark:` variant** when you need a specific brand color or shade
  that's distinct from the semantic system.
- **Never** mix: `bg-primary text-slate-900` will fail in dark mode where `--primary` is white.

## Common anti-patterns and their fixes

### Anti-pattern: missing dark variant

```jsx
// BAD — invisible in dark mode
<p className="text-slate-900">Hello</p>

// GOOD
<p className="text-slate-900 dark:text-white">Hello</p>

// BETTER (lets the token do the work)
<p className="text-foreground">Hello</p>
```

### Anti-pattern: inline color

```jsx
// BAD — ESLint will warn; cannot toggle with theme
<div style={{ color: '#1EA482', background: 'linear-gradient(...)' }} />

// GOOD — define the gradient as a CSS class with .dark override
<div className="bg-finops-hero" />
```

### Anti-pattern: color text on alpha-overlay background

```jsx
// BAD — bg-orange-500/20 is light pastel in light mode; text-orange-400 fails AA
<Badge className="bg-orange-500/20 text-orange-400">AWS</Badge>

// GOOD — flip text color per theme
<Badge className="bg-orange-500/20 text-orange-700 dark:text-orange-300">AWS</Badge>
```

### Anti-pattern: low-contrast muted text in dark mode

`text-muted-foreground` is now safe (~10:1 in dark mode) after the token update in
[src/index.css:173](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/src/index.css#L173). But `dark:text-slate-500` on `bg-background` is
**3.98:1** and will fail the gate. Use `dark:text-slate-400` or `text-muted-foreground` instead.

## The failsafe pipeline

Three layers of detection. Anything that passes all three is theme-safe.

### Layer 1 — ESLint (commit time)

[eslint.config.js](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/eslint.config.js) bans inline `style` color hex values and gradient template
literals. Currently `warn`; will flip to `error` after the existing inline-color cases are migrated.

### Layer 2 — axe-theme-scan (developer-run, full diagnostic)

```bash
npm run build
npm run preview &           # serves dist/ on :4173
npm run a11y:contrast       # crawls 72 routes × 2 themes; exits non-zero on color-contrast failures
npm run a11y:contrast:report  # human-readable summary of the JSON
```

Outputs:

- `documentation/reports/axe-theme-scan.json` — full violations payload
- `documentation/reports/axe-theme-scan.md` — per-route summary + detailed failure list with
  selectors and computed colors

### Layer 3 — Playwright contrast spec (CI gate)

[e2e/contrast.spec.js](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/e2e/contrast.spec.js) runs a smaller route set in both themes and **fails
the build on any `color-contrast` violation**. Run locally with:

```bash
npm run a11y:contrast:e2e
```

Playwright auto-starts the preview server (see [playwright.config.js](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/playwright.config.js)).

### Recommended pre-merge check

```bash
npm run code:quality                     # lint + format + route validation
npm run build && npm run a11y:contrast   # full diagnostic scan
npm run a11y:contrast:e2e                # CI gate (subset, fast)
```

## Adding a new page or component

1. Use semantic tokens by default (`text-foreground`, `bg-card`, etc.).
2. If you need a brand color, add the `dark:` variant in the same JSX line.
3. Run the dev server in **both themes** before opening a PR. Toggle via the floating button
   bottom-right.
4. Run `npm run a11y:contrast` locally if you touched colors.
5. The CI Playwright spec will block your PR if you introduce a violation.

## Recovering from a broken contrast gate

If CI fails on color-contrast:

1. Look at the Playwright failure output — it includes the selector, fg color, bg color, computed
   ratio, and required ratio.
2. Run `npm run a11y:contrast` locally to get the same failure offline.
3. Fix following the patterns in this doc.
4. Re-run `npm run a11y:contrast:e2e`. Green = ship.

## History

- **2026-05-09** — Discovered hardcoded `class="dark"` in `index.html` preventing light mode from
  rendering, plus a too-dark `--muted-foreground` token. Built the three-layer failsafe pipeline.
  Initial scan: 86 contrast violations. After Footer/Badge/ContactPage fixes: 14.
