/**
 * Performance Components
 *
 * Collection of components optimized for performance:
 * - LazyImage: Image lazy-loading with blur-up and aspect ratio preservation
 * - Skeleton: Loading state placeholder components
 * - SuspenseBoundary: Code-splitting with Suspense and Error Boundary
 */

export { LazyImage } from './LazyImage';
export type { LazyImageProps } from './LazyImage';

export { Skeleton, SkeletonGroup } from './Skeleton';
export type { SkeletonProps, SkeletonGroupProps } from './Skeleton';

export { SuspenseBoundary, useCodeSplitComponent, withSuspenseBoundary } from './SuspenseBoundary';
export type { SuspenseBoundaryProps } from './SuspenseBoundary';
