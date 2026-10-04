/**
 * Approved and forge-ready content with no schedule: what the Calendar's
 * Unscheduled panel offers to drag onto a day (ADR 0033 Amplify slice).
 */
import { useCallback } from 'react';
import { getJSON } from '@/lib/api';
import useGuardedLoad from '@/components/admin/speaking-events/useGuardedLoad';
import { isUnscheduled } from './calendarModel';

const EMPTY = Object.freeze([]);
const describeError = (err) => err?.message || 'Unscheduled content could not be read.';

/** The statuses that are one step from publishing; `ready_to_publish` and `approved_blog` are old spellings still stored. */
export const UNSCHEDULED_ROUTE =
  'cms/content?status=approved,forge_ready,ready_to_publish,approved_blog&limit=200';

async function load() {
  const res = await getJSON(UNSCHEDULED_ROUTE);
  return (Array.isArray(res?.items) ? res.items : []).filter(isUnscheduled);
}

export default function useUnscheduledContent(enabled = true) {
  // Inline, as the hooks lint asks; `load` itself is module-level and stable.
  const stable = useCallback(() => load(), []);
  return useGuardedLoad(stable, { enabled, empty: EMPTY, describeError });
}
