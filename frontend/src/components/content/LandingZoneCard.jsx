/**
 * The read-only landing zone card an article embed renders (#670, Phase 4 of
 * #657) — the lazy chunk behind LandingZoneEmbed.jsx. The same catalogue,
 * the same `decodeLz` and the same `layoutDiagram` as /tools/landing-zone;
 * what differs is that the build comes from the fence body rather than the
 * URL, the diagram is drawn without zoom and without buttons, and there is
 * nothing to change it with except the link to the tool.
 *
 * PRE-RENDER SAFE, more simply than the pricing card: there is no fetch. The
 * fence body decodes the same way on both sides, the layout is pure, and the
 * only generated id is React's own `useId`, which is stable across a server
 * render and its hydration. Whatever a hand-typed fence carries, `decodeLz`
 * never throws: unknown tokens are dropped, an option that fails its
 * validator is its default, and the result is normalised, so a fence naming
 * a firewall with no hub shows the hub too, the way the page would.
 */
import React, { useId, useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  COMPONENTS,
  countOptionFor,
  decodeLz,
  encodeLz,
  isSelected,
  layoutDiagram,
} from '@/lib/landingZone';
import { LzSvg } from '@/pages/tools/landingZone/LzSvg';

const TOOL_PATH = '/tools/landing-zone';

/**
 * The fence body as a normalised build. A leading `?` is tolerated, so the
 * query copied straight off the tool's address bar works as well as the bare
 * string; everything else is `decodeLz`'s tolerance.
 */
export function parseEmbedQuery(query) {
  const body = String(query ?? '')
    .trim()
    .replace(/^\?/, '');
  return decodeLz(new URLSearchParams(body));
}

/** The canonical URL for the same build in the tool: bare for the default build. */
export function landingZoneHref(state) {
  const query = new URLSearchParams(encodeLz(state)).toString();
  return `${TOOL_PATH}${query ? `?${query}` : ''}`;
}

/** One line about the knobs that matter for what is selected. */
export function summarize(state) {
  const { options } = state;
  const parts = [`Region ${options.location}`];
  if (options.rootParentId) parts.push(`under ${options.rootParentId}`);
  if (isSelected(state, 'connectivity-hub')) {
    parts.push(`Hub ${options.hubCidr}`);
    parts.push(options.privateDnsZones ? 'Private DNS zones' : 'No private DNS zones');
  }
  if (isSelected(state, 'firewall')) parts.push(`Firewall ${options.firewallSku}`);
  if (['identity', 'corp', 'online'].some((id) => isSelected(state, id))) {
    parts.push(`Spokes from ${options.spokeCidr}`);
  }
  return parts.join(' · ');
}

/** The selected components in catalogue order, with a count where one applies. */
function selectedComponents(state) {
  return COMPONENTS.filter((c) => isSelected(state, c.id)).map((c) => {
    const countId = countOptionFor(c.id);
    return { ...c, count: countId ? state.options[countId] : null };
  });
}

export default function LandingZoneCard({ query }) {
  const state = useMemo(() => parseEmbedQuery(query), [query]);
  const layout = useMemo(() => layoutDiagram(state), [state]);
  const titleId = useId();
  const selected = selectedComponents(state);
  const empty = layout.nodes.length === 0;

  return (
    <Card data-testid="landing-zone-card" data-selected={state.selected.join(',')}>
      <CardHeader>
        <CardTitle className="text-lg">
          {selected.length
            ? `Landing zone: ${selected.length} of ${COMPONENTS.length} components`
            : 'Landing zone: nothing selected'}
        </CardTitle>
        <CardDescription data-testid="landing-zone-summary">{summarize(state)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {empty ? (
          <p
            className="text-sm text-slate-600 dark:text-slate-400"
            data-testid="landing-zone-empty"
          >
            Nothing to draw: this build has no management groups, and every other component hangs
            from them.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
            <LzSvg layout={layout} interactive={false} titleId={titleId} />
          </div>
        )}
        {selected.length ? (
          <ul className="flex flex-col gap-1 text-sm" data-testid="landing-zone-components">
            {selected.map((c) => (
              <li key={c.id} data-component={c.id}>
                <span className="font-medium text-slate-950 dark:text-white">
                  {c.label}
                  {c.count !== null && c.count > 1 ? ` × ${c.count}` : ''}
                </span>
                <span className="text-slate-600 dark:text-slate-400"> — {c.summary}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm">
          <a
            href={landingZoneHref(state)}
            className="inline-flex items-center gap-1 font-medium underline decoration-dotted underline-offset-2 hover:text-slate-950 dark:hover:text-white"
          >
            Open in the Landing Zone Builder
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
