/**
 * `/education` — the front door the Learn section never had.
 *
 * Until this page existed, `routes.education(provider)` was reachable only
 * from inside a provider's own header, so a learner had to pick a cloud
 * before they could see what learning that cloud involved. Two people were
 * served by nothing: the beginner who does not yet know which cloud to learn,
 * and the practitioner who already knows one and is moving to another.
 *
 * EVERYTHING HERE IS DERIVED. No certification, level, count or date is typed
 * into this file. The eight catalogues under `src/data/` are imported whole,
 * statuses come from `@/lib/certStatus` at render time, and the freshness line
 * is the same `CatalogueFreshness` the provider hubs use. The only hand-written
 * values are the four tier names, the vendor level-words that map onto them
 * (LEVEL_TIERS below), and the provider display names — and `LEVEL_TIERS` is
 * covered by a test that walks every catalogue, so a vendor inventing a new
 * level word fails the suite rather than dropping a row off the table.
 *
 * WHY A TIER TABLE AND NOT A CERT-TO-CERT MAP. The eight catalogues spell
 * their levels twelve different ways — `Fundamentals`, `Foundational`,
 * `Foundations` and `Practitioner` all mean "start here" — so the columns
 * cannot be compared until the words are folded together. Folding level words
 * is reading the data; claiming that AZ-104 *is* SOA-C03 would be writing new
 * data, and this page does not do that. It puts both in the Associate row and
 * lets the reader draw the line.
 *
 * ONE `useToday` FOR THE WHOLE PAGE. The provider hubs each pass their own
 * `DATA_AS_OF`; this page spans eight of them and must pick one server
 * snapshot, or the pre-rendered HTML and the hydrating render could disagree.
 * It uses the EARLIEST `DATA_AS_OF` across the eight — the most conservative
 * choice, since no catalogue is then aged past the day a person last checked
 * it. After hydration `useToday` moves to the viewer's real date, exactly as
 * it does on every other Learn page. See the header of `@/lib/certStatus`.
 */
