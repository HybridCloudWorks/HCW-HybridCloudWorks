/**
 * The Draft tab's own state (ADR 0033 §7 slice 2): the direction and tone
 * the AI actions take, the result text as edited, the range an action was
 * run on, and which action is in flight. The session owns the document;
 * this owns only what the tab needs between a click and a "use".
 */
import { useRef, useState } from 'react';
import { TONES } from './brief';
import { applyAssistResult, selectionFor, sourceText } from './draftModel';

export function useDraftActions(session) {
  const bodyRef = useRef(null);
  const [instruction, setInstruction] = useState('');
  const [tone, setTone] = useState(TONES[0]);
  const [resultText, setResultText] = useState('');
  const [range, setRange] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);

  /** Run one action over the selection (when it takes one) or the whole body. */
  const runAction = async (actionId) => {
    const selected = selectionFor(actionId, bodyRef.current);
    const source = sourceText(session.text.body, selected);
    if (!source.trim()) return;
    setRange(selected);
    setPendingAction(actionId);
    try {
      const result = await session.assist(actionId, { text: source, instruction, tone });
      if (typeof result?.result?.text === 'string') setResultText(result.result.text);
    } finally {
      setPendingAction(null);
    }
  };

  /** Land a result on the session and dismiss it. */
  const apply = (change) => {
    applyAssistResult(session, change, {
      body: session.text.body,
      keywords: session.brief.seoKeywords,
      range,
    });
    session.clearAssist();
  };

  return {
    bodyRef,
    instruction,
    setInstruction,
    tone,
    setTone,
    resultText,
    setResultText,
    pendingAction,
    hasSelection: Boolean(range && range.start !== range.end),
    runAction,
    apply,
  };
}
