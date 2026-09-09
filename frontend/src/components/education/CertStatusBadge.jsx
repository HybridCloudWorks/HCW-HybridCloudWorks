/**
 * The lifecycle badge on a certification card, driven by `describeCertStatus`
 * so the words on the page come from the dates, never from a stale field
 * (#461). Renders nothing for an active exam.
 */
import React from 'react';
import { describeCertStatus } from '@/lib/certStatus';

const STATUS_CLASS = {
  expiring: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
  retired: 'bg-slate-500/20 border-slate-500/40 text-slate-300',
  beta: 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300',
  upcoming: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
};

export default function CertStatusBadge({ cert, now, className = '' }) {
  const { status, label, detail } = describeCertStatus(cert, now);
  if (!label) return null;
  return (
    <span
      data-cert-status={status}
      className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-bold rounded uppercase tracking-wider ${STATUS_CLASS[status] ?? STATUS_CLASS.retired} ${className}`}
    >
      {label}
      {detail ? <span className="normal-case font-semibold opacity-80">· {detail}</span> : null}
    </span>
  );
}
