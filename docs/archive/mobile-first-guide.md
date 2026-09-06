# Mobile-First UI Alignment Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Status:** Implementation Ready
**Persona Lead:** FED (Frontend & DevOps) + GDEF (Design Expert)
**Effort:** 6 hours
**Impact:** Full responsive redesign for mobile/tablet

---

## CURRENT STATE: DESKTOP-CENTRIC PROBLEMS

### Issue 1: Bento Grid Collapse on Mobile

**GitHub LandingPage Example:**

```jsx
<div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-12 gap-4 auto-rows-[160px]">
  // ❌ PROBLEM: auto-rows-[160px] on single column (mobile) // Result: Cards stack vertically with
  excessive height
  <div className="md:col-span-4 lg:col-span-8 row-span-2" />
  <div className="md:col-span-2 lg:col-span-4 row-span-3" />
  <div className="md:col-span-2 lg:col-span-4 row-span-2" />
</div>
```

**Renders as:**

```
Mobile (320px):
┌─────────────────┐
│ Card 1          │  160px height ❌
│ (oversized)     │
├─────────────────┤
│ Card 2          │  160px height ❌
│ (oversized)     │
└─────────────────┘

Desktop (1200px):
┌─────────────────────────────────────────┐
│ Card 1 (8 cols, span-2)    │ Card 2 3   │
│                            │ rows       │
├────────────┬────────────┐  │            │
│ Card 3     │ Card 4     │  │            │
└────────────┴────────────┘  └────────────┘
```

### Issue 2: Touch Targets Too Small

```jsx
<button className="px-4 py-2">      // ~40px height ❌
  {/* vs recommended 44px × 44px */}
</button>

<button className="px-8 py-3">      // ~48px height ✅
</button>
```

### Issue 3: Navigation Header Hard-Coded to AWS

```jsx
// Header.jsx
const navLinks = [
  { label: 'Blogs', path: '/aws/blog' }, // ❌ Always goes to AWS
];
// On `/github` page, this link navigates AWAY from GitHub
```

### Issue 4: Dense Typography on Mobile

```jsx
<h1 className="text-4xl md:text-7xl">
  {' '}
  // 28px on mobile → 56px on desktop // 28px may be too large for 320px screens // Line-height
  issues in narrow viewports
</h1>
```

---

## SOLUTION STRATEGY

### Principle 1: Mobile-First Breakpoints

```jsx
// ✅ CORRECT: Define mobile defaults, enhance for larger screens
<div className="grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
  {/* Mobile: 1 col | Tablet: 2 cols | Desktop: 4 cols */}
</div>

// ❌ WRONG: Define desktop, degrade for mobile
<div className="grid-cols-12 md:grid-cols-4 sm:grid-cols-1">
  {/* Confusing, hard to maintain */}
</div>

// Tailwind Breakpoints:
// sm: 640px   | md: 768px | lg: 1024px | xl: 1280px | 2xl: 1536px
```

### Principle 2: Adaptive Grid Heights

```jsx
// ❌ PROBLEM: Fixed height breaks on all viewports
<div className="auto-rows-[160px]" />

// ✅ SOLUTION: Adaptive heights
<div className="auto-rows-min sm:auto-rows-[120px] md:auto-rows-[160px]" />
// Mobile: content-based height, Tablet: 120px, Desktop: 160px
```

### Principle 3: Touch-First Components

```jsx
// ❌ PROBLEM: Button too small on mobile
<button className="px-4 py-2 text-sm" />

// ✅ SOLUTION: Adequate touch targets
<button className="px-4 py-3 text-base" />
{/*
  Min height: 44px (44px ÷ 1.25 = 35.2px base, but py-3 = 0.75rem*16 gap,
              text + padding usually 44px+)
*/}
```

### Principle 4: Responsive Typography

```jsx
// ✅ SOLUTION: Scale headings responsibly
<h1 className="text-2xl sm:text-3xl md:text-5xl lg:text-7xl" />;
{
  /*
  320px: 1.5rem (24px) ✅
  640px: 1.875rem (30px) ✅
  768px: 3rem (48px) ✅
  1024px: 3.5rem (56px) ✅
  1280px: 4.5rem (72px) ✅
*/
}
```

---

## IMPLEMENTATION ROADMAP

### Step 1: Audit Current Grid Systems

**Files to Check:**

- `src/pages/github/LandingPage.jsx` - Bento grid, many row-spans
- `src/pages/finops/LandingPage.jsx` - Card grid layout
- `src/pages/finops/BlogPage.jsx` - Blog card grid
- All AWS/Azure/GCP pages - Monitor for similar issues

**What to Look For:**

- Fixed `auto-rows-[XXXpx]` without breakpoints
- Excessive `row-span-X` on single-column layouts
- `gap-` values that don't scale

