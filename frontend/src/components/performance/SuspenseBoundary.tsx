/**
 * SuspenseBoundary Component
 *
 * Error boundary + Suspense wrapper for code-splitting with lazy components
 * Handles loading states and error scenarios gracefully
 *
 * @example
 * ```tsx
 * const HeavyChart = React.lazy(() => import('./HeavyChart'));
 *
 * <SuspenseBoundary
 *   fallback={<LoadingState />}
 *   errorFallback={<ErrorState />}
 * >
 *   <HeavyChart />
 * </SuspenseBoundary>
 * ```
 */

import React, { Suspense, ReactNode, ErrorInfo } from 'react';
import { Skeleton } from './Skeleton';

export interface SuspenseBoundaryProps {
  /**
   * Content to render
   */
  children: ReactNode;
  /**
   * Loading fallback component
   */
  fallback?: ReactNode;
  /**
   * Error fallback component
   */
  errorFallback?: ReactNode;
  /**
   * Callback when error occurs
   */
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Additional CSS class
   */
  className?: string;
}

/**
 * Error Boundary Component
 * Catches errors in child components and displays fallback UI
 */
class ErrorBoundary extends React.Component<
  {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, info: ErrorInfo) => void;
  },
  { hasError: boolean; error?: Error }
> {
  constructor(props: {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, info: ErrorInfo) => void;
  }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
    console.error('SuspenseBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="text-red-600 mb-4">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to load component</h3>
            <p className="text-gray-600 text-center text-sm mb-4">
              There was an error loading this content. Please try refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              aria-label="Refresh page"
            >
              Refresh Page
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * Default loading skeleton component
 */
function DefaultLoadingFallback() {
  return (
    <div className="space-y-4 py-8 px-4">
      <Skeleton variant="heading" />
      <Skeleton variant="text" />
      <Skeleton variant="text" className="w-4/5" />
      <Skeleton variant="rect" className="h-52" />
    </div>
  );
}

/**
 * SuspenseBoundary Component
 * Combines Error Boundary + Suspense for robust component loading
 */
export function SuspenseBoundary({
  children,
  fallback,
  errorFallback,
  onError,
  className = '',
}: SuspenseBoundaryProps) {
  return (
    <ErrorBoundary fallback={errorFallback} onError={onError}>
      <Suspense fallback={fallback ?? <DefaultLoadingFallback />}>
        <div className={className}>{children}</div>
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * useCodeSplitComponent Hook
 * Helper to dynamically import components with proper typing
 *
 * @example
 * ```tsx
 * const Component = useCodeSplitComponent(() => import('./Heavy.tsx'));
 *
 * <SuspenseBoundary>
 *   <Component />
 * </SuspenseBoundary>
 * ```
 */
export function useCodeSplitComponent<P extends object>(
  importFn: () => Promise<{ default: React.ComponentType<P> }>
): React.ComponentType<P> {
  return React.lazy(importFn);
}

/**
 * withSuspenseBoundary HOC
 * Wraps a component with SuspenseBoundary for convenient lazy loading
 *
 * @example
 * ```tsx
 * const LazyChart = withSuspenseBoundary(
 *   React.lazy(() => import('./Chart')),
 *   <SkeletonGroup />
 * );
 *
 * <LazyChart data={data} />
 * ```
 */
export function withSuspenseBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
  errorFallback?: ReactNode
): React.ComponentType<P> {
  const componentMeta = Component as { displayName?: string; name?: string };
  const displayName = componentMeta.displayName || componentMeta.name || 'Component';

  const Wrapped = (props: P) => (
    <SuspenseBoundary fallback={fallback} errorFallback={errorFallback}>
      <Component {...props} />
    </SuspenseBoundary>
  );

  Wrapped.displayName = `withSuspenseBoundary(${displayName})`;
  return Wrapped;
}
