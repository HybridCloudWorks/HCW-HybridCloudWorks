/**
 * The Calendar's writes as one hook (ADR 0033 Amplify slice): a drop on a
 * day, the schedule dialog's submit, and a reschedule request from the
 * preview — each a toast and a refetch, so SharedCalendar is left with what
 * it renders.
 *
 * The drop rules are the pure `planDrop`, so the grid's handler is a dispatch
 * and the rules can be read, and tested, on their own.
 */
import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { getPublishTargetForItem } from '@/lib/contentModel';
import { scheduleContent } from './calendarApi';
import {
  browserTimeZone,
  combineDateTime,
  formatWhen,
  isPastDay,
  timeInputValue,
} from './calendarModel';

const whenSentence = (when) =>
  `Publishes ${formatWhen(when.toISOString())} (${browserTimeZone()}).`;

/**
 * What a drop on `day` should do. Pure.
 *
 *   refuse   a past day, or a moved time that has already passed today
 *   dialog   an Unscheduled card dropped on today after nine: pick a time
 *   write    schedule (unscheduled → 09:00 that day) or move (keep the time of day)
 */
export function planDrop(day, payload, { unscheduled = [], now = new Date() } = {}) {
  if (isPastDay(day, now)) {
    return {
      kind: 'refuse',
      title: 'That day has passed',
      message: 'Drop it on today or a later day.',
    };
  }
  if (payload.source === 'unscheduled') {
    const content = unscheduled.find((row) => row.id === payload.contentId) || null;
    const when = combineDateTime(day, '09:00');
    if (when.getTime() <= now.getTime()) {
      return {
        kind: 'dialog',
        content: content || { id: payload.contentId, title: 'this content' },
        day,
      };
    }
    return {
      kind: 'write',
      label: 'Scheduled',
      contentId: payload.contentId,
      when,
      publishTarget: payload.publishTarget || (content ? getPublishTargetForItem(content) : null),
      done: whenSentence(when),
    };
  }
  if (payload.source === 'calendar') {
    const when = combineDateTime(day, timeInputValue(payload.start));
    if (!when || when.getTime() <= now.getTime()) {
      return {
        kind: 'refuse',
        title: 'That time has passed today',
        message: 'Use Reschedule to pick a later time.',
      };
    }
    return {
      kind: 'write',
      label: 'Moved',
      contentId: payload.contentId,
      when,
      publishTarget: payload.publishTarget || null,
      done: `Now publishes ${formatWhen(when.toISOString())} (${browserTimeZone()}).`,
    };
  }
  return { kind: 'refuse', title: 'Nothing to drop', message: 'That was not a calendar item.' };
}

/**
 * @param {{ unscheduled: object[], onChanged: () => void }} args
 *   `onChanged` is called after every successful write: the refetch.
 * @returns {{
 *   busy: boolean,
 *   scheduling: object|null, setScheduling: Function,
 *   onDrop: (day: Date, payload: object) => void,
 *   submitSchedule: ({ content, when }) => Promise<boolean>,
 *   reschedule: (item: object) => void,
 *   quickCreate: (day: Date) => void,
 * }}
 */
export default function useCalendarWrites({ unscheduled, onChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // `{ content?, day?, time?, mode, excludeId? }` while the schedule dialog is open.
  const [scheduling, setScheduling] = useState(null);

  const write = async (label, action, done) => {
    setBusy(true);
    try {
      await action();
      toast({ title: label, description: done });
      onChanged();
      return true;
    } catch (err) {
      toast({ title: `${label} failed`, description: err.message, variant: 'destructive' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (day, payload) => {
    const plan = planDrop(day, payload, { unscheduled, now: new Date() });
    if (plan.kind === 'refuse') {
      toast({ title: plan.title, description: plan.message, variant: 'destructive' });
      return;
    }
    if (plan.kind === 'dialog') {
      setScheduling({ content: plan.content, day: plan.day, time: '09:00', mode: 'schedule' });
      return;
    }
    write(
      plan.label,
      () =>
        scheduleContent({
          contentId: plan.contentId,
          when: plan.when,
          publishTarget: plan.publishTarget,
        }),
      plan.done
    );
  };

  const submitSchedule = ({ content, when }) =>
    write(
      scheduling?.mode === 'reschedule' ? 'Moved' : 'Scheduled',
      () =>
        scheduleContent({
          contentId: content.id,
          when,
          publishTarget: content.publishTarget || getPublishTargetForItem(content),
        }),
      whenSentence(when)
    );

  const quickCreate = (day) =>
    setScheduling({ content: null, day, time: '09:00', mode: 'schedule' });

  const reschedule = (item) =>
    setScheduling({
      content: {
        id: item.sourceId,
        title: item.title,
        publishTarget: item.meta?.publishTarget || null,
      },
      day: new Date(item.start),
      time: timeInputValue(item.start),
      mode: 'reschedule',
      excludeId: item.id,
    });

  return { busy, scheduling, setScheduling, onDrop, submitSchedule, reschedule, quickCreate };
}
