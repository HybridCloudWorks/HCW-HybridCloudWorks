/**
 * Dashboard — orientation for whoever opens ContentForge (ADR 0033 §1 Home).
 *
 * One pipeline graphic, not two. The quick-action row and the "ContentForge
 * Pipeline" card showed the same four stages with the same counts; the card
 * stays because it is the one that reads as a flow, and it gains the two
 * stages the sidebar already had — Drafts before the queue, Live Pages after
 * publish — so the picture and the menu agree.
 *
 * Below it: what needs a decision, the count by content type, and an
 * "Explore" strip that introduces each group of the menu in one sentence,
 * for a user who has never seen the product.
 */
import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Zap,
  RefreshCw,
  Loader2,
  TrendingUp,
  FileText,
  Globe,
  BookOpen,
  Code2,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import useDashboardCounts from '@/hooks/useDashboardCounts';
import { NAV_GROUPS } from '@/config/adminNav';
import DecisionCenter from '@/components/admin/dashboard/DecisionCenter';

// ── Small helpers ─────────────────────────────────────────────────────────────

function pluralize(n, word) {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

// ── The pipeline ──────────────────────────────────────────────────────────────

/**
 * The stages, in order, each pointing at the page where that stage is worked.
 * `countKey` names the badge from useDashboardCounts; a stage without one
 * shows no number rather than an invented one.
 */
export const PIPELINE_STAGES = Object.freeze([
  {
    id: 'new',
    label: 'New Content',
    description: 'Import or start',
    to: '/admin/submit',
    color:
      'border-sky-200 bg-sky-50/40 text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-300',
  },
  {
    id: 'drafts',
    label: 'Drafts',
    description: 'Still being written',
    to: '/admin/drafts',
    color:
      'border-slate-200 bg-slate-50/40 text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-300',
  },
  {
    id: 'review',
    label: 'Review Queue',
    description: 'Decide: approve or reject',
    to: '/admin/queue',
    countKey: 'queue',
    color:
      'border-amber-200 bg-amber-50/40 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300',
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Polish approved drafts',
    to: '/admin/editor',
    countKey: 'editor',
    color:
      'border-violet-200 bg-violet-50/40 text-violet-700 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-300',
  },
  {
    id: 'publish',
    label: 'Publish',
    description: 'Go live, now or scheduled',
    to: '/admin/published',
    color:
      'border-emerald-200 bg-emerald-50/40 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300',
  },
  {
    id: 'live',
    label: 'Live Pages',
    description: 'What visitors see',
    to: '/admin/live-pages',
    countKey: 'live',
    color:
      'border-teal-200 bg-teal-50/40 text-teal-700 dark:border-teal-900 dark:bg-teal-950/20 dark:text-teal-300',
  },
]);

function PipelineStage({ step, stage, count, isLast }) {
  return (
    <>
      <Link
        to={stage.to}
        className={`flex-1 min-w-38 flex items-center gap-3 px-3 py-3 rounded-xl border transition-all hover:shadow-sm hover:-translate-y-0.5 ${stage.color}`}
        aria-label={`${stage.label}: ${stage.description}${count ? `, ${count} items` : ''}`}
      >
        <span
          className="shrink-0 w-7 h-7 rounded-full border border-current text-xs font-bold flex items-center justify-center"
          aria-hidden="true"
        >
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">{stage.label}</p>
          <p className="text-muted-foreground text-xs truncate">{stage.description}</p>
        </div>
        {count > 0 && (
          <span className="shrink-0 min-w-5.5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center px-1.5">
            {count > 999 ? '999+' : count}
          </span>
        )}
      </Link>
      {!isLast && (
        <ChevronRight
          className="hidden xl:block shrink-0 h-4 w-4 text-muted-foreground/40"
          aria-hidden="true"
        />
      )}
    </>
  );
}

function DashboardPipeline({ counts }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
          The pipeline
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every piece of content moves left to right. A number is how many items are waiting at that
          stage; open a stage to work it.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap xl:flex-nowrap items-center gap-2">
          {PIPELINE_STAGES.map((stage, index) => (
            <PipelineStage
              key={stage.id}
              step={index + 1}
              stage={stage}
              count={stage.countKey ? counts[stage.countKey] : 0}
              isLast={index === PIPELINE_STAGES.length - 1}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

function DashboardHeader({ today, counts, loadError, recalculating, onRecalculate, onNewContent }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
          {today}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          {counts.queue > 0
            ? `${pluralize(counts.queue, 'item')} waiting for you`
            : "You're all caught up 🎉"}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {counts.live} pieces live · {counts.editor} in editor
          {counts.rejected > 0 && ` · ${counts.rejected} rejected`}
        </p>
        {loadError && (
          <p className="text-sm text-destructive flex items-center gap-1.5 mt-2" role="alert">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {loadError}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onRecalculate}
          disabled={recalculating}
          title="Recount every item from the content store. Use it when a number here looks wrong."
        >
          {recalculating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          )}
          {recalculating ? 'Recounting…' : 'Recount'}
        </Button>
        <Button size="sm" onClick={onNewContent}>
          <Zap className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          New Content
        </Button>
      </div>
    </div>
  );
}

function DashboardStats({ counts }) {
  const t = counts.byType;
  const cards = [
    {
      label: 'Blogs',
      icon: FileText,
      count: (t.blog?.total || 0) + (t.news?.total || 0),
      to: '/admin/queue?contentType=blog',
      color: 'text-blue-500',
    },
    {
      label: 'Architecture',
      icon: Globe,
      count: t.architecture?.total || 0,
      to: '/admin/queue?contentType=architecture',
      color: 'text-purple-500',
    },
    {
      label: 'Frameworks',
      icon: BookOpen,
      count: t.framework?.total || 0,
      to: '/admin/frameworks',
      color: 'text-sky-500',
    },
    {
      label: 'Coder Corner',
      icon: Code2,
      count: t.coder_corner?.total || 0,
      to: '/admin/coder-corner',
      color: 'text-amber-500',
    },
    {
      label: 'Rejected',
      icon: AlertCircle,
      count: counts.rejected,
      to: '/admin/queue?status=rejected',
      color: 'text-destructive',
      note: counts.rejected > 0 ? 'Auto-deletes in 24h' : null,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {cards.map(({ label, icon: Icon, count, to, color, note }) => (
        <Link
          key={label}
          to={to}
          className="flex flex-col gap-1 p-4 border rounded-xl hover:bg-muted/50 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <Icon className={`h-4 w-4 ${color}`} aria-hidden="true" />
            <ChevronRight
              className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors"
              aria-hidden="true"
            />
          </div>
          <p className="text-2xl font-bold mt-1">{count}</p>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          {note && <p className="text-[10px] text-destructive/70">{note}</p>}
        </Link>
      ))}
    </div>
  );
}

/**
 * One card per menu group after Home, each carrying the registry's sentence
 * and its items — the whole product explained on the first screen.
 */
function DashboardExplore() {
  const groups = NAV_GROUPS.filter((group) => group.id !== 'home');
  return (
    <section aria-labelledby="explore-heading" className="space-y-3">
      <div>
        <h2 id="explore-heading" className="text-base font-semibold">
          Explore ContentForge
        </h2>
        <p className="text-xs text-muted-foreground">
          What each part of the menu is for. Hover any menu item for the same sentence.
        </p>
      </div>
      {/* `grid-cols-1`, not the implicit column (AP-F1). An implicit track is
          sized to its content, and each item's one-line, truncated description
          made that the full sentence: on a Pixel 5 the cards were 675 px wide
          in a 393 px column and the dashboard scrolled sideways. An explicit
          column is `minmax(0, 1fr)`, so the description truncates as meant.
          e2e/admin-authenticated.spec.js holds the line on a phone. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <Card key={group.id} className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
                {group.label}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60 transition-colors"
                        title={item.description}
                      >
                        <Icon
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="font-medium">{item.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { authReady } = useAuthReady();
  const navigate = useNavigate();
  const { snapshot, counts, loading, error, recalculate } = useDashboardCounts({
    enabled: authReady,
    refetchOnNavigate: false,
  });
  const [recalculating, setRecalculating] = React.useState(false);
  const [recalcError, setRecalcError] = React.useState('');

  const handleRecalculate = async () => {
    setRecalculating(true);
    setRecalcError('');
    try {
      await recalculate();
    } catch (err) {
      setRecalcError(err?.message || 'Failed to recalculate.');
    } finally {
      setRecalculating(false);
    }
  };

  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <DashboardHeader
        today={today}
        counts={counts}
        loadError={error || recalcError}
        recalculating={recalculating}
        onRecalculate={handleRecalculate}
        onNewContent={() => navigate('/admin/submit')}
      />
      <DashboardPipeline counts={counts} />
      <DashboardStats counts={counts} />
      <DecisionCenter enabled={authReady} />
      <DashboardExplore />
    </div>
  );
}
