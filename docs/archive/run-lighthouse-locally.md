# Run Lighthouse Audit Locally

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Quick Start (2 minutes)

### Step 1: Install Tools

```bash
npm install -g @lhci/cli@latest lighthouse
```

### Step 2: Build the App

```bash
npm run build
```

### Step 3: Start Preview Server

```bash
npm run preview
# Server runs at http://localhost:5173
```

### Step 4: Run Lighthouse Audit (in another terminal)

**Option A: Using LHCI (Multi-page with our config)**

```bash
lhci autorun --config=.lighthouserc.json
```

**Option B: Single page audit (Chrome DevTools)**

1. Open Chrome
2. Go to `http://localhost:5173/aws/frameworks`
3. Press `F12` (DevTools)
4. Click **Lighthouse** tab
5. Configure: Desktop, All categories selected
6. Click **Analyze page load**
7. Wait 60-90 seconds

**Option C: CLI single page**

```bash
lighthouse http://localhost:5173/aws/frameworks --output=json --output=html
```

## Expected Results

**Target Scores (All Pages):**

- Accessibility: **≥95/100** ✅
- Performance: **≥85/100** ✅
- Best Practices: **≥90/100** ✅
- SEO: **≥90/100** ✅

## Our `.lighthouserc.json` Tests These 5 Pages:

1. ✅ http://localhost:5173/aws/frameworks
2. ✅ http://localhost:5173/aws/blog
3. ✅ http://localhost:5173/aws/architecture-designs
4. ✅ http://localhost:5173/aws/audio-architecture
5. ✅ http://localhost:5173/aws/education

Each page is tested **3 times** for statistical reliability.

## What to Look For

### Accessibility (≥95)

- ✅ All buttons keyboard accessible (Tab, Space, Enter)
- ✅ Focus rings visible on all interactive elements
- ✅ Proper heading hierarchy
- ✅ Images have alt text
- ✅ Color contrast adequate (4.5:1 minimum)

### Performance (≥85)

- ✅ Images lazy-loaded
- ✅ Code splitting working
- ✅ No render-blocking resources
- ✅ Fast First Contentful Paint (FCP)

### Best Practices (≥90)

- ✅ HTTPS only
- ✅ No deprecated APIs
- ✅ Proper CSP headers (if applicable)
- ✅ No console errors

### SEO (≥90)

- ✅ Proper meta descriptions
- ✅ Mobile viewport configured
- ✅ Structured data (schema.org)
- ✅ Readable font sizes

## Troubleshooting

**Port 5173 already in use?**

```bash
npm run preview -- --port 5174
# Then use http://localhost:5174 in Lighthouse
```

**LHCI can't find config?**

```bash
# Make sure you're in the project root
cd c:\Users\saulp\AppData\Workspace\Personal-Site_HCW
lhci autorun --config=.lighthouserc.json
```

**Chrome DevTools Lighthouse tab missing?**

- Make sure you're using Chrome (not Edge, Firefox, Safari)
- Press F12 to open DevTools
- Look for "Lighthouse" in the tabs (may be under `>>` menu)

## Next: GitHub Actions Automation

Once you verify locally:

1. Lighthouse audit runs automatically on every PR
2. Results posted to PR comments
3. Builds blocked if accessibility score < 95%
4. Full workflow runs on merge to main

See `.github/workflows/lighthouse-audit.yml` for the automated setup.

---

**Keyboard Validation Script (Alternative)**

Before running Lighthouse audits, you can quickly validate keyboard accessibility:

```bash
node scripts/validate-keyboard-nav.js
```

This runs 17 automated tests and confirms:

- ✅ All pages have AccessibleButton imports
- ✅ 30 AccessibleButton components found
- ✅ Focus ring styles correct
- ✅ Zero hardcoded buttons

Both should be green before deployment!
