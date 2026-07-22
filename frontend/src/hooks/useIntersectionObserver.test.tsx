import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { useIntersectionObserver } from './useIntersectionObserver';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock IntersectionObserver
const observeMock = vi.fn();
const unobserveMock = vi.fn();
const disconnectMock = vi.fn();
let createdObservers = 0;

beforeEach(() => {
  createdObservers = 0;
  observeMock.mockClear();
  unobserveMock.mockClear();
  disconnectMock.mockClear();

  // Reset the global observers map if possible?
  // Since `observers` is module-scoped in the hook file, we can't easily reset it directly.
  // This means tests are not perfectly isolated regarding the shared cache.
  // However, we can use distinct options (e.g. unique thresholds) to force new observers.

  // Mock the constructor correctly
  window.IntersectionObserver = class MockIntersectionObserver {
    callback: IntersectionObserverCallback;
    options?: IntersectionObserverInit;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      createdObservers++;
      this.callback = callback;
      this.options = options;
    }
    observe = observeMock;
    unobserve = unobserveMock;
    disconnect = disconnectMock;
    takeRecords = () => [];
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TestComponent = ({ id, options }: { id: string; options?: IntersectionObserverInit }) => {
  const { ref } = useIntersectionObserver(options);
  return (
    <div ref={ref} data-testid={id}>
      Hello
    </div>
  );
};

describe('useIntersectionObserver', () => {
  it('shares a single observer for components with identical options', () => {
    // Use a unique threshold to ensure we don't hit cache from previous runs if any
    const uniqueThreshold = 0.12345;

    render(
      <>
        <TestComponent id="comp1" options={{ threshold: uniqueThreshold }} />
        <TestComponent id="comp2" options={{ threshold: uniqueThreshold }} />
        <TestComponent id="comp3" options={{ threshold: uniqueThreshold }} />
      </>
    );

    // Optimized: Should create only 1 observer for all 3 components
    expect(createdObservers).toBe(1);
  });

  it('creates separate observers for different options', () => {
    // Use unique thresholds to avoid cache hits
    const t1 = 0.555;
    const t2 = 0.666;

    render(
      <>
        <TestComponent id="comp1" options={{ threshold: t1 }} />
        <TestComponent id="comp2" options={{ threshold: t2 }} />
      </>
    );

    // Should create 2 distinct observers
    expect(createdObservers).toBe(2);
  });

  it('creates separate observers when a custom root is provided (no sharing)', () => {
    const rootElement = document.createElement('div');
    const uniqueThreshold = 0.999;

    render(
      <>
        <TestComponent id="comp1" options={{ threshold: uniqueThreshold, root: rootElement }} />
        <TestComponent id="comp2" options={{ threshold: uniqueThreshold, root: rootElement }} />
      </>
    );

    // Custom roots bypass the sharing logic in our implementation
    // So we expect 2 observers here (one per component)
    expect(createdObservers).toBe(2);
  });
});
