/**
 * Settings — how a VPS agent is provisioned in the first place (#577), as
 * the lab host actually does it since lab-host/ landed (ADR 0033 inventory,
 * 2026-10-03: the steps here still said to copy a `.env` file and watch for
 * a `running` status, neither of which exists).
 *
 * On the Hostinger host every step below is `lab-host/bootstrap.sh`: its
 * Ansible play (roles `hardening`, `docker`, `labs_agent`, `lab_images`)
 * does them in order, and the only hand step is registering the agent on
 * the Agents tab. The list is for reading what the play does, and for a host
 * that is not that one.
 */
import React from 'react';
import { Card } from '@/components/ui/card';
import { tabHref } from './tabs';

export const SETUP_STEPS = Object.freeze([
  {
    title: 'Harden the host',
    body: 'SSH key-only login (PasswordAuthentication no, PermitRootLogin no), ufw deny-in with TCP 22, 80 and 443 open, unattended-upgrades and a fail2ban sshd jail: the hardening role. The agent is pull-based and needs no inbound port of its own.',
  },
  {
    title: 'Install Docker and Node.js 26',
    body: 'Docker Engine from download.docker.com and Node.js 26 from NodeSource, at the versions pinned in lab-host/ansible/group_vars/all.yml: the docker and labs_agent roles. The lab_images role then pulls every image a job runs by the digests IMAGES pins in vps-agent/lib/capabilities.js, so no job waits on a first download.',
  },
  {
    title: 'Provision the Entra agent identity',
    body: 'scripts/lab/Register-LabAgent.ps1, as the owner: one Entra app registration per host holding only its public certificate, with the LabAgent app role on the API app. It prints the agent id and the service principal object id; enter both in Register agent on the Agents tab, which writes the lab_agents document the API admits the agent by.',
  },
  {
    title: 'Install the agent',
    body: 'The labs_agent role checks the repository out at /opt/hcw-labs-agent, runs npm ci --omit=dev, generates the certificate on the host (/etc/hcw/labs-agent.pem, root:hcw-labs-agent, 0640) and writes the systemd unit hcw-labs-agent.service with EnvironmentFile=/etc/hcw/labs-agent.env (root, 0600), holding LABS_AGENT_API_BASE, LABS_AGENT_TENANT_ID, LABS_AGENT_CLIENT_ID, LABS_AGENT_CERT_PATH, LABS_AGENT_API_SCOPE and LABS_AGENT_ID from the vault. There is no .env file: the unit reads the environment file, and the values never sit in the checkout.',
  },
  {
    title: 'Start the service',
    body: 'sudo systemctl enable --now hcw-labs-agent, then sudo journalctl -u hcw-labs-agent -n 50 --no-pager. The agent runs as the hcw-labs-agent user, calls this API with its certificate credential, and holds no database credential of any kind.',
  },
  {
    title: 'Run the smoke test',
    body: 'Within about 30 seconds the agent is Online on the Agents tab. Then on the Console tab pick shell-echo, payload "hello vps", and Submit: the job goes queued → claimed → succeeded with the payload echoed back. A lab’s own check runs the same way from Validate on the Catalogue tab.',
  },
]);

export default function SettingsTab() {
  return (
    <div className="space-y-6 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Provisioning a new agent, in order. On the lab host all of it is one run of
        lab-host/bootstrap.sh; the one hand step is Register agent on{' '}
        <a href={tabHref('agents')} className="underline">
          the Agents tab
        </a>
        , which is also where a disconnected agent is diagnosed.
      </p>

      <ol className="space-y-3 list-none p-0 m-0">
        {SETUP_STEPS.map((step, i) => (
          <li key={step.title}>
            <Card className="p-4">
              <div className="flex gap-3">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    <span className="sr-only">Step {i + 1}: </span>
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{step.body}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <p className="text-xs text-muted-foreground">
        Agent source and the role that installs it: <code>vps-agent/</code> and{' '}
        <code>lab-host/ansible/roles/labs_agent/</code> in the repository. The lab catalogue the
        public pages and the Catalogue tab read is <code>frontend/src/data/labs/catalogue.js</code>;
        a new lab is a row there plus one entry in the workspace template.
      </p>
    </div>
  );
}