---

### Step 2: Fix GitHub LandingPage Bento Grid

**Current Code:**

```jsx
<div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-12 gap-4 auto-rows-[160px]">
  <div className="bento-card md:col-span-4 lg:col-span-8 row-span-2">{/* Featured content */}</div>
  <div className="bento-card md:col-span-2 lg:col-span-4 row-span-3">{/* Sidebar */}</div>
</div>
```

**Fixed Code:**

```jsx
<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-12 gap-3 sm:gap-4 auto-rows-min sm:auto-rows-[120px] md:auto-rows-[160px]">
  {/*
    Mobile: single column, content height
    Tablet: 2 cols, 120px rows
    Desktop: 12 col, 160px rows, row-spans work
  */}

  <div className="bento-card sm:col-span-1 md:col-span-4 lg:col-span-8 sm:row-span-1 md:row-span-2">
    {/* Featured content - no row-span on mobile */}
  </div>

  <div className="bento-card sm:col-span-1 md:col-span-2 lg:col-span-4 sm:row-span-1 md:row-span-3">
    {/* Sidebar - no row-span on mobile */}
  </div>
</div>
```

**Key Changes:**

- Add `sm:grid-cols-2` (Tablet gets 2-column layout)
- Change `auto-rows-[160px]` → `auto-rows-min sm:auto-rows-[120px] md:auto-rows-[160px]`
- Remove `row-span` from mobile/tablet, add at `md:` breakpoint
- Add `sm:col-span-1` and `sm:row-span-1` for tablet layout

---

### Step 3: Touch Target Audit & Fix

**Files to Update:**

1. **src/components/shared/Header.jsx** (150 lines)

   ```jsx
   // Find all buttons/links
   // Ensure min 44px height
   ```

2. **src/pages/github/LandingPage.jsx**

   ```jsx
   // Current: <button className="px-8 py-3" />
   // OK, but add mobile check
   // Change to: "w-full sm:w-auto px-4 sm:px-8 py-3"
   // (Full width on mobile for larger tap area)
   ```

3. **src/pages/finops/LandingPage.jsx**
   ```jsx
   // Check card click areas
   // Ensure padding around interactive content
   ```

**Recommended Sizes:**

```jsx
// Small button (secondary): not for mobile
<button className="px-3 py-2 text-xs hidden sm:inline" />

// Standard button: full width on mobile
<button className="w-full sm:w-auto px-6 py-3 text-sm sm:text-base" />

// Large button (CTA): prominent on mobile
<button className="w-full px-6 py-4 text-base font-bold" />

// Icon buttons: 44x44 minimum
<button className="w-11 h-11 flex items-center justify-center" />
```

---

### Step 4: Header Navigation Mobile Menu

**Current Issue:**

```jsx
// Header shows all links at all sizes
const navLinks = [
  { label: 'Blogs', path: '/aws/blog' },
  { label: 'Audio', path: '/aws/audio' },
  { label: 'Frameworks', path: '/aws/frameworks' },
  // More links...
];
```

**Fix: Responsive Menu**

```jsx
export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { provider } = useProvider();

  // Desktop nav - always visible on large screens
  const desktopNav = (
    <nav className="hidden lg:flex items-center gap-1">{/* Desktop navigation */}</nav>
  );

  // Mobile menu - hamburger menu on small screens
  const mobileMenu = (
    <button
      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      className="lg:hidden p-2 text-slate-400 hover:text-white"
      aria-label="Toggle navigation menu"
    >
      <span className="material-symbols-outlined">menu</span>
    </button>
  );

  // Drawer menu (appears on mobile)
  const mobileMenuDrawer = mobileMenuOpen && (
    <div className="fixed inset-0 top-16 z-40 bg-background-dark/95 backdrop-blur-md lg:hidden">
      <nav className="p-4 space-y-2">
        {/* Mobile navigation links */}
        {hubLinks.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="block px-4 py-3 rounded text-white hover:bg-slate-800"
            onClick={() => setMobileMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );

  return (
    <header>
      {/* Logo and desktop nav */}
      {desktopNav}
      {/* Mobile menu button */}
      {mobileMenu}
      {/* Mobile menu drawer */}
      {mobileMenuDrawer}
    </header>
  );
}
```

---

### Step 5: Typography Responsive Scaling

**Current Issues:**

- Headings too large on narrow screens
- Line-height insufficient on mobile
- Letter-spacing too tight

**Fixes Applied Across All Pages:**

```jsx
// ❌ BEFORE
<h1 className="text-4xl md:text-6xl font-black" />

// ✅ AFTER (Progressive Enhancement)
<h1 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-black leading-tight" />

// Meta tags
<div className="text-xs sm:text-sm md:text-base text-slate-400" />

// Body content
<p className="text-base sm:text-lg leading-relaxed" />
```

