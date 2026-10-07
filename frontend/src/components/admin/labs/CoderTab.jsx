/**
 * Coder — Coder's own dashboard, framed, for the operator (owner,
 * 2026-10-07).
 *
 * Coder's pages can only be reached inside a frame on this site: a
 * top-level visit is redirected to the labs page (the lab host's panes-only
 * rule, lab-host/ansible/roles/caddy/templates/Caddyfile.j2), and the lab
 * panes frame only the launcher, which since #925 starts a stopped
 * workspace rather than showing Coder's page. So the one Coder page an
 * operator could still reach — the create page of a lab with no workspace —
 * went away once every lab had one, and with it the way to Coder's Tokens
 * page that the status-token renewal starts from (lab-host/README.md, "The
 * status token for the site", step 1).
 *
 * This tab is that way back: Coder's dashboard in a frame, signed in as
 * the operator by Coder's own session cookie, with the pages the runbooks
 * send an operator to one click away. The frame has the lab pane's sandbox
 * and permissions, and the same sign-in link, because GitHub refuses to be
 * framed and sign-in therefore runs in a tab of its own, after which the
 * frame is reloaded. Nothing here talks to Coder's API itself: the frame
 * does, as Coder's own front end, with Coder's own CSRF token.
 */

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, LayoutDashboard, RefreshCw } from 'lucide-react';
import { CODER_ORIGIN, coderSignInUrl } from '@/data/labs/catalogue';
import { PANE_ALLOW, PANE_SANDBOX } from '@/pages/shared/LabPanePage';
import { safeUrl } from '@/lib/safeUrl';

/** The Coder pages an operator is sent to, in the order the runbooks name them. */
export const CODER_PAGES = Object.freeze([
  {
    id: 'workspaces',
    label: 'Workspaces',
    path: '/workspaces',
    why: 'Every workspace, its state, Start and Stop.',
  },
  {
    id: 'templates',
    label: 'Templates',
    path: '/templates',
    why: 'The hcw-lab template and its versions.',
  },
  {
    id: 'tokens',
    label: 'Your tokens',
    path: '/settings/tokens',
    why: 'Where the status-token renewal starts (hcw-setup).',
  },
  {
    id: 'users',
    label: 'Users',
    path: '/users',
    why: 'Learners who have signed in, and hcw-status.',
  },
  { id: 'audit', label: 'Audit log', path: '/audit', why: 'Who did what, in Coder.' },
]);

export const DEFAULT_CODER_PAGE = 'workspaces';

/** The full address of one of CODER_PAGES, by id; the default page for an unknown id. */
export function coderPageUrl(id) {
  const page = CODER_PAGES.find((candidate) => candidate.id === id) ?? CODER_PAGES[0];
  return `${CODER_ORIGIN}${page.path}`;
}

export default function CoderTab() {
  const [pageId, setPageId] = useState(DEFAULT_CODER_PAGE);
  // Bumped by Reload: a new key remounts the frame, which is a fresh load of
  // the same address, the way a browser reload is.
  const [generation, setGeneration] = useState(0);
  const page = CODER_PAGES.find((candidate) => candidate.id === pageId) ?? CODER_PAGES[0];
  const src = coderPageUrl(pageId);
  const signInHref = safeUrl(coderSignInUrl());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LayoutDashboard className="h-5 w-5" /> Coder
        </CardTitle>
        <CardDescription>
          Coder&apos;s own dashboard, signed in as you. Its pages open only inside the site, so this
          is where the runbooks&apos; Coder steps happen: renewing the status token starts on Your
          tokens. If the frame shows Coder&apos;s sign-in page, use Sign in with GitHub, which opens
          in a new tab, then Reload.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Coder page" className="flex flex-wrap gap-1.5">
            {CODER_PAGES.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={candidate.id === page.id}
                title={candidate.why}
                onClick={() => setPageId(candidate.id)}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  candidate.id === page.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <span className="ml-auto flex items-center gap-2">
            {signInHref ? (
              <Button asChild size="sm" variant="outline">
                <a href={signInHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Sign in with
                  GitHub
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setGeneration((n) => n + 1)}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Reload
            </Button>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{page.why}</p>
        <iframe
          key={`${page.id}-${generation}`}
          src={src}
          title={`Coder: ${page.label}`}
          sandbox={PANE_SANDBOX}
          allow={PANE_ALLOW}
          className="h-[75vh] w-full rounded-md border border-border bg-background"
        />
      </CardContent>
    </Card>
  );
}
