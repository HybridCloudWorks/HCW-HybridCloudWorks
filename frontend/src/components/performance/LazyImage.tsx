/**
 * LazyImage Component
 *
 * Performance-optimized image component with:
 * - Lazy loading (native browser support)
 * - Placeholder/skeleton loading state
 * - Blur-up effect for visual polish
 * - Proper aspect ratio to prevent CLS (Cumulative Layout Shift)
 * - AVIF/WebP fallback support
 *
 * @example
 * ```tsx
 * <LazyImage
 *   src="image.jpg"
 *   alt="Description"
 *   ratio="16/9"
 *   showSkeleton
 * />
 * ```
 */

import React, { ImgHTMLAttributes, useState } from 'react';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';

export interface LazyImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt'> {
  /**
   * Image source URL
   */
  src: string;
  /**
   * Alt text (required for a11y)
   */
  alt: string;
  /**
   * Aspect ratio preset for layout stability
   * @default 'auto'
   */
  ratio?: '16/9' | '4/3' | '1/1' | '3/4' | 'auto';
  /**
   * Show skeleton loading state
   * @default true
   */
  showSkeleton?: boolean;
  /**
   * Placeholder image (low-res, blur-up effect)
   */
  placeholder?: string;
  /**
   * CSS class for image container
   */
  containerClassName?: string;
}

export function LazyImage({
  src,
  alt,
  ratio = 'auto',
  showSkeleton = true,
  placeholder,
  containerClassName,
  className,
  ...props
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const { ref, isVisible } = useIntersectionObserver({
    threshold: 0.05,
    once: true,
  });

  const ratioClassMap: Record<NonNullable<LazyImageProps['ratio']>, string> = {
    '16/9': 'ratio-16-9',
    '4/3': 'ratio-4-3',
    '1/1': 'ratio-1-1',
    '3/4': 'ratio-3-4',
    auto: '',
  };

  const ratioClass = ratioClassMap[ratio];
  const containerClasses = ['relative overflow-hidden bg-slate-100', ratioClass, containerClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={containerClasses}>
      {/* Placeholder/skeleton while loading */}
      {showSkeleton && !isLoaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 animate-pulse" />
      )}

      {/* Blur-up placeholder image */}
      {placeholder && !isLoaded && (
        <img
          src={placeholder}
          alt={alt}
          className={`
            absolute inset-0 w-full h-full object-cover
            filter blur-lg
            ${className || ''}
          `}
          aria-hidden="true"
        />
      )}

      {/* Main image - lazy load only when visible */}
      {isVisible ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          className={`
            absolute inset-0 w-full h-full object-cover
            transition-opacity duration-300
            ${isLoaded ? 'opacity-100' : 'opacity-0'}
            ${className || ''}
          `}
          {...props}
        />
      ) : (
        // Placeholder div before intersection
        <div className="absolute inset-0 bg-slate-100" />
      )}
    </div>
  );
}
