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

  it('commits a picker-default callout to the draft with both title and body', () => {
    // The end-to-end of the reported bug: straight from the picker, "Add to
    // Article" must land a callout the backend validator would accept
    // (title AND body), not just prefill the form.
    let draft = '';
    const setDraft = vi.fn((next) => {
      draft = next;
    });
    const { result } = renderHook(() => useModules(draft, setDraft));

    act(() => {
      result.current.applyModuleTypeSelection('callout');
    });
    act(() => {
      result.current.addModuleToDraft();
    });

    expect(setDraft).toHaveBeenCalledTimes(1);
    const match = draft.match(/<module type="callout" align="left">([\s\S]*?)<\/module>/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match[1]);
    expect(payload.title).toBe('Heads up');
    expect(payload.body).toBe('One or two sentences of detail.');
  });
});
