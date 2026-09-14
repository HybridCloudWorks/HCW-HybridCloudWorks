/**
 * The Alerts tab's state: the filter, resolution notes, the action in flight,
 * and the tab's own outcome line (#569). Moved out of HealthPage.jsx.
 *
 * The outcome line used to be written into the smoke actions' message, which
 * rendered on a card an operator answering an alert was no longer looking at.
 */

import { useState } from 'react';
import { postJSON } from '@/lib/api';
import { getAlertActionLabel } from './signals';

/** @param {{ refresh: () => Promise<boolean> }} ops the snapshot hook, re-read after each write */
export default function useAlertActions(ops) {
  const [actionId, setActionId] = useState('');
  const [filter, setFilter] = useState('open');
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleAction = async (alertId, action) => {
    setError('');
    setMessage('');
    setActionId(`${alertId}:${action}`);
    try {
      const resolutionNote = resolutionNotes[alertId] || '';
      await postJSON('updateWorkflowAlert', { alertId, action, resolutionNote });
      if (action === 'resolve') {
        setResolutionNotes((prev) => ({ ...prev, [alertId]: '' }));
      }
      setMessage(`${getAlertActionLabel(action)} alert ${alertId}.`);
      // The write landed whatever the re-read does; a failed re-read is the
      // snapshot's error, shown on this tab beneath the message.
      await ops.refresh();
    } catch (err) {
      setError(err?.message || `Failed to ${action} alert.`);
    } finally {
      setActionId('');
    }
  };

  return {
    filter,
    setFilter,
    actionId,
    resolutionNotes,
    setResolutionNotes,
    handleAction,
    message,
    error,
  };
}
