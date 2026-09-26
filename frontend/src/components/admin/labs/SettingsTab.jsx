/**
 * Settings — how a VPS agent is provisioned in the first place (#577).
 *
 * These are the Setup tab's six steps. What left is the live connection state
 * that sat above them: that is the Agents tab now, because an operator asking
 * "why is it disconnected" does not need install instructions, and an operator
 * following these steps does not yet have an agent to look at.
 */
import React from 'react';
import { Card } from '@/components/ui/card';
import { tabHref } from './tabs';

const SETUP_STEPS = [
  {
    title: 'Harden the Hostinger VPS',
    body: 'SSH key-only auth (PasswordAuthentication no, PermitRootLogin no), then enable the Hostinger firewall / ufw allowing only outbound traffic plus your SSH port. The agent is pull-based — it needs zero inbound ports.',
  },
  {
    title: 'Install Docker + Node.js 26',
    body: 'On the Hostinger lab host, lab-host/bootstrap.sh does this: its Ansible play installs Docker Engine from download.docker.com and Node.js 26 from NodeSource at the versions pinned in lab-host/ansible/group_vars/all.yml. On any other host, install the same two from those repositories. Pre-pull the sandbox images: alpine:3.20, hashicorp/terraform:1.9, alpine/ansible:2.17.0.',
  },
  {
    title: 'Provision the Entra agent identity',
    body: 'Create one confidential Entra app registration per VPS host, assign the LabAgent app role on the API app, upload only the public certificate, and register lab_agents/{agentId} with its object ID, active flag, and allowed capabilities. No Firebase/GCP project, service account, or database key is required.',
  },
  {
    title: 'Install the Azure API agent',
    body: 'Copy vps-agent/* to /opt/hcw-labs-agent, run npm ci --omit=dev, copy .env.example to .env, and set LABS_AGENT_API_BASE, LABS_AGENT_TENANT_ID, LABS_AGENT_CLIENT_ID, LABS_AGENT_CERT_PATH, LABS_AGENT_API_SCOPE, and LABS_AGENT_ID. Keep the PEM owned by root, group hcw-labs-agent, mode 0640 (chown root:hcw-labs-agent, chmod 640) so only the service user can read it. lab-host/ansible does all of this for the Hostinger host.',
  },
  {
    title: 'Enable the systemd service',
    body: 'Run vps-agent/index.js under a dedicated hcw-labs-agent user with systemd or your process supervisor. The agent calls the Azure Functions API and holds no Cosmos DB or Firebase credential.',
  },
  {
    title: 'Run the smoke test',
    body: 'The agent should appear Online below within ~30 seconds. Then go to the Console tab, pick shell-echo, payload "hello vps", and Submit — the job should run queued → claimed → running → succeeded with the payload echoed back.',
  },
];

export default function SettingsTab() {
  return (
    <div className="space-y-6 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Provisioning a new VPS agent, in order. Once one is heartbeating it appears on{' '}
        <a href={tabHref('agents')} className="underline">
          the Agents tab
        </a>
        , which is also where a disconnected one is diagnosed.
      </p>

      <div className="space-y-3">
        {SETUP_STEPS.map((step, i) => (
          <Card key={step.title} className="p-4">
            <div className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{step.body}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Current agent source and environment template: <code>vps-agent/index.js</code> and{' '}
        <code>vps-agent/.env.example</code> in the repo. The agent reaches this API through its
        scoped Entra credential; it does not access Cosmos directly.
      </p>
    </div>
  );
}
