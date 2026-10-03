/**
 * Ambassador Hub (route /admin/ambassador) — Spotlight. Filled in by the
 * Ambassador slice (ADR 0033 §4 and the brief's module spec).
 */
import React from 'react';
import { BadgeCheck } from 'lucide-react';
import PageHeader from '@/components/admin/shared/PageHeader';
import EmptyState from '@/components/admin/shared/EmptyState';

export default function AmbassadorPage() {
  return (
    <div className="space-y-6">
      <PageHeader icon={BadgeCheck} title="Ambassador" />
      <EmptyState
        title="The Ambassador hub is being built"
        description="Programs, applications, evidence and renewals will live here."
      />
    </div>
  );
}
