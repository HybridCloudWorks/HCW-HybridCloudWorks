import { createContext, useContext } from 'react';
import { useEditorState } from '../hooks/useEditorState';

export const EditorContext = createContext(null);

/**
 * Provides editor state to the entire editor subtree.
 * All leaf components call useEditor() to read state directly —
 * no prop drilling.
 */
export function EditorProvider({ blogId, navigate, children }) {
  const state = useEditorState(blogId, navigate);
  return <EditorContext.Provider value={state}>{children}</EditorContext.Provider>;
}

/**
 * Convenience hook for consuming editor context.
 * Throws a clear error if used outside an EditorProvider.
 */
export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditor must be used inside an <EditorProvider>');
  }
  return ctx;
}
