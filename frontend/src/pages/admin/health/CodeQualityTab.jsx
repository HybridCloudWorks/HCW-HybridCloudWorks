/**
 * The Health Hub's Code and Security tab (#569): Qlty's grades and open
 * issues for this repository, condensed.
 *
 * Every number comes from `GET cms/code-quality` (useCodeQuality). The route
 * returns counts, rule keys, levels, categories and paths — no finding text —
 * so a row links to Qlty's issues page for the detail rather than inventing
 * any here. Qlty's per-issue URLs are not in the answer.
 */

import React from 'react';
import { Link } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TabError, TabLoading } from '@/components/admin/integrations/TabNotice';
import { AlertTriangle, ExternalLink, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';

import { LEVELS, categoryRows, readTiles, safeHref, truncatedNote } from './codeQuality';

const LEVEL_TONE = {
  high: 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-400',
  medium: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400',
  low: 'border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-400',
  note: 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400',
  fmt: 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400',
};

const GRADE_TONE = {
  A: 'text-emerald-600 dark:text-emerald-400',
  B: 'text-lime-600 dark:text-lime-400',
  C: 'text-amber-600 dark:text-amber-400',
  D: 'text-orange-600 dark:text-orange-400',
  F: 'text-rose-600 dark:text-rose-400',
};

function LevelBadge({ level }) {
  return (
    <Badge variant="outline" className={LEVEL_TONE[level] ?? LEVEL_TONE.note}>
      {level || 'unknown'}
    </Badge>
  );
}

function ExternalAnchor({ href, children, className = '' }) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${className}`}
    >
      {children}
    </a>
  );
}

function Header({ code }) {
  const busy = code.loading || code.refreshing;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        Qlty’s grades and open issues for this repository, read server-side and cached for ten
        minutes. Counts, rules and paths only; the findings themselves live on Qlty.
      </p>
      <Button variant="outline" size="sm" onClick={code.refresh} disabled={busy}>
        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
      </Button>
    </div>
  );
}

function NotConfigured({ body }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 text-sm dark:border-amber-700/60 dark:bg-amber-950/20"
    >
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">Qlty is not configured.</p>
        <p className="text-muted-foreground">
          Add the Qlty access token on the{' '}
          <Link to="/admin/integrations?tab=keys" className="underline underline-offset-2">
            Integrations Keys tab
          </Link>
          , then press Refresh.
        </p>
        {safeHref(body.projectUrl) ? (
          <ExternalAnchor href={body.projectUrl} className="text-primary">
            Open the project on Qlty <ExternalLink className="h-3 w-3" />
          </ExternalAnchor>
        ) : null}
      </div>
    </div>
  );
}

function GradeTiles({ metrics }) {
  return (
    <div role="list" aria-label="Qlty grades" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {readTiles(metrics).map(({ label, grade, percent }) => (
        <div key={label} role="listitem" className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 flex items-baseline gap-2">
            {grade ? (
              <span className={`text-2xl font-bold ${GRADE_TONE[grade] ?? ''}`}>{grade}</span>
            ) : null}
            {percent ? (
              <span className={grade ? 'text-sm text-muted-foreground' : 'text-2xl font-bold'}>
                {percent}
              </span>
            ) : null}
            {!grade && !percent ? <span className="text-2xl text-muted-foreground">—</span> : null}
          </p>
        </div>
      ))}
    </div>
  );
}

function LevelCounts({ byLevel, label }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {LEVELS.map((level) => (
        <li key={level} className="flex items-center gap-1.5 text-sm">
          <LevelBadge level={level} />
          <span className="tabular-nums">{byLevel?.[level] ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

function StatCard({ title, total, children }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{total ?? 0}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function Totals({ data }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <StatCard title="Open issues" total={data.total}>
        <LevelCounts byLevel={data.byLevel} label="Open issues by level" />
        {data.unclassified > 0 ? (
          <p className="text-xs text-muted-foreground">Unclassified: {data.unclassified}</p>
        ) : null}
      </StatCard>
      <StatCard title="Security issues" total={data.security?.total}>
        <LevelCounts byLevel={data.security?.byLevel} label="Security issues by level" />
      </StatCard>
      <CategoryCard byCategory={data.byCategory} />
    </div>
  );
}

function CategoryCard({ byCategory }) {
  const rows = categoryRows(byCategory);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>By category</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <ul aria-label="Open issues by category" className="space-y-1 text-sm">
            {rows.map(({ name, count }) => (
              <li key={name} className="flex justify-between gap-4">
                <span className="truncate">{name}</span>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No open issues.</p>
        )}
      </CardContent>
    </Card>
  );
}

function TableCard({ title, label, headings, children }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table aria-label={label} className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {headings.map((heading) => (
                <th key={heading} scope="col" className="py-1 pr-3 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">{children}</tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const rowsOf = (list) => (Array.isArray(list) ? list : []);

function TopRules({ rows, href }) {
  return (
    <TableCard
      title="Top rules"
      label="Top rules"
      headings={['Tool', 'Rule', 'Category', 'Level', 'Count']}
    >
      {rowsOf(rows).map((row) => (
        <tr key={`${row.tool}:${row.rule}`}>
          <td className="py-1.5 pr-3 text-muted-foreground">{row.tool}</td>
          <td className="py-1.5 pr-3 font-mono text-xs">
            <ExternalAnchor href={href}>{row.rule}</ExternalAnchor>
          </td>
          <td className="py-1.5 pr-3">{row.category}</td>
          <td className="py-1.5 pr-3">
            <LevelBadge level={row.level} />
          </td>
          <td className="py-1.5 tabular-nums">{row.count}</td>
        </tr>
      ))}
    </TableCard>
  );
}

function TopFiles({ rows, href }) {
  return (
    <TableCard title="Top files" label="Top files" headings={['Path', 'Worst level', 'Count']}>
      {rowsOf(rows).map((row) => (
        <tr key={row.path}>
          <td className="max-w-[28rem] break-all py-1.5 pr-3 font-mono text-xs">
            <ExternalAnchor href={href}>{row.path}</ExternalAnchor>
          </td>
          <td className="py-1.5 pr-3">
            <LevelBadge level={row.level} />
          </td>
          <td className="py-1.5 tabular-nums">{row.count}</td>
        </tr>
      ))}
    </TableCard>
  );
}

function Provenance({ data }) {
  const note = truncatedNote(data.truncated);
  const asOf = data.fetchedAt || data.cachedAt;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {asOf ? <span>As of {new Date(asOf).toLocaleString()}</span> : null}
      <ExternalAnchor href={data.projectUrl} className="text-primary">
        <ShieldCheck className="h-3 w-3" /> Open on Qlty <ExternalLink className="h-3 w-3" />
      </ExternalAnchor>
      {note ? (
        <span role="note" className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" /> {note}
        </span>
      ) : null}
    </div>
  );
}

function Summary({ data }) {
  const href = safeHref(data.issuesUrl) || safeHref(data.projectUrl);
  return (
    <div className="space-y-4">
      <Provenance data={data} />
      <GradeTiles metrics={data.metrics} />
      <Totals data={data} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TopRules rows={data.topRules} href={href} />
        <TopFiles rows={data.topFiles} href={href} />
      </div>
    </div>
  );
}

function Body({ code }) {
  if (code.loading) return <TabLoading>Reading Qlty’s grades and open issues…</TabLoading>;
  if (code.error) return <TabError message={code.error} onRetry={code.refresh} />;
  if (code.notConfigured) return <NotConfigured body={code.notConfigured} />;
  if (code.data) return <Summary data={code.data} />;
  return null;
}

export default function CodeQualityTab({ code }) {
  return (
    <div className="space-y-4">
      <Header code={code} />
      <Body code={code} />
    </div>
  );
}
