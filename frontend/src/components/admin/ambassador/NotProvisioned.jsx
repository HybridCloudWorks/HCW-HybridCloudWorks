/**
 * The one state the hub shows until the `ambassador` container exists
 * (ADR 0033 §6 item 4). The API answers 503 `NOT_PROVISIONED`; this names
 * the step that fixes it — the owner's plan command, PowerShell as the
 * working agreements require, plan only and never an apply from a page.
 */
import React from 'react';
import { Database } from 'lucide-react';
import EmptyState from '@/components/admin/shared/EmptyState';

export const PLAN_COMMAND = 'terraform -chdir=infra plan';

export default function NotProvisioned({ onRetry }) {
  return (
    <EmptyState
      icon={Database}
      title="The ambassador container is not provisioned yet"
      description={
        <>
          The API answered <code>NOT_PROVISIONED</code>: Cosmos DB has no <code>ambassador</code>{' '}
          container. It is declared in <code>infra/cosmos-containers.json</code> (from{' '}
          <code>scripts/lib/migration-manifest.mjs</code>) and is created by a Terraform apply,
          which needs the owner&apos;s review. Preview the change first — PowerShell, from the
          repository root:
          <br />
          <code className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs">
            {PLAN_COMMAND}
          </code>
          <br />A successful plan lists one container to add and nothing to change or destroy.
          Nothing else in ContentForge depends on this container.
        </>
      }
      onRetry={onRetry}
    />
  );
}
