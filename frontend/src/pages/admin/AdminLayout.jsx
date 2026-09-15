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
  SlidersHorizontal,
} from 'lucide-react';
import { signOutUser } from '@/lib/entraAuth';

// ── Nav Groups ────────────────────────────────────────────────────────────────
// Each group has a label, icon, and items. Items can have a badge key
// which maps to a live count from the snapshot API.
//
// No text tags ("New", "Resend", "VPS"…) beside an item (#566). A badge is
// state — how many things are waiting — and earns its place in the menu; a
// tag naming the product behind a page does not. That belongs in the page's
// own header, where the owner is looking when it matters.

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
      { to: '/admin/forge-studio', icon: Flame, label: 'Forge Studio' },
      { to: '/admin/ai-engine', icon: Bot, label: 'AI Engine' },
      { to: '/admin/image-gallery', icon: Images, label: 'Image Gallery' },
      { to: '/admin/image-prompts', icon: Image, label: 'Prompts' },
    ],
  },
  {
    label: 'Amplify',
    items: [
      { to: '/admin/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/admin/recording-hub', icon: Radio, label: 'Recording Hub' },
      { to: '/admin/social', icon: Share2, label: 'Social Hub' },
      { to: '/admin/linkie', icon: Link2, label: 'Linkie Hub' },
      { to: '/admin/mailing-list', icon: Mail, label: 'Newsletter Hub' },
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
      { to: '/admin/platform', icon: SlidersHorizontal, label: 'Platform Settings' },
      { to: '/admin/health', icon: Activity, label: 'Health' },
      { to: '/admin/integrations', icon: Plug, label: 'Integrations' },
      { to: '/admin/labs', icon: FlaskConical, label: 'Labs' },
    ],
  },
];

// Exported for the nav-order test. The Platform group's order is a decision
// the owner made explicitly — settings first, Labs last — so it is asserted
// rather than left to whoever next edits the array.
export { NAV_GROUPS };

// ── Helpers ───────────────────────────────────────────────────────────────────

function NavItem({ to, icon: Icon, label, end, badgeKey, counts, collapsed }) {
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

  // FULL VIEWPORT HEIGHT below, not `calc(100vh-4rem)`. That 4rem was
  // reserving room for the site header — and App.jsx renders it as
  // `{!isAdminRoute && <Header />}`, so on every admin route there is no
  // header to reserve for. The Footer is suppressed the same way. The layout
  // was therefore 64px shorter than the window with nothing occupying the gap,
  // which is what pushed the sidebar's brand block flush against the top of
  // the viewport with no breathing room above "ContentForge".
  //
  // THE SIDEBAR NEVER SCROLLS AWAY (#566). The shell is exactly one viewport
  // tall (`h-dvh overflow-hidden`), so the window has nothing to scroll; the
  // content column `#admin-main` is the scroll container and the aside stays
  // put, with its nav list scrolling on its own when the menu is taller than
  // the screen.
  //
  // Why not only `sticky top-0` on the aside with the window still scrolling,
  // which would leave ScrollToTop untouched: when this was written it did not
  // stick on this site. index.css gave `html` `overflow-y: scroll` and `body`
  // `overflow-x: hidden`, and because the root's overflow is not `visible`,
  // the body's is not propagated to the viewport — `body` became a scroll
  // container that never scrolls, and a sticky element pinned to that instead
  // of the window. Measured in Chromium on 2026-09-14: after
  // `scrollTo(0, 2000)` the aside's top was -2000 with that CSS and 0 without
  // it. #580 changed the body rule to `overflow-x: clip`, which creates no
  // scroll container, so sticky now works site-wide; the viewport-tall shell
  // stays because it is what holds the sidebar, and the sticky classes remain
  // a belt.
  //
  // `dvh`, not `vh`: on mobile browsers `100vh` is the height with the
  // toolbar hidden, which would push Sign Out under the toolbar.
  //
  // `#admin-main` is a div, not a `<main>`: App.jsx already wraps every route
  // in `<main id="main-content">`, and two nested main landmarks is one too
  // many. ScrollToTop resets this container's scroll on route change.
  return (
    <div className="h-dvh overflow-hidden flex bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`sticky top-0 h-dvh border-r border-border bg-card flex flex-col shrink-0 transition-all duration-200 ${
          isSidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        {/* Brand header. A minimum height with real padding and line height,
            not a fixed `h-14` with `leading-none`: at 125% and 150% zoom the
            two lines outgrew the box and "ContentForge" was cut at the top. */}
        <div
          className={`flex items-center border-b border-border px-3 py-3 min-h-14 shrink-0 ${
            isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'
          }`}
        >
          {!isSidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight leading-5">ContentForge</p>
              <p className="text-[10px] leading-4 text-muted-foreground">Influencer CMS</p>
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
        <nav className="flex-1 min-h-0 overflow-y-auto py-3 px-2 space-y-4">
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
      <div id="admin-main" className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
