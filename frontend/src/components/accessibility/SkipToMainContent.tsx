/**
 * SkipToMainContent Component
 *
 * WCAG best practice: Provides keyboard users with a way to skip
 * repetitive navigation and jump directly to main content.
 *
 * Typically placed at the very start of the header/nav, hidden visually
 * but appears on keyboard focus.
 *
 * @example
 * ```tsx
 * <Header>
 *   <SkipToMainContent href="#main-content" />
 *   <nav>...</nav>
 * </Header>
 * <main id="main-content">
 *   (Page content here)
 * </main>
 * ```
 */

import React from 'react';

export interface SkipToMainContentProps {
  /**
   * ID of the main content element to skip to
   */
  href: string;
  /**
   * Link text (default: "Skip to main content")
   */
  text?: string;
}

export function SkipToMainContent({ href, text = 'Skip to main content' }: SkipToMainContentProps) {
  return (
    <a
      href={href}
      className="
        sr-only focus:not-sr-only
        absolute top-0 left-0
        z-50
        px-4 py-2
        bg-blue-600 text-white
        font-medium rounded-b-md
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-800
      "
    >
      {text}
    </a>
  );
}

/**
 * sr-only (screen reader only) CSS class
 * Add this to your global CSS or Tailwind config if not present:
 *
 * @layer components {
 *   .sr-only {
 *     @apply absolute w-1 h-1 p-0 -m-1 overflow-hidden clip-path bg-transparent border-0;
 *   }
 *   .focus\:not-sr-only:focus {
 *     @apply static w-auto h-auto p-0 m-0 overflow-visible;
 *   }
 * }
 */
