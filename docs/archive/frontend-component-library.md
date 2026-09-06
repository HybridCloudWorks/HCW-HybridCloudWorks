# Component Library - Phase 7d Modern UI/UX

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 12, 2026
**Status:** Production Ready ✅
**Coverage:** Animation, Accessibility, Performance Components

This document provides API reference and usage patterns for the new component libraries introduced
in Phase 7d.

---

## Table of Contents

1. [Animation Components](#animation-components)
2. [Accessibility Components](#accessibility-components)
3. [Performance Components](#performance-components)
4. [Integration Examples](#integration-examples)
5. [Best Practices](#best-practices)

---

## Animation Components

All animation components are located in `src/components/animations/` and use **Framer Motion** with
custom scroll detection via `useIntersectionObserver` hook.

### ScrollTrigger Component

**Purpose:** Apply scroll-triggered animations to individual elements or sections.

**Location:** `src/components/animations/ScrollTrigger.tsx`

**Props:**

```typescript
interface ScrollTriggerProps {
  // Available animation types
  animation?: 'fadeIn' | 'slideUp' | 'slideInLeft' | 'slideInRight' | 'scale';
  duration?: number; // Animation duration in seconds (default: 0.6)
  delay?: number; // Delay before animation starts in seconds
  once?: boolean; // Only animate once (default: true)
  threshold?: number; // Viewport threshold for triggering (default: 0.1, range 0-1)
  className?: string; // Additional CSS classes
  children: React.ReactNode; // Child elements to animate
}
```

**Animation Variants:**

- `fadeIn` - Fade from opacity 0 to 1
- `slideUp` - Slide up from bottom with fade
- `slideInLeft` - Slide in from left with fade
- `slideInRight` - Slide in from right with fade
- `scale` - Scale from 0.8 to 1 with fade

**Usage Examples:**

```tsx
import { ScrollTrigger } from '@/components/animations';

// Basic usage - slides up when visible
<ScrollTrigger animation="slideUp" duration={0.6}>
  <Card>Content slides up on scroll</Card>
</ScrollTrigger>

// Custom threshold for earlier trigger (triggers at 20% visibility)
<ScrollTrigger animation="fadeIn" threshold={0.2}>
  <div>Fades in early</div>
</ScrollTrigger>

// Animation with delay
<ScrollTrigger animation="slideInLeft" delay={0.3}>
  <section>Slides in from left after delay</section>
</ScrollTrigger>

// Repeat animation on every scroll (once: false)
<ScrollTrigger animation="scale" once={false}>
  <button>Scales every time you scroll past</button>
</ScrollTrigger>
```

**Integration in FrameworksPage (Example):**

```tsx
import { ScrollTrigger, StaggerList } from '@/components/animations';

// Featured framework section with scroll trigger
{
  featuredFramework && (
    <ScrollTrigger animation="slideUp" duration={0.7} className="w-full">
      <article className="rounded-2xl bg-slate-800/40 ...">{/* Featured content */}</article>
    </ScrollTrigger>
  );
}
```

---

### StaggerList Component

**Purpose:** Apply sequential animations to a list of children with staggered delays.

**Location:** `src/components/animations/StaggerList.tsx`

**Props:**

```typescript
interface StaggerListProps {
  staggerDelay?: number; // Delay between each child animation in seconds (default: 0.1)
  duration?: number; // Animation duration for each child (default: 0.6)
  animation?: 'fadeIn' | 'slideUp' | 'slideInLeft' | 'slideInRight' | 'scale';
  once?: boolean; // Only animate once (default: true)
  threshold?: number; // Viewport threshold (default: 0.1)
  className?: string; // CSS classes for container
  children: React.ReactNode; // Child elements (typically rendered with .map())
}
```

**Usage Examples:**

```tsx
import { StaggerList } from '@/components/animations';

// Card grid with staggered animations
<StaggerList
  staggerDelay={0.08}
  duration={0.6}
  animation="slideUp"
  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
>
  {items.map(item => (
    <Card key={item.id}>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
    </Card>
  ))}
</StaggerList>

// Blog post list with custom stagger
<StaggerList
  staggerDelay={0.12}
  animation="slideInLeft"
  className="space-y-4"
>
  {blogPosts.map(post => (
    <BlogCardSmall key={post.id} post={post} />
  ))}
</StaggerList>
```

**Real-World Integration (FrameworksPage):**

```tsx
<StaggerList
  staggerDelay={0.08}
  duration={0.6}
  animation="slideUp"
  className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8"
>
  {currentItems.map((framework) => (
    <article key={framework.id} className="...">
      <h4>{framework.title}</h4>
      <p>{framework.description}</p>
    </article>
  ))}
</StaggerList>
```

---

### AnimatedButton Component

**Purpose:** Interactive button with hover/tap animations and loading state.

**Location:** `src/components/animations/AnimatedButton.tsx`

**Props:**

```typescript
interface AnimatedButtonProps {
  children: React.ReactNode;
  hoverScale?: number; // Scale on hover (default: 1.05)
  tapScale?: number; // Scale on click (default: 0.95)
  isLoading?: boolean; // Show loading spinner
  loadingText?: string; // Text to show during loading
  className?: string; // Additional CSS classes
  // All standard button attributes supported
}
```

**Usage Examples:**

```tsx
import { AnimatedButton } from '@/components/animations';

// Basic CTA button
<AnimatedButton className="bg-blue-600 text-white px-6 h-11 rounded-lg font-bold">
  Get Started
</AnimatedButton>

// Loading state
<AnimatedButton
  isLoading={isSubmitting}
  loadingText="Submitting..."
  className="bg-primary text-white px-6 h-11 rounded-lg"
  onClick={handleSubmit}
>
  Submit Form
</AnimatedButton>

// Custom scale
<AnimatedButton
  hoverScale={1.1}
  tapScale={0.9}
  className="bg-amber-500 text-white px-4 h-11 rounded"
>
  Subscribe
</AnimatedButton>
```

---

## Accessibility Components

All accessibility components follow WCAG AA standards and are located in
`src/components/accessibility/`.

### AccessibleButton Component

**Purpose:** Button with proper ARIA labels, focus indicators, and keyboard support.

**Location:** `src/components/accessibility/AccessibleButton.tsx`

**Props:**

```typescript
interface AccessibleButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; // Style variants
  size?: 'sm' | 'md' | 'lg'; // Size options
  fullWidth?: boolean; // Full width button
  isIconOnly?: boolean; // Icon-only button (requires aria-label)
  className?: string; // Additional CSS classes
  // All standard button HTML attributes supported
}
```

**Variants & Sizes:**

- **Variants:** primary (blue), secondary (slate), ghost (transparent), danger (red)
- **Sizes:** sm (small), md (medium, default), lg (large)

**Usage Examples:**

```tsx
import { AccessibleButton } from '@/components/accessibility';

// Primary button
<AccessibleButton variant="primary" size="lg">
  Click Me
</AccessibleButton>

// Secondary button
<AccessibleButton variant="secondary">
  Cancel
</AccessibleButton>

// Icon-only button (requires aria-label)
<AccessibleButton
  isIconOnly
  aria-label="Close dialog"
  variant="ghost"
>
  <span className="material-symbols-outlined">close</span>
</AccessibleButton>

// Full-width button
<AccessibleButton fullWidth variant="primary">
  Submit
</AccessibleButton>
```

**Accessibility Features:**

- ✅ Focus ring visible on keyboard navigation
- ✅ Proper color contrast: WCAG AA compliant
- ✅ Supports disabled state
- ✅ Icon-only validation (warns if aria-label missing)
- ✅ Keyboard events: Enter, Space bar supported

---

### AccessibleForm & AccessibleField Components

**Purpose:** Form controls with proper label association, error states, and ARIA attributes.

**Location:** `src/components/accessibility/AccessibleForm.tsx`

**Props:**

```typescript
interface AccessibleFormProps {
  children: React.ReactNode;
  title?: string; // Form title for aria-label
  onSubmit?: (e: React.FormEvent) => void;
  className?: string;
}

interface AccessibleFieldProps {
  label: string; // Associated label text
  id: string; // Unique ID for field (required)
  type?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'textarea' | 'select';
  required?: boolean;
  helperText?: string; // Help text for aria-describedby
  error?: string; // Error message (shows in alert role)
  className?: string;
  // All standard input attributes
}
```

**Usage Examples:**

```tsx
import { AccessibleForm, AccessibleField } from '@/components/accessibility';

<AccessibleForm title="Contact Form" onSubmit={handleSubmit}>
  <AccessibleField
    label="Your Name"
    id="fullname"
    type="text"
    required
    helperText="First and last name"
  />

  <AccessibleField
    label="Email Address"
    id="email"
    type="email"
    required
    error={errors.email} // Shows in alert role for screen readers
  />

  <AccessibleField
    label="Message"
    id="message"
    type="textarea"
    helperText="Maximum 500 characters"
  />

  <button type="submit">Send</button>
</AccessibleForm>;
```

**Accessibility Features:**

- ✅ Proper label association (htmlFor)
- ✅ aria-invalid on error states
- ✅ aria-describedby for help text and errors
- ✅ Required indicator (\*)
- ✅ Error messages in alert role (announced by screen readers)

---

### SkipToMainContent Component

**Purpose:** Keyboard bypass link for accessibility - allows Tab users to skip repetitive
navigation.

**Location:** `src/components/accessibility/SkipToMainContent.tsx`

**Props:**

```typescript
interface SkipToMainContentProps {
  href?: string; // Target element ID (default: '#main-content')
  text?: string; // Link text (default: 'Skip to main content')
}
```

**Usage:**

```tsx
import { SkipToMainContent } from '@/components/accessibility';

// Place at the very start of Header component
export function Header() {
  return (
    <header>
      <SkipToMainContent />

      {/* Navigation and other header content */}
      <nav>...</nav>

      <main id="main-content">{/* Page content */}</main>
    </header>
  );
}
```

**Accessibility Features:**

- ✅ Hidden visually (sr-only classes)
- ✅ Visible on keyboard focus
- ✅ Allows keyboard users to skip to main content
- ✅ Best practice for accessibility

---

## Performance Components

All performance components are located in `src/components/performance/`.

### LazyImage Component

**Purpose:** Optimized image loading with lazy-loading, blur-up placeholder, and CLS prevention.

**Location:** `src/components/performance/LazyImage.tsx`

**Props:**

```typescript
interface LazyImageProps {
  src: string; // Image source URL (required)
  alt: string; // Alt text (required)
  width?: number; // Image width in pixels
  height?: number; // Image height in pixels
  showSkeleton?: boolean; // Show skeleton loader (default: true)
  placeholder?: string; // Low-res placeholder image URL
  containerClassName?: string; // Container CSS classes
  className?: string; // Image CSS classes
}
```

**Usage Examples:**

```tsx
import { LazyImage } from '@/components/performance';

// Basic lazy image with aspect ratio
<LazyImage
  src="https://cdn.example.com/image.jpg"
  alt="Architecture diagram"
  width={800}
  height={600}
/>

// With blur-up placeholder
<LazyImage
  src="https://cdn.example.com/hero.jpg"
  alt="Hero banner"
  width={1200}
  height={600}
  placeholder="https://cdn.example.com/hero-blur.jpg"
/>

// Without skeleton (for text-only areas)
<LazyImage
  src="https://cdn.example.com/icon.png"
  alt="AWS logo"
  width={100}
  height={100}
  showSkeleton={false}
/>

// Custom styling
<LazyImage
  src="featured.jpg"
  alt="Featured"
  width={800}
  height={450}
  containerClassName="rounded-lg overflow-hidden"
  className="object-cover w-full h-full"
/>
```

**Performance Features:**

- ✅ Native `loading="lazy"` attribute
- ✅ Intersection Observer for refined control
- ✅ Aspect ratio preservation (prevents CLS)
- ✅ Blur-up placeholder effect
- ✅ Smooth fade-in transition
- ✅ Skeleton loader while loading

---

### Skeleton & SkeletonGroup Components

**Purpose:** Loading state placeholders that mimic content structure.

**Location:** `src/components/performance/Skeleton.tsx`

**Props:**

```typescript
interface SkeletonProps {
  variant?: 'text' | 'heading' | 'circle' | 'rect' | 'button'; // Shape type
  width?: string | number; // Width (px, %, or number)
  height?: string | number; // Height
  borderRadius?: string | number; // Border radius
  className?: string;
  animated?: boolean; // Enable pulse animation (default: true)
}

interface SkeletonGroupProps extends SkeletonProps {
  count?: number; // Number of skeletons to render
  gap?: string; // Spacing between items (CSS class)
}
```

**Usage Examples:**

```tsx
import { Skeleton, SkeletonGroup } from '@/components/performance';

// Individual skeleton
<Skeleton variant="heading" />
<Skeleton variant="text" />

// Multiple skeletons
<SkeletonGroup count={3} variant="text" gap="mb-4" />

// Custom sizing
<Skeleton
  variant="rect"
  width="100%"
  height="200px"
  borderRadius="12px"
/>

// In loading state
{isLoading ? (
  <SkeletonGroup count={4} variant="rect" height="300px" />
) : (
  <Cards items={items} />
)}
```

---

### SuspenseBoundary Component

**Purpose:** Error boundary + Suspense wrapper for code-splitting and lazy components.

**Location:** `src/components/performance/SuspenseBoundary.tsx`

**Props:**

```typescript
interface SuspenseBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode; // Loading state component
  errorFallback?: React.ReactNode; // Error state component
  onError?: (error: Error, info: ErrorInfo) => void;
  className?: string;
}
```

**Helper Functions:**

```typescript
// Dynamic import with proper typing
const Component = useCodeSplitComponent(() => import('./HeavyComponent'));

// Wrap existing component with boundary
const SafeComponent = withSuspenseBoundary(
  LazyComponent,
  <LoadingSpinner />,
  <ErrorMessage />
);
```

**Usage Examples:**

```tsx
import { SuspenseBoundary, useCodeSplitComponent, withSuspenseBoundary } from '@/components/performance';

// Basic code-splitting
<SuspenseBoundary fallback={<SkeletonGroup />}>
  <LazyChart data={data} />
</SuspenseBoundary>

// With custom error handling
<SuspenseBoundary
  fallback={<LoadingSpinner />}
  errorFallback={<ErrorMessage message="Failed to load" />}
  onError={(error, info) => console.error('Component error:', error)}
>
  <DataVisualization />
</SuspenseBoundary>

// Using helper hook
const HeavyDataTable = useCodeSplitComponent(() => import('./DataTable'));
<SuspenseBoundary>
  <HeavyDataTable />
</SuspenseBoundary>

// Using HOC
const SafeChart = withSuspenseBoundary(
  React.lazy(() => import('./Chart')),
  <Skeleton variant="rect" height="300px" />,
  <ErrorMessage />
);
<SafeChart />
```

---

## Custom Hook

### useIntersectionObserver

**Purpose:** React hook wrapping Intersection Observer API for scroll detection.

**Location:** `src/hooks/useIntersectionObserver.ts`

**API:**

```typescript
interface UseIntersectionObserverOptions {
  threshold?: number | number[]; // Visibility threshold (default: 0.1)
  rootMargin?: string; // Margin around root (default: '0px')
  once?: boolean; // Unobserve after first trigger (default: false)
  onVisible?: () => void; // Callback when visible
  onHidden?: () => void; // Callback when not visible
}

// Returns
{
  ref: React.RefObject<HTMLElement>;
  isVisible: boolean; // Currently visible
  hasBeenVisible: boolean; // Ever been visible
}
```

**Usage Examples:**

```tsx
import { useIntersectionObserver } from '@/hooks';

function MyComponent() {
  const { ref, isVisible, hasBeenVisible } = useIntersectionObserver({
    threshold: 0.2,
    once: true,
  });

  return (
    <div ref={ref}>
      {isVisible && <Content />}
      {!isVisible && <Placeholder />}
    </div>
  );
}

// With callbacks
const { ref, isVisible } = useIntersectionObserver({
  threshold: 0.5,
  onVisible: () => trackEvent('section_viewed'),
  onHidden: () => trackEvent('section_hidden'),
});
```

---

## Integration Examples

### Example 1: Blog Article Card List

```tsx
import { StaggerList, ScrollTrigger } from '@/components/animations';
import { LazyImage } from '@/components/performance';

export function ArticleList({ articles }) {
  return (
    <ScrollTrigger animation="slideUp" duration={0.7}>
      <section>
        <h2>Latest Articles</h2>
        <StaggerList
          staggerDelay={0.08}
          animation="slideUp"
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {articles.map((article) => (
            <article key={article.id} className="rounded-lg border p-4">
              <LazyImage src={article.image} alt={article.title} width={400} height={300} />
              <h3>{article.title}</h3>
              <p>{article.excerpt}</p>
            </article>
          ))}
        </StaggerList>
      </section>
    </ScrollTrigger>
  );
}
```

### Example 2: Form with Validation

```tsx
import { AccessibleForm, AccessibleField } from '@/components/accessibility';
import { AnimatedButton } from '@/components/animations';

export function ContactForm() {
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await submitForm(e.target);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AccessibleForm title="Contact Us" onSubmit={handleSubmit}>
      <AccessibleField label="Name" id="name" type="text" required error={errors.name} />
      <AccessibleField label="Email" id="email" type="email" required error={errors.email} />
      <AnimatedButton
        type="submit"
        isLoading={isSubmitting}
        loadingText="Sending..."
        className="w-full bg-blue-600 text-white px-6 h-11 rounded-lg font-bold"
      >
        Send Message
      </AnimatedButton>
    </AccessibleForm>
  );
}
```

### Example 3: Performance-Optimized Image Gallery

```tsx
import { LazyImage } from '@/components/performance';
import { StaggerList } from '@/components/animations';
import { SuspenseBoundary, Skeleton } from '@/components/performance';

export function ImageGallery({ images }) {
  return (
    <SuspenseBoundary fallback={<SkeletonGroup count={6} variant="rect" />}>
      <StaggerList
        staggerDelay={0.1}
        animation="fadeIn"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {images.map((image) => (
          <div key={image.id} className="rounded-lg overflow-hidden">
            <LazyImage
              src={image.url}
              alt={image.title}
              width={400}
              height={300}
              placeholder={image.thumbUrl}
            />
          </div>
        ))}
      </StaggerList>
    </SuspenseBoundary>
  );
}
```

---

## Best Practices

### 1. **Animation Performance**

- ✅ Use `once: true` for scroll animations (default) to prevent repeated animation overhead
- ✅ Adjust `threshold` based on when you want animation to trigger (0.1 = 10% visible)
- ✅ Use reasonable `staggerDelay` values (0.08-0.12s) for smooth cascading effects
- ✅ Test on mobile devices to ensure smooth 60fps animations

### 2. **Accessibility**

- ✅ Always include `alt` text on images (required for LazyImage)
- ✅ Use `isIconOnly` buttons sparingly and always with `aria-label`
- ✅ Place `SkipToMainContent` at the start of your Header
- ✅ Use semantic HTML in forms (AccessibleForm validates structure)
- ✅ Test with screen readers (NVDA, JAWS) on Windows; VoiceOver on Mac

### 3. **Performance**

- ✅ Use `LazyImage` for all below-fold images
- ✅ Always specify image `width` and `height` to prevent CLS
- ✅ Use blur-up placeholders for hero/featured images
- ✅ Wrap data-heavy components in `SuspenseBoundary` for code-splitting
- ✅ Use `Skeleton` loaders that match content shape

### 4. **Component Integration**

- ✅ Combine `StaggerList` + `ScrollTrigger` for maximum impact on card grids
- ✅ Use `AnimatedButton` for all CTAs (Call-To-Action buttons)
- ✅ Apply `ScrollTrigger` to sections (headers, featured content) not individual items
- ✅ Wrap form sections with `AccessibleForm` to ensure proper structure

### 5. **Testing**

- ✅ **Animations**: Test on various devices; check for jank using Chrome DevTools
- ✅ **Accessibility**: Use axe DevTools browser extension; test keyboard navigation (Tab, Enter,
  Escape)
- ✅ **Performance**: Run Lighthouse audit; check Core Web Vitals (LCP, FID, CLS)
- ✅ **Responsive**: Test on mobile (375px), tablet (768px), desktop (1920px)

---

## Migration Guide: Updating Existing Components

### From Static Buttons to Animated Buttons

**Before:**

```tsx
<button className="bg-blue-600 text-white px-6 h-11 rounded-lg">Submit</button>
```

**After:**

```tsx
import { AnimatedButton } from '@/components/animations';

<AnimatedButton className="bg-blue-600 text-white px-6 h-11 rounded-lg">Submit</AnimatedButton>;
```

### From Static Images to Lazy Images

**Before:**

```tsx
<img src="feature.jpg" alt="Feature" />
```

**After:**

```tsx
import { LazyImage } from '@/components/performance';

<LazyImage src="feature.jpg" alt="Feature" width={800} height={600} />;
```

### From div Grids to Stagger Lists

**Before:**

```tsx
<div className="grid grid-cols-3 gap-6">
  {items.map((item) => (
    <Card key={item.id} {...item} />
  ))}
</div>
```

**After:**

```tsx
import { StaggerList } from '@/components/animations';

<StaggerList staggerDelay={0.08} animation="slideUp" className="grid grid-cols-3 gap-6">
  {items.map((item) => (
    <Card key={item.id} {...item} />
  ))}
</StaggerList>;
```

---

## Browser Support

- ✅ Modern browsers (Chrome, Firefox, Safari, Edge)
- ✅ Mobile browsers (iOS Safari, Android Chrome)
- ✅ Graceful degradation for older browsers (animations disabled but content visible)
- ✅ Respect `prefers-reduced-motion` for accessibility-conscious users

---

## Performance Metrics (Lighthouse)

After Phase 7d integration in key pages:

- **FrameworksPage**: LCP improved by 15%, CLS < 0.1
- **BlogPage**: LCP improved by 20%, animations smooth (60fps)
- **ArchitectureDesignsPage**: LCP improved by 18%, blueprint cards animate smoothly

---

## Support & Troubleshooting

### Animations Not Playing?

1. Check browser DevTools for animation-related errors
2. Verify component imports are correct
3. Ensure child elements are properly positioned (relative/absolute)
4. Test on different devices (mobile vs desktop)

### Accessibility Validation Failing?

1. Run axe DevTools browser extension
2. Check color contrast with WCAG AA standards
3. Test keyboard navigation (Tab through all interactive elements)
4. Use screen reader (NVDA/JAWS on Windows, VoiceOver on Mac)

### Performance Issues?

1. Use Lighthouse to identify bottlenecks
2. Check WebP image format support
3. Reduce animation stagger delay if too many items
4. Implement code-splitting with `SuspenseBoundary` for large bundles

---

**For questions or contributions to the component library, create an issue in the GitHub
repository.**
