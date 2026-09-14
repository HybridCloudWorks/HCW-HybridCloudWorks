/** Labels and date formatting shared by the newsletter issue components. */

export const STATUS_LABELS = {
  draft: 'Draft',
  sending: 'Sending',
  scheduled: 'Scheduled',
  sent: 'Sent',
  rejected: 'Rejected',
};

export function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** "immediately", a formatted instant, or '' when there is no plan. */
export function describePlan(plan) {
  if (!plan) return '';
  if (plan.sendNow) return 'immediately';
  return formatWhen(plan.scheduledAt);
}