import React, { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router';
import CatalogueFreshness from '@/components/education/CatalogueFreshness';
import { deriveStatus, isIsoDate, useToday } from '@/lib/certStatus';
import { routes } from '@/lib/routeFactory';

import * as ansible from '@/data/ansible/education';
import * as aws from '@/data/aws/certifications';
import * as azure from '@/data/azure/certifications';
import * as finops from '@/data/finops/education';
import * as gcp from '@/data/gcp/certifications';
import * as hub from '@/data/github/certifications';
import * as terraform from '@/data/terraform/certifications';
import * as vmware from '@/data/vmware/education';

/**
 * `src/data/azure/certifications.js` is the one catalogue that exports no
 * `DATA_SOURCE` — the other seven do, and `education-catalogues.test.js`
 * asserts it for those seven only. Its file header names the page it is
 * hand-synced against, so that is what stands in here. `??` rather than a
 * replacement: the day the catalogue grows its own `DATA_SOURCE`, that one
 * wins and this constant stops being reached.
 */
const AZURE_SOURCE_FALLBACK = Object.freeze({
  label: 'Microsoft Learn credentials',
  url: 'https://learn.microsoft.com/en-us/credentials/browse/?credential_types=certification',
});

/**
 * The eight catalogues, in the order `VALID_PROVIDERS` lists them so this page
 * and the router agree. `name` matches `displayName` in ProviderContext; it is
 * repeated rather than imported because `useProviderConfig` reads the provider
 * from route context, and this page is outside any provider's route.
 */
export const PROVIDER_CATALOGUES = Object.freeze([
  { provider: 'azure', name: 'Microsoft Azure', catalogue: azure },
  { provider: 'aws', name: 'Amazon Web Services', catalogue: aws },
  { provider: 'gcp', name: 'Google Cloud', catalogue: gcp },
  { provider: 'github', name: 'GitHub', catalogue: hub },
  { provider: 'terraform', name: 'HashiCorp Terraform', catalogue: terraform },
  { provider: 'finops', name: 'FinOps Foundation', catalogue: finops },
  { provider: 'vmware', name: 'VMware by Broadcom', catalogue: vmware },
  { provider: 'ansible', name: 'Red Hat Ansible', catalogue: ansible },
]);

/**
 * The four tiers, lowest first, and every vendor level-word that lands on each.
 *
 * `levels` is the whole reason the table can have columns: AWS writes
 * `Foundational`, Azure writes `Fundamentals`, GitHub writes `Foundations` and
 * the FinOps Foundation writes `Practitioner`, and all four are the exam a
 * person with no prerequisites sits first.
 *
 * Two foldings are worth knowing about because they lose a distinction the
 * vendor draws:
 *   - `Advanced` folds into Professional. For VMware that puts VCP
 *     (Professional) and VCAP (Advanced) in one cell, which is two vendor
 *     tiers in one row. Splitting them would need a fifth tier that six of
 *     the eight catalogues have nothing to put in.
 *   - `Business` folds into Specialty. AWS uses it for exactly one exam
 *     (AIB-C01, the AI Business Strategist); it is a role cut, not a rung.
 *
 * `educationLevelsAreMapped` in the test walks all eight catalogues against
 * this table, so a level word added to the data fails there rather than
 * vanishing from the page.
 */
export const LEVEL_TIERS = Object.freeze([
  {
    tier: 'Foundational',
    summary: 'No prerequisites. Vocabulary, billing and the shape of the platform.',
    levels: ['Foundational', 'Fundamentals', 'Foundations', 'Practitioner'],
  },
  {
    tier: 'Associate',
    summary: 'The first working credential — build and run things day to day.',
    levels: ['Associate'],
  },
  {
    tier: 'Professional',
    summary: 'Design and operate at scale. Most vendors expect hands-on time first.',
    levels: ['Professional', 'Expert', 'Advanced'],
  },
  {
    tier: 'Specialty',
    summary: 'One domain, deeply — networking, security, a workload or a role.',
    levels: ['Specialty', 'Specialist', 'Business'],
  },
]);

/**
 * Statuses that mean "you can book this exam today", in the order a reader
 * should meet them. `expiring` is here on purpose: a published retirement date
 * does not close the exam, and leaving those rows out would have hidden seven
 * exams that can still be sat (AWS DVA-C02 and SAP-C02 among them).
 *
 * The map's value is the word printed beside the code, or null when the row
 * needs no qualifier. A word rather than a colour, so nothing on this page is
 * signalled by colour alone.
 */
export const AVAILABLE_STATUS_WORD = Object.freeze({
  active: null,
  expiring: 'retiring',
  beta: 'beta',
});

/** At most this many codes in one table cell before the rest become a link. */
const CELL_LIMIT = 6;

/** The tier a vendor level-word belongs to, or null when nothing claims it. */
export function tierForLevel(level) {
  const found = LEVEL_TIERS.find((row) => row.levels.includes(level));
  return found ? found.tier : null;
}

/**
 * The rows of a catalogue a person could book today, `featured` first and
 * otherwise in catalogue order. Stable: `sort` is only ever asked about the
 * featured flag, so equal rows keep the order the maintainer put them in.
 */
export function availableCertifications(certifications = [], today) {
  return [...certifications]
    .filter((cert) => AVAILABLE_STATUS_WORD[deriveStatus(cert, today)] !== undefined)
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
}

/** How many rows sit at each derived status, for the line under a tile. */
export function countByStatus(certifications = [], today) {
  const counts = {};
  for (const cert of certifications) {
    const status = deriveStatus(cert, today);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

/**
 * The exam a newcomer to this provider sits first: the first bookable row at
 * the lowest tier the catalogue actually has. Derived, not chosen — Terraform
 * and FinOps have no Foundational row at all, so their entry point is the
 * lowest rung they do publish (Associate and Practitioner respectively).
 */
export function entryCertification(available = []) {
  for (const { tier } of LEVEL_TIERS) {
    const first = available.find((cert) => tierForLevel(cert.level) === tier);
    if (first) return { cert: first, tier };
  }
  return null;
}

/** Everything one provider tile and one table column needs, derived once. */
export function summarizeCatalogue({ provider, name, catalogue }, today) {
  const certifications = catalogue.certifications ?? [];
  const available = availableCertifications(certifications, today);
  return {
    provider,
    name,
    hubPath: routes.education(provider),
    asOf: catalogue.DATA_AS_OF,
    source: catalogue.DATA_SOURCE ?? (provider === 'azure' ? AZURE_SOURCE_FALLBACK : null),
    total: certifications.length,
    available,
    counts: countByStatus(certifications, today),
    entry: entryCertification(available),
  };
}

/**
 * The equivalence table as data: one row per tier, one cell per provider.
 *
 * A cell carries EVERY bookable certification at that tier, split into the
 * ones shown outright and the ones folded into a `<details>`. Nothing is
 * dropped, and that split is why: Azure has 33 bookable Associate exams, and
 * the sixth of them in catalogue order is AB-731 — so a cell that simply
 * truncated at six would leave AZ-104 off the page, which is the one
 * comparison this table was built to make. The rest are in the DOM either way;
 * `<details>` only decides whether they take up room before you ask.
 *
 * A provider with nothing at a tier gets empty arrays, which the renderer
 * turns into an explicit empty cell — never a guess, never a borrowed
 * neighbour.
 */
export function buildEquivalenceRows(summaries) {
  return LEVEL_TIERS.map(({ tier, summary }) => ({
    tier,
    summary,
    cells: summaries.map((entry) => {
      const certs = entry.available.filter((cert) => tierForLevel(cert.level) === tier);
      return {
        provider: entry.provider,
        name: entry.name,
        hubPath: entry.hubPath,
        shown: certs.slice(0, CELL_LIMIT),
        rest: certs.slice(CELL_LIMIT),
        total: certs.length,
      };
    }),
  }));
}

/**
 * The earliest `DATA_AS_OF` of the eight, used as the one server snapshot for
 * `useToday`. Ignores a malformed value rather than letting it win a string
 * comparison, and returns undefined when nothing is usable — `useToday` then
 * falls back to its own fixed day, which still hydrates cleanly.
 */
export function earliestDataAsOf(catalogues = PROVIDER_CATALOGUES) {
  return catalogues
    .map(({ catalogue }) => catalogue.DATA_AS_OF)
    .filter(isIsoDate)
    .sort()[0];
}

/** `{ retired: 3, upcoming: 1 }` -> "1 coming · 3 retired", or '' when empty. */
function describeRest(counts) {
  const parts = [];
  if (counts.upcoming) parts.push(`${counts.upcoming} coming`);
  if (counts.retired) parts.push(`${counts.retired} retired`);
  return parts.join(' · ');
}

function CertChip({ cert, today }) {
  const word = AVAILABLE_STATUS_WORD[deriveStatus(cert, today)];
  return (
    <li className="flex items-baseline gap-1.5">
      <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
        {cert.code}
      </span>
      {word ? (
        <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {word}
        </span>
      ) : null}
      <span className="sr-only">{cert.title}</span>
    </li>
  );
}

function ProviderTile({ entry }) {
  const rest = describeRest(entry.counts);
  return (
    <li
      data-provider={entry.provider}
      className="glass glass-hover rounded-xl p-5 flex flex-col gap-3"
    >
      <h3 className="text-base font-bold text-slate-950 dark:text-white">
        <Link
          to={entry.hubPath}
          className="underline-offset-4 hover:underline focus-visible:underline"
        >
          {entry.name}
        </Link>
      </h3>

      <p className="flex items-baseline gap-2">
        <span
          data-testid="available-count"
          className="text-3xl font-black text-slate-950 dark:text-white"
        >
          {entry.available.length}
        </span>
        <span className="text-xs text-slate-600 dark:text-slate-400">
          certifications you can sit today
        </span>
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {entry.total} in the catalogue{rest ? ` · ${rest}` : ''}
      </p>

      {entry.entry ? (
        <p className="text-xs text-slate-700 dark:text-slate-300">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Start with
          </span>
          <span className="font-mono font-bold">{entry.entry.cert.code}</span>{' '}
          <span>{entry.entry.cert.title}</span>{' '}
          <span className="text-slate-500 dark:text-slate-400">({entry.entry.tier})</span>
        </p>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          No exam in this catalogue is open to sit today.
        </p>
      )}

      <CatalogueFreshness asOf={entry.asOf} source={entry.source} className="mt-auto pt-2" />
    </li>
  );
}

function EquivalenceCell({ cell, today }) {
  if (cell.total === 0) {
    return (
      <td
        data-provider={cell.provider}
        data-empty="true"
        className="align-top p-3 border-t border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
      >
        <span aria-hidden="true">—</span>
        <span className="sr-only">No {cell.name} certification at this level.</span>
      </td>
    );
  }
  return (
    <td
      data-provider={cell.provider}
      className="align-top p-3 border-t border-slate-200 dark:border-slate-700"
    >
      <ul className="flex flex-col gap-1">
        {cell.shown.map((cert) => (
          <CertChip key={cert.id || cert.code} cert={cert} today={today} />
        ))}
      </ul>
      {cell.rest.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-slate-600 dark:text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-950 dark:hover:text-white">
            {cell.rest.length} more
            <span className="sr-only"> {cell.name} certifications at this level</span>
          </summary>
          <ul className="flex flex-col gap-1 mt-1">
            {cell.rest.map((cert) => (
              <CertChip key={cert.id || cert.code} cert={cert} today={today} />
            ))}
          </ul>
        </details>
      ) : null}
    </td>
  );
}

export default function EducationIndexPage() {
  const today = useToday(earliestDataAsOf());
  const summaries = useMemo(
    () => PROVIDER_CATALOGUES.map((entry) => summarizeCatalogue(entry, today)),
    [today]
  );
  const rows = useMemo(() => buildEquivalenceRows(summaries), [summaries]);

  return (
    <>
      <Helmet>
        <title>Learn any cloud — certification index | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="Every certification track we follow, in one place: AWS, Azure, Google Cloud, GitHub, Terraform, FinOps, VMware and Ansible — with a level-by-level table that lines the eight catalogues up against each other."
        />
      </Helmet>

      <div className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-12">
        <header>
          <h1 className="display-heading text-3xl sm:text-4xl text-slate-950 dark:text-white mb-3">
            Learn any cloud
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-3xl">
            Eight certification catalogues, one page. If you have not picked a cloud yet, start with
            a provider tile and take the exam it names. If you already know one and are moving to
            another, the table below lines the eight up level by level, so the exam you already hold
            tells you which one to book next.
          </p>
        </header>

        <section aria-labelledby="providers-heading">
          <h2
            id="providers-heading"
            className="text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2 mb-6"
          >
            <span className="w-1 h-6 bg-primary rounded-full" aria-hidden="true"></span>
            Pick a cloud
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 list-none p-0">
            {summaries.map((entry) => (
              <ProviderTile key={entry.provider} entry={entry} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="equivalence-heading">
          <h2
            id="equivalence-heading"
            className="text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2 mb-2"
          >
            <span className="w-1 h-6 bg-primary rounded-full" aria-hidden="true"></span>
            The same rung on eight ladders
          </h2>
          <p className="text-slate-600 dark:text-slate-400 max-w-3xl mb-6">
            Rows are levels, columns are providers, and a cell holds that provider&rsquo;s exams at
            that level. The vendors do not agree on what to call a level — Fundamentals,
            Foundational, Foundations and Practitioner all mean the same rung — so the words are
            folded together here. An em dash means the provider publishes nothing at that level; it
            does not mean we could not find it.
          </p>

          {/*
            The table is wider than a phone and must stay that way — eight
            columns of exam codes do not usefully reflow. So it scrolls inside
            this container rather than making the page scroll sideways. Every
            column header is a link, which is what lets a keyboard user reach
            and scroll it without a tabindex on the region itself.
          */}
          <div
            role="region"
            aria-labelledby="equivalence-heading"
            className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"
          >
            <table className="w-full min-w-[64rem] border-collapse text-left">
              <caption className="sr-only">
                Certification levels across eight providers. Each row is a level; each column is a
                provider; each cell lists that provider&rsquo;s certifications at that level, or an
                em dash when it publishes none.
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-background p-3 text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 w-44"
                  >
                    Level
                  </th>
                  {summaries.map((entry) => (
                    <th
                      key={entry.provider}
                      scope="col"
                      className="p-3 text-sm font-bold text-slate-950 dark:text-white min-w-44"
                    >
                      <Link
                        to={entry.hubPath}
                        className="underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {entry.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tier} data-tier={row.tier}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-background align-top p-3 border-t border-slate-200 dark:border-slate-700"
                    >
                      <span className="block text-sm font-bold text-slate-950 dark:text-white">
                        {row.tier}
                      </span>
                      <span className="block text-[11px] font-normal text-slate-600 dark:text-slate-400">
                        {row.summary}
                      </span>
                    </th>
                    {row.cells.map((cell) => (
                      <EquivalenceCell key={cell.provider} cell={cell} today={today} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
