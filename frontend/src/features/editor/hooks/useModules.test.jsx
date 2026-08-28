import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useModules } from './useModules';

describe('useModules', () => {
  it('prefills the default callout title when selecting callout while adding', () => {
    const { result } = renderHook(() => useModules('', vi.fn()));

    act(() => {
      result.current.applyModuleTypeSelection('callout');
    });

    expect(result.current.moduleForm.title).toBe('Heads up');
    expect(result.current.moduleForm.content).toBe('One or two sentences of detail.');
  });

  it('restores the default callout title when resetting the callout form', () => {
    const { result } = renderHook(() => useModules('', vi.fn()));

    act(() => {
      result.current.applyModuleTypeSelection('callout');
      result.current.setModuleFormField('title', '');
      result.current.resetModuleForm('callout');
    });

    expect(result.current.moduleForm.title).toBe('Heads up');
    expect(result.current.moduleForm.content).toBe('One or two sentences of detail.');
  });
});
