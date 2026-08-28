import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  ListChecks,
  Newspaper,
  Globe,
  Calendar,
  Image,
  Images,
  Activity,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  LogOut,
  PenLine,
  Mic,
  Share2,
  Radio,
  BookOpen,
  Code2,
  Zap,
  Bot,
  Award,
  Link2,
  Mail,
  Plug,
  FlaskConical,
  Flame,
  Headphones,
} from 'lucide-react';
import { signOutUser } from '@/lib/entraAuth';

// ── Nav Groups ────────────────────────────────────────────────────────────────
// Each group has a label, icon, and items. Items can have a badge key
// which maps to a live count from the snapshot API.

const NAV_GROUPS = [
  {
    label: 'Pipeline',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/admin/submit', icon: Zap, label: 'New Content' },
      { to: '/admin/queue', icon: ListChecks, label: 'Review Queue', badgeKey: 'queue' },
      { to: '/admin/editor', icon: PenLine, label: 'Editor', badgeKey: 'editor' },
      { to: '/admin/published', icon: Newspaper, label: 'Publish' },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/admin/frameworks', icon: BookOpen, label: 'Frameworks' },
      { to: '/admin/coder-corner', icon: Code2, label: 'Coder Corner' },
      { to: '/admin/live-pages', icon: Globe, label: 'Live Pages' },
    ],
  },
  {
    label: 'Creative',
    items: [
      { to: '/admin/forge-studio', icon: Flame, label: 'Forge Studio', pill: 'New' },
      { to: '/admin/ai-engine', icon: Bot, label: 'AI Engine', pill: 'New' },
      { to: '/admin/image-gallery', icon: Images, label: 'Image Gallery' },
      { to: '/admin/image-prompts', icon: Image, label: 'Prompts' },
    ],
  },
  {
    label: 'Amplify',
    items: [
      { to: '/admin/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/admin/recordings', icon: Radio, label: 'Recordings Hub', pill: 'Plaud' },
      { to: '/admin/social', icon: Share2, label: 'Social Hub', pill: 'Publer' },
      { to: '/admin/linkie', icon: Link2, label: 'Linkie Hub', pill: 'Linkie' },
      { to: '/admin/mailing-list', icon: Mail, label: 'Mailing List', pill: 'Klaviyo' },
    ],
  },
  {
    label: 'Spotlight',
    items: [
      { to: '/admin/speaking-events', icon: Mic, label: 'Speaking Events' },
      { to: '/admin/certifications', icon: Award, label: 'Certifications' },
      { to: '/admin/listen-and-learn', icon: Headphones, label: 'Listen & Learn' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/admin/ops-health', icon: Activity, label: 'Ops Health' },
      { to: '/admin/connections', icon: Plug, label: 'Connections' },
      { to: '/admin/labs', icon: FlaskConical, label: 'Labs', pill: 'VPS' },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function NavItem({ to, icon: Icon, label, end, badgeKey, pill, counts, collapsed }) {
  const count = badgeKey ? (counts?.[badgeKey] ?? 0) : 0;

  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        `group relative flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
          collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
        } ${
          isActive
            ? 'bg-primary/10 text-primary dark:bg-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {count > 0 && (
            <span className="ml-auto shrink-0 min-w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5">
              {count > 99 ? '99+' : count}
            </span>
          )}
          {pill && count === 0 && (
            <span className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 border border-border rounded px-1">
              {pill}
            </span>
          )}
        </>
      )}
      {/* Collapsed tooltip on hover */}
      {collapsed && count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  );
}

// ── Main Layout ───────────────────────────────────────────────────────────────

export default function AdminLayout() {
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (window.innerWidth < 768) return true;
    const saved = window.localStorage?.getItem('contentforge-sidebar-collapsed');
    return saved === null ? false : saved === 'true';
  });
  const [counts, setCounts] = useState({});

  useEffect(() => {
    try {
      window.localStorage?.setItem('contentforge-sidebar-collapsed', String(isSidebarCollapsed));
    } catch {
      // ignore
    }
  }, [isSidebarCollapsed]);

  // Fetch live queue / editor counts for badges
  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      try {
        const { postJSON } = await import('@/lib/api');
        const result = await postJSON('getAdminDashboardSnapshot', {});
        if (cancelled) return;
        const s = result?.stats || {};
        const blog = s.blog || {};
        const news = s.news || {};
        const arch = s.architecture || {};
        const fw = s.framework || {};
        const cc = s.coder_corner || {};
        setCounts({
          queue:
            (blog.needsReview || 0) +
            (news.needsReview || 0) +
            (arch.needsReview || 0) +
            (fw.needsReview || 0) +
            (cc.needsReview || 0),
          editor:
            (blog.inProgress || 0) +
            (arch.inProgress || 0) +
            (fw.inProgress || 0) +
            (cc.inProgress || 0),
        });
      } catch {
        // silently ignore — counts just won't show
      }
    }
    fetchCounts();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOutUser();
      navigate('/');
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`relative border-r border-border bg-card flex flex-col shrink-0 transition-all duration-200 ${
          isSidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        {/* Brand header */}
        <div
          className={`flex items-center border-b border-border px-3 h-14 shrink-0 ${
            isSidebarCollapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          {!isSidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight leading-none">ContentForge</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Influencer CMS</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed((p) => !p)}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-0.5">
              {!isSidebarCollapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
                  {group.label}
                </p>
              )}
              {isSidebarCollapsed && group.label !== NAV_GROUPS[0].label && (
                <div className="h-px bg-border/50 mx-1 mb-2 mt-1" />
              )}
              {group.items.map((item) => (
                <NavItem key={item.to} {...item} counts={counts} collapsed={isSidebarCollapsed} />
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-2 py-3 space-y-0.5 shrink-0">
          <NavLink
            to="/"
            title="Back to Site"
            aria-label="Back to Site"
            className={`flex items-center rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${
              isSidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2'
            }`}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span className="text-sm font-medium">Back to Site</span>}
          </NavLink>
          <button
            onClick={handleSignOut}
            title="Sign Out"
            aria-label="Sign Out"
            className={`w-full flex items-center rounded-lg text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors ${
              isSidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2'
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span className="font-medium">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main id="admin-main" className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
