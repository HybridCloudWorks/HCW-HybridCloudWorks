/**
 * Skeleton Component
 *
 * Loading state placeholder that mimics the final content structure
 * Improves perceived performance and reduces layout shift
 *
 * @example
 * ```tsx
 * {isLoading ? (
 *   <div>
 *     <Skeleton variant="heading" className="mb-4" />
 *     <Skeleton variant="text" />
 *     <Skeleton variant="text" className="w-4/5" />
 *   </div>
 * ) : (
 *   <Article />
 * )}
 * ```
 */

import React from 'react';

export interface SkeletonProps {
  /**
   * Skeleton shape/variant
   */
  variant?: 'text' | 'heading' | 'circle' | 'rect' | 'button';
  /**
   * Additional CSS class
   */
  className?: string;
  /**
   * Animation enabled
   * @default true
   */
  animated?: boolean;
}

const variantClasses: Record<NonNullable<SkeletonProps['variant']>, string> = {
  text: 'h-4 rounded w-full',
  heading: 'h-8 rounded-lg w-full',
  circle: 'h-12 w-12 rounded-full',
  rect: 'h-40 rounded-lg w-full',
  button: 'h-10 w-24 rounded-md',
};

export function Skeleton({ variant = 'text', className, animated = true }: SkeletonProps) {
  const variantClass = variantClasses[variant];

  return (
    <div
      className={`
        ${animated ? 'animate-pulse' : ''}
        bg-slate-200
        ${variantClass}
        ${className || ''}
      `}
      aria-busy="true"
      aria-label="Loading"
      role="progressbar"
    />
  );
}

/**
 * SkeletonGroup Component
 *
 * Renders multiple skeletons with consistent spacing
 *
 * @example
 * ```tsx
 * <SkeletonGroup count={3} variant="text" gap="mb-4" />
 * ```
 */
export interface SkeletonGroupProps extends SkeletonProps {
  /**
   * Number of skeleton items to render
   */
  count?: number;
  /**
   * Spacing between items (CSS class)
   */
  gap?: string;
}

export function SkeletonGroup({ count = 3, gap = 'mb-4', ...props }: SkeletonGroupProps) {
  return (
    <div>
      {Array(count)
        .fill(0)
        .map((_, i) => (
          <Skeleton key={i} {...props} className={`${gap} ${props.className || ''}`} />
        ))}
    </div>
  );
}