---

### Step 6: Gap & Spacing Adjustments

**Principle:**

- Mobile: Tighter spacing (saves real estate)
- Tablet: Medium spacing
- Desktop: Generous spacing

```jsx
// ❌ FIXED GAPS
<div className="gap-8" /* 32px everywhere */ />

// ✅ RESPONSIVE GAPS
<div className="gap-4 sm:gap-6 md:gap-8" /* 16px→24px→32px */ />

// Grid padding
<section className="px-4 sm:px-6 md:px-8 py-6 sm:py-8 md:py-12" />
```

---

## FILE-BY-FILE IMPLEMENTATION PLAN

### Priority 1: GitHub Pages (6 files, 2 hrs)

```
src/pages/github/
├── LandingPage.jsx       (192 lines)  - Fix bento grid
├── CodePage.jsx          - Responsive code blocks
├── BlogPage.jsx          - Card grid spacing
├── WorkflowsPage.jsx     - Workflow cards
├── ToolsPage.jsx         - Tool cards
└── RssPage.jsx           - RSS feed list
```

**Changes per file:**

- Replace `auto-rows-[160px]` with breakpoint variants
- Add `sm:`, `md:` breakpoints to all grid/flex layouts
- Audit button sizes (44px minimum)
- Fix typography scaling

### Priority 2: FinOps Pages (6 files, 2 hrs)

```
src/pages/finops/
├── LandingPage.jsx              - Glass cards grid
├── ArchitectureDesignsPage.jsx  - Card grid
├── BlogPage.jsx                 - Blog cards
├── ToolsPage.jsx                - Tools grid
├── FocusPage.jsx                - Focus cards
└── RssPage.jsx                  - RSS list
```

### Priority 3: Header & Navigation (1 file, 1 hr)

```
src/components/shared/
└── Header.jsx  - Add mobile menu, dynamic routing
```

### Priority 4: Other Pages (AWS, Azure, GCP, Terraform) (1 hr light audit)

- Most already use LandingPageTemplate (good)
- Verify spacing is responsive
- Spot-check button sizes

---

## TESTING CHECKLIST

### Device Breakpoints to Test:

```
Mobile (320px):        iPhone SE, pixel 4
Tablet (768px):        iPad mini
Desktop (1024px):      iPad Pro, laptop
Monitor (1440px+):     Large monitor, 2x display
```

### Tools:

- Chrome DevTools: Device emulation
- Responsively App: Multi-device simultaneous view
- Real device testing: iOS (Safari), Android (Chrome)

### Automated Testing:

```bash
# Lighthouse audit (performance, accessibility, etc.)
npm run lighthouse

# Visual regression testing
npm run test:visual

# Responsive layout test
npm run test:responsive
```

---

## SUCCESS CRITERIA

✅ All pages display correctly at 320px, 768px, 1024px, 1440px
✅ Touch targets ≥ 44px × 44px
✅ Typography scales smoothly (no jarring jumps)
✅ Tap navigation works smoothly on mobile browsers
✅ Lighthouse Mobile score ≥ 85
✅ No horizontal scroll at any breakpoint
✅ Images lazy-load and scale responsively

---

## ESTIMATED HOURS BREAKDOWN

| Phase     | Task                         | Hours       |
| --------- | ---------------------------- | ----------- |
| 1         | Audit current grids          | 1           |
| 2         | Fix GitHub pages (6 files)   | 2           |
| 3         | Fix FinOps pages (6 files)   | 2           |
| 4         | Header mobile menu + routing | 1           |
| 5         | Testing across devices       | 1           |
| **Total** |                              | **7 hours** |

**To fit in 6-hour budget:**

- Focus on GitHub + FinOps grids (Priority 1+2)
- Defer detailed testing to Phase 4

---

## QUICK REFERENCE: BREAKPOINT USAGE

```jsx
// ✅ CORRECT PATTERN
<div className="text-base sm:text-lg md:text-xl">    {/* Text size */}
<div className="gap-4 sm:gap-6 md:gap-8">           {/* Spacing */}
<div className="grid-cols-1 sm:grid-cols-2 md:grid-cols-4">  {/* Grid */}
<div className="px-4 sm:px-6 md:px-8">              {/* Padding */}

// ❌ WRONG PATTERN
<div className="gap-8">                              {/* Fixed gap */}
<div className="hidden md:flex">  {/* vs "flex hidden md:block" */}
<div className="auto-rows-[160px]">   {/* Fixed height */}
```

---

_Implementation led by FED (Frontend & DevOps Engineer) + GDEF (UI Design Expert)_ _Referenced in
agents.md for design decision authority._
