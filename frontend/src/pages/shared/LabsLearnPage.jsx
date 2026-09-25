/**
 * `/education/labs` — the learner page for the browser labs (#681, Coder
 * Phase 3 of #659), and the page the Hybrid Lab (#656) and Docker (#658)
 * epics put their sections on.
 *
 * WHAT IS ON IT AND WHERE IT COMES FROM.
 *   - The lab cards are derived from `@/data/labs/catalogue` and nothing else;
 *     `catalogue.test.js` checks the data, this page only renders it.
 *   - "The Hybrid Lab right now" is `GET public/labs/estate` (#664) and
 *     "Coder status" is `GET public/labs/coder-status` (#680), both through
 *     `usePublicData`, both answering `{ configured: false }` honestly until
 *     the host and Coder exist. The cards render those as sentences.
 *   - "Run an agent against your landing zone" is `SandboxSection` (#676):
 *     static editorial — three steps, one `sbx run` line per shell, the
 *     first prompt and the recipe link — read from the Docker docs on
 *     2026-09-25 and carrying `live-check` because the `sbx` surface moves.
 *   - One section is still a slot: the article list (#677) lands later, in
 *     place, so the layout does not move under it.
 *
 * ROUTING. `/education/labs` is a static path declared beside `/education` in
 * App.jsx, so it outranks `/:provider/education` the same way — a static
 * first segment beats a parameter in React Router's ranking. It is in
 * `STANDALONE_ROUTES` of scripts/prerender-entry.jsx because the derivation
 * there never produces it, and `routes-are-complete.test.js` fails if it is
 * declared in one place and not the other.
 *
 * PRE-RENDER. The catalogue and the agent section are static, so the card
 * grid and the sandbox commands are in the built HTML; the two status cards
 * pre-render their loading sentence, which
 * is also what the browser shows until the API answers. Nothing on the page
 * reads the clock until data has arrived, so hydration matches.
 */
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router';
import SectionHeading from '@/components/education/SectionHeading';
import CoderStatusCard from '@/components/labs/CoderStatusCard';
import LabCard from '@/components/labs/LabCard';
import LabsEstateCard from '@/components/labs/LabsEstateCard';
import LabsSlot from '@/components/labs/LabsSlot';
import SandboxSection from '@/components/labs/SandboxSection';
import { CODER_ORIGIN, labs } from '@/data/labs/catalogue';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchCoderStatus, fetchLabsEstate } from '@/lib/publicApi';
import { staticRoutes } from '@/lib/routeFactory';

export const PAGE_TITLE = 'Browser labs';
const CANONICAL = `https://hybridcloudworks.com${staticRoutes.labs}`;

/** `usePublicData` keys; also what a pre-render seed would be keyed on. */
export const ESTATE_KEY = 'labs:estate';
export const CODER_STATUS_KEY = 'labs:coder-status';

/**
 * `usePublicData` starts with `data: null` and `loading: true`, and the cards
 * need to tell "nothing yet" from "the route answered 404" (also null). While
 * loading with no data the value is undefined; once the fetch settles, null
 * means what the fetcher meant by it.
 */
function settle({ data, loading }) {
  return loading && data === null ? undefined : data;
}

export default function LabsLearnPage() {
  const estateQuery = usePublicData(() => fetchLabsEstate(), ESTATE_KEY);
  const coderQuery = usePublicData(() => fetchCoderStatus(), CODER_STATUS_KEY);

  return (
    <>
      <Helmet>
        <title>{`${PAGE_TITLE} — Coder, Docker and the Hybrid Lab | Hybrid Cloud Works`}</title>
        <meta
          name="description"
          content="Hands-on labs you run in the browser through Coder or on your own machine with one docker run line: validate a Landing Zone Builder download, walk through terraform validate, and check an Ansible playbook — with the live state of the hybrid lab host beside them."
        />
        <link rel="canonical" href={CANONICAL} />
      </Helmet>

      <div className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-12">
        <header>
          <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            <Link to={staticRoutes.education} className="underline-offset-4 hover:underline">
              Learn any cloud
            </Link>{' '}
            <span aria-hidden="true">/</span> Labs
          </p>
          <h1 className="display-heading text-3xl sm:text-4xl text-slate-950 dark:text-white mb-3">
            {PAGE_TITLE}
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-3xl">
            Each lab below opens in VS Code in your browser with az, terraform, kubectl, helm and
            ansible already installed, or runs on your own machine from the same container image.
            Nothing here installs anything on your computer beyond Docker, and nothing you do in a
            lab can reach the production estate: the workspaces run on the Hybrid Lab host, a single
            VPS onboarded to Azure Arc, whose live state is further down this page.
          </p>
          <p className="text-slate-600 dark:text-slate-400 max-w-3xl mt-3">
            <strong className="text-slate-900 dark:text-slate-100">Open in Coder</strong> takes you
            to <span className="font-mono text-sm">{CODER_ORIGIN.replace('https://', '')}</span>,
            where you sign in with GitHub, approve the workspace Coder proposes, and land in the lab
            folder. Workspaces stop after an hour of inactivity and are limited to one CPU and two
            gigabytes of memory, so treat them as scratch space and keep anything you want in your
            own repository.
          </p>
        </header>

        <section aria-labelledby="labs-heading">
          <SectionHeading id="labs-heading">Pick a lab</SectionHeading>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0">
            {labs.map((lab) => (
              <LabCard key={lab.id} lab={lab} />
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabsEstateCard
            estate={settle(estateQuery)}
            loading={estateQuery.loading}
            error={estateQuery.error}
          />
          <CoderStatusCard
            status={settle(coderQuery)}
            loading={coderQuery.loading}
            error={coderQuery.error}
          />
        </div>

        <LabsSlot id="agent" title="Run an agent against your landing zone" issue={676}>
          <SandboxSection />
        </LabsSlot>
        <LabsSlot id="articles" title="Articles for these labs" issue={677} />
      </div>
    </>
  );
}
