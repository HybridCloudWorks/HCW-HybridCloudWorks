/**
 * `/tools/landing-zone` — build an Azure landing zone component by component
 * and read the Terraform it becomes (#668, Phase 2 of epic #657).
 *
 * WHAT IT IS. A learner ticks components (management groups, policy,
 * management, the connectivity hub, the firewall, identity, N corp and N
 * online landing zones), turns the knobs (address spaces, firewall SKU,
 * region, counts), and three things follow: a hand-written explanation of
 * the focused component (landingZone/LzTeaches.jsx), an SVG of the tree
 * that redraws as the build changes (LzDiagram.jsx), and the generated
 * Terraform, one tab per file, downloadable as a zip (LzFiles.jsx). The
 * Terraform mirrors HashiCorp's validated pattern using the current Azure
 * Verified Modules, pinned in lib/landingZone/avmVersions.js.
 *
 * THE BUILD IS IN THE URL. `?lz=` and the option keys (lib/landingZone/
 * share.js) carry the whole state, so a landing zone is a link an article or
 * the newsletter can carry, and a bare URL is the full default build. The
 * only React state on the page is which component is focused, which is a
 * reading position rather than part of the build.
 *
 * PRE-RENDER AND HYDRATION. The route is built to a static file and hydrated
 * (scripts/prerender-entry.jsx). Everything on it is a pure function of the
 * URL and the catalogue: no fetch, no clock, no viewport, so the first client
 * render is the server markup and React adopts it. The default build carries
 * the management groups' teaches text and a dozen file tabs, which is well
 * past the prerender's 420-character floor for a real page.
 *
 * NOTHING HERE TOUCHES A TENANT. There is no Azure call anywhere on this
 * page; the emitted README says the same.
 */
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AVM_MODULES, AVM_VERIFIED_ON } from '@/lib/landingZone';
import { LzControls } from './landingZone/LzControls';
import { LzDiagram } from './landingZone/LzDiagram';
import { LzFiles } from './landingZone/LzFiles';
import { LzTeaches } from './landingZone/LzTeaches';
import { useLzState } from './landingZone/useLzState';

const PAGE_TITLE = 'Landing Zone Builder';
const CANONICAL_URL = 'https://hybridcloudworks.com/tools/landing-zone';
const PATTERN_URL =
  'https://developer.hashicorp.com/validated-patterns/terraform/build-azure-lz-with-terraform';
const DESCRIPTION =
  'Assemble an Azure landing zone component by component, read what each part is for, watch the diagram redraw, and download the Terraform it becomes, built on the Azure Verified Modules HashiCorp’s validated pattern uses.';

/** Where the teaches panel starts: the component every other one hangs from. */
const INITIAL_FOCUS = 'management-groups';

export default function LandingZonePage() {
  const [state, write] = useLzState();
  const [focusedId, setFocusedId] = useState(INITIAL_FOCUS);

  return (
    <>
      <Helmet>
        <title>{`${PAGE_TITLE} | Hybrid Cloud Works`}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={CANONICAL_URL} />
      </Helmet>

      <div className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-8">
        <header>
          <h1
            id="landing-zone-heading"
            className="display-heading text-3xl sm:text-4xl text-slate-950 dark:text-white mb-3"
          >
            {PAGE_TITLE}
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-3xl">
            Assemble an Azure landing zone one component at a time. Tick a component to add it and
            its dependencies come with it; untick one and everything that needs it leaves too. Each
            component explains what it is for and what breaks without it, the diagram redraws as you
            build, and the Terraform beneath mirrors HashiCorp&rsquo;s{' '}
            <a
              href={PATTERN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline decoration-dotted underline-offset-2"
            >
              validated pattern for an Azure landing zone
            </a>{' '}
            using the current Azure Verified Modules, pinned on {AVM_VERIFIED_ON}. The whole build
            is in this page&rsquo;s address, so a landing zone is a link you can send. Nothing here
            touches a tenant.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <LzControls state={state} write={write} focusedId={focusedId} onFocus={setFocusedId} />
          <div className="flex flex-col gap-8 min-w-0">
            <LzTeaches state={state} componentId={focusedId} />
            <LzDiagram state={state} focusedId={focusedId} onFocus={setFocusedId} />
          </div>
        </div>

        <LzFiles state={state} />

        <section aria-labelledby="landing-zone-modules" className="max-w-3xl">
          <h2
            id="landing-zone-modules"
            className="text-lg font-semibold text-slate-950 dark:text-white mb-2"
          >
            The modules behind the files
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
            Four Azure Verified Modules, each pinned to the latest release the Terraform Registry
            listed on {AVM_VERIFIED_ON}. The archived hub-networking pattern module is never
            emitted, and the application landing zone pattern module is not called because it had no
            published release on that date: a landing zone is a subscription placement plus a spoke
            from the virtual network module instead.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {Object.values(AVM_MODULES).map((mod) => (
              <li key={mod.name} className="flex flex-wrap gap-x-2">
                <a
                  href={mod.registry}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-primary underline decoration-dotted underline-offset-2"
                >
                  {mod.source}
                </a>
                <span className="text-slate-600 dark:text-slate-400">version {mod.version}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
