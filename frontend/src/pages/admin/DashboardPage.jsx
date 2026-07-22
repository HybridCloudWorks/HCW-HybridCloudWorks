import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Zap,
  ListChecks,
  PenLine,
  Newspaper,
  CheckCircle,
  Radio,
  RefreshCw,
  Loader2,
  Share2,
  Mic,
  ArrowRight,
  TrendingUp,
  Clock,
  FileText,
  Globe,
  BookOpen,
  Code2,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { postJSON } from '@/lib/api';

// ── Small helpers ─────────────────────────────────────────────────────────────

function pluralize(n, word) {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

function toDateMaybe(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value?.seconds !== undefined) return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function timeAgo(value) {
  const date = toDateMaybe(value);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** A quick-action hero button */
function QuickAction({ to, icon: Icon, label, description, color, count }) {
  return (
    <Link
      to={to}
      className={`relative flex flex-col gap-2 rounded-xl border p-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${color}`}
    >
      {count > 0 && (
        <span className="absolute top-3 right-3 min-w-5.5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center px-1.5 shadow">
          {count > 99 ? '99+' : count}
        </span>
      )}
      <div className="p-2 rounded-lg bg-white/60 dark:bg-black/20 w-fit">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </Link>
  );
}

/** A horizontal pipeline stage indicator */
function PipelineStage({ step, label, description, count, to, color, isLast }) {
  return (
    <>
      <Link
        to={to}
        className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-sm hover:-translate-y-0.5 ${color}`}
      >
        <span
          className="shrink-0 w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center shadow-sm"
          style={{ background: 'currentColor' }}
        >
          <span style={{ color: 'white' }}>{step}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">{label}</p>
          <p className="text-muted-foreground text-xs truncate">{description}</p>
        </div>
        {count > 0 && (
          <span className="shrink-0 min-w-5.5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center px-1.5">
            {count}
          </span>
        )}
      </Link>
      {!isLast && (
        <ChevronRight className="hidden lg:block shrink-0 h-4 w-4 text-muted-foreground/40" />
      )}
    </>
  );
}

/** Compact content row for activity lists */
function ContentRow({ item }) {
  const title = item.Title || item.title || item.sourceUrl || 'Untitled';
  const provider = item['Cloud Provider'] || item.cloudProvider || '';
  const status = item.contentStatus || 'ingested';
  const ago = timeAgo(item.updatedAt || item.createdAt || item.fetchedAt);

  return (
    <Link
      to={`/admin/queue/${item.id}`}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">
          {[item.type || 'blog', provider].filter(Boolean).join(' · ')}
          {ago && <span className="ml-2 opacity-60">{ago}</span>}
        </p>
      </div>
      <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
        {status.replace(/_/g, ' ')}
      </Badge>
    </Link>
  );
}

/** Section wrapper with title and optional "View all" link */
function Section({ title, icon: Icon, iconColor, to, children, action }) {
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          {title}
        </CardTitle>
        {(to || action) && (
          <Link
            to={to}
            onClick={action}
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DashboardHeader({
  today,
  queueCount,
  totalPublished,
  editorCount,
  rejectedCount,
  loadError,
  recalculating,
  onRecalculate,
  onNewContent,
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
          {today}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          {queueCount > 0
            ? `${pluralize(queueCount, 'item')} waiting for you`
            : "You're all caught up 🎉"}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {totalPublished} pieces live · {editorCount} in editor
          {rejectedCount > 0 && ` · ${rejectedCount} rejected`}
        </p>
        {loadError && (
          <p className="text-sm text-destructive flex items-center gap-1.5 mt-2">
            <AlertCircle className="h-3.5 w-3.5" /> {loadError}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={onRecalculate} disabled={recalculating}>
          {recalculating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          {recalculating ? 'Refreshing…' : 'Refresh'}
        </Button>
        <Button size="sm" onClick={onNewContent}>
          <Zap className="h-3.5 w-3.5 mr-1.5" />
          New Content
        </Button>
      </div>
    </div>
  );
}

function DashboardQuickActions({ queueCount, editorCount }) {
  const actions = [
    {
      to: '/admin/submit',
      icon: Zap,
      label: 'New Content',
      description: 'Import or create',
      color:
        'border-sky-200 bg-sky-50/60 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300',
    },
    {
      to: '/admin/queue',
      icon: ListChecks,
      label: 'Review Queue',
      description: 'Triage incoming',
      count: queueCount,
      color:
        'border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
    },
    {
      to: '/admin/editor',
      icon: PenLine,
      label: 'Editor',
      description: 'Polish drafts',
      count: editorCount,
      color:
        'border-violet-200 bg-violet-50/60 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300',
    },
    {
      to: '/admin/published',
      icon: Newspaper,
      label: 'Publish',
      description: 'Push content live',
      color:
        'border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
    },
    {
      to: '/admin/social',
      icon: Share2,
      label: 'Social Hub',
      description: 'Schedule & share',
      color:
        'border-pink-200 bg-pink-50/60 text-pink-700 dark:border-pink-900 dark:bg-pink-950/30 dark:text-pink-300',
    },
    {
      to: '/admin/recordings',
      icon: Radio,
      label: 'Recordings Hub',
      description: 'Plaud → content',
      color:
        'border-indigo-200 bg-indigo-50/60 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {actions.map((action) => (
        <QuickAction key={action.to} {...action} />
      ))}
    </div>
  );
}

function DashboardPipeline({ queueCount, editorCount }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          ContentForge Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2">
          <PipelineStage
            step={1}
            label="New Content"
            description="Create or import"
            to="/admin/submit"
            color="border-sky-200 bg-sky-50/40 text-sky-700 dark:border-sky-900 dark:bg-sky-950/20"
          />
          <PipelineStage
            step={2}
            label="Review Queue"
            description="Triage & inspect"
            count={queueCount}
            to="/admin/queue"
            color="border-amber-200 bg-amber-50/40 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20"
          />
          <PipelineStage
            step={3}
            label="Editor"
            description="Refine drafts"
            count={editorCount}
            to="/admin/editor"
            color="border-violet-200 bg-violet-50/40 text-violet-700 dark:border-violet-900 dark:bg-violet-950/20"
          />
          <PipelineStage
            step={4}
            label="Publish"
            description="Go live"
            to="/admin/published"
            color="border-emerald-200 bg-emerald-50/40 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20"
            isLast
          />
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardStats({ blog, news, arch, fw, cc, rejectedCount }) {
  const cards = [
    {
      label: 'Blogs',
      icon: FileText,
      count: (blog.total || 0) + (news.total || 0),
      to: '/admin/queue?contentType=blog',
      color: 'text-blue-500',
    },
    {
      label: 'Architecture',
      icon: Globe,
      count: arch.total || 0,
      to: '/admin/queue?contentType=architecture',
      color: 'text-purple-500',
    },
    {
      label: 'Frameworks',
      icon: BookOpen,
      count: fw.total || 0,
      to: '/admin/frameworks',
      color: 'text-sky-500',
    },
    {
      label: 'Coder Corner',
      icon: Code2,
      count: cc.total || 0,
      to: '/admin/coder-corner',
      color: 'text-amber-500',
    },
    {
      label: 'Rejected',
      icon: AlertCircle,
      count: rejectedCount,
      to: '/admin/queue?status=rejected',
      color: 'text-destructive',
      note: rejectedCount > 0 ? 'Auto-deletes in 24h' : null,
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
            <Icon className={`h-4 w-4 ${color}`} />
            <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
          </div>
          <p className="text-2xl font-bold mt-1">{count}</p>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          {note && <p className="text-[10px] text-destructive/70">{note}</p>}
        </Link>
      ))}
    </div>
  );
}

function DashboardSidebar() {
  return (
    <div className="space-y-4">
      <Card className="border-pink-200/50 dark:border-pink-900/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Share2 className="h-4 w-4 text-pink-500" />
            Social Hub
            <Badge
              variant="outline"
              className="ml-auto text-[9px] font-semibold tracking-wide border-pink-300 text-pink-600 dark:border-pink-700 dark:text-pink-400"
            >
              Publer
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Schedule published content to LinkedIn, X, and more directly from the Social Hub.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/admin/social"
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-900 text-pink-700 dark:text-pink-300 text-xs font-semibold hover:bg-pink-100 dark:hover:bg-pink-950/50 transition-colors"
            >
              <Share2 className="h-3 w-3" />
              Schedule
            </Link>
            <Link
              to="/admin/social?tab=queue"
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted border border-border text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors"
            >
              <Clock className="h-3 w-3" />
              Queue
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card className="border-indigo-200/50 dark:border-indigo-900/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4 text-indigo-500" />
            Recordings
            <Badge
              variant="outline"
              className="ml-auto text-[9px] font-semibold tracking-wide border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400"
            >
              Plaud
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Turn Plaud recordings into articles, social posts, or podcast notes with one click.
          </p>
          <Link
            to="/admin/recordings"
            className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors"
          >
            <Radio className="h-3 w-3" />
            Open Recordings
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mic className="h-4 w-4 text-teal-500" />
            Speaking Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            to="/admin/speaking-events"
            className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-muted border border-border text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors"
          >
            Manage Events
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardNeedsReview({ recentNeedsReview }) {
  return (
    <Section title="Needs Review" icon={ListChecks} iconColor="text-amber-500" to="/admin/queue">
      {recentNeedsReview.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
          <CheckCircle className="h-8 w-8 text-emerald-400" />
          <p className="text-sm font-medium">Nothing in the queue</p>
          <p className="text-xs">All caught up! New content will appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {recentNeedsReview.slice(0, 8).map((item) => (
            <ContentRow key={item.id} item={item} />
          ))}
          {recentNeedsReview.length > 8 && (
            <Link
              to="/admin/queue"
              className="flex items-center justify-center gap-1 pt-3 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              +{recentNeedsReview.length - 8} more <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </Section>
  );
}

function DashboardView({
  today,
  queueCount,
  totalPublished,
  editorCount,
  rejectedCount,
  loadError,
  recalculating,
  onRecalculate,
  onNewContent,
  blog,
  news,
  arch,
  fw,
  cc,
  recentNeedsReview,
}) {
  return (
    <div className="space-y-8">
      <DashboardHeader
        today={today}
        queueCount={queueCount}
        totalPublished={totalPublished}
        editorCount={editorCount}
        rejectedCount={rejectedCount}
        loadError={loadError}
        recalculating={recalculating}
        onRecalculate={onRecalculate}
        onNewContent={onNewContent}
      />
      <DashboardQuickActions queueCount={queueCount} editorCount={editorCount} />
      <DashboardPipeline queueCount={queueCount} editorCount={editorCount} />
      <DashboardStats
        blog={blog}
        news={news}
        arch={arch}
        fw={fw}
        cc={cc}
        rejectedCount={rejectedCount}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DashboardNeedsReview recentNeedsReview={recentNeedsReview} />
        </div>
        <DashboardSidebar />
      </div>
    </div>
  );
}

function getDashboardCounts(blog, news, arch, fw, cc) {
  return {
    queueCount:
      (blog.needsReview || 0) +
      (news.needsReview || 0) +
      (arch.needsReview || 0) +
      (fw.needsReview || 0) +
      (cc.needsReview || 0),
    editorCount:
      (blog.inProgress || 0) + (arch.inProgress || 0) + (fw.inProgress || 0) + (cc.inProgress || 0),
    totalPublished:
      (blog.published || 0) + (arch.published || 0) + (fw.published || 0) + (cc.published || 0),
  };
}

function getDashboardData(snapshot) {
  const stats = snapshot?.stats || {};
  const blog = stats.blog || {};
  const news = stats.news || {};
  const arch = stats.architecture || {};
  const fw = stats.framework || {};
  const cc = stats.coder_corner || {};
  const counts = getDashboardCounts(blog, news, arch, fw, cc);

  return {
    stats,
    blog,
    news,
    arch,
    fw,
    cc,
    queueCount: counts.queueCount,
    editorCount: counts.editorCount,
    totalPublished: counts.totalPublished,
    rejectedCount: stats.rejected || 0,
  };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { authReady } = useAuthReady();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const result = await postJSON('getAdminDashboardSnapshot', {});
        if (!cancelled) setSnapshot(result);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Failed to load dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      await postJSON('recalculateDashboardStats', {});
      const result = await postJSON('getAdminDashboardSnapshot', {});
      setSnapshot(result);
    } catch (err) {
      setLoadError(err.message || 'Failed to recalculate.');
    } finally {
      setRecalculating(false);
    }
  };

  const { blog, news, arch, fw, cc, queueCount, editorCount, totalPublished, rejectedCount } =
    getDashboardData(snapshot);
  const recentNeedsReview = useMemo(() => snapshot?.recentNeedsReview || [], [snapshot]);

  // ── Today's date heading ────────────────────────────────────────────────────
  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardView
      today={today}
      queueCount={queueCount}
      totalPublished={totalPublished}
      editorCount={editorCount}
      rejectedCount={rejectedCount}
      loadError={loadError}
      recalculating={recalculating}
      onRecalculate={handleRecalculate}
      onNewContent={() => navigate('/admin/submit')}
      blog={blog}
      news={news}
      arch={arch}
      fw={fw}
      cc={cc}
      recentNeedsReview={recentNeedsReview}
    />
  );
}
