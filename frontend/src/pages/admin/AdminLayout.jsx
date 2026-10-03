import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { signOutUser } from '@/lib/entraAuth';
import { NAV_GROUPS } from '@/config/adminNav';
import useDashboardCounts from '@/hooks/useDashboardCounts';

// The menu is the navigation registry (config/adminNav.js, ADR 0033 §3):
// groups, items, routes and the one-line description each item shows on
// hover. Nothing about the menu's content lives in this file; this file is
// the shell — collapse state, the live badges, Back to Site and Sign Out.
//
// Re-exported so the nav-order tests and the dashboard read the same list.
export { NAV_GROUPS };

// ── Helpers ───────────────────────────────────────────────────────────────────

function NavItem({ to, icon: Icon, label, description, end, badgeKey, counts, collapsed }) {
  const count = badgeKey ? (counts?.[badgeKey] ?? 0) : 0;
  // The description is the tooltip. Collapsed, the label joins it, because
  // the icon alone is what a new user cannot read.
  const tooltip = collapsed ? `${label} — ${description}` : description;

  return (
    <NavLink
      to={to}
      end={end}
      title={tooltip}
      aria-label={label}
      aria-description={description}
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
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {count > 0 && (
            <span
              className="ml-auto shrink-0 min-w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5"
              aria-label={`${count} waiting`}
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </>
      )}
      {collapsed && count > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5"
          aria-label={`${count} waiting`}
        >
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
  // One snapshot for every badge, re-read on each route change so a page the
  // user just left (approve, publish, reject) is reflected in the menu.
  const { counts } = useDashboardCounts({ refetchOnNavigate: true });

  useEffect(() => {
    try {
      window.localStorage?.setItem('contentforge-sidebar-collapsed', String(isSidebarCollapsed));
    } catch {
      // ignore
    }
  }, [isSidebarCollapsed]);

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
  // header to reserve for. The Footer is suppressed the same way.
  //
  // THE SIDEBAR NEVER SCROLLS AWAY (#566). The shell is exactly one viewport
  // tall (`h-dvh overflow-hidden`), so the window has nothing to scroll; the
  // content column `#admin-main` is the scroll container and the aside stays
  // put, with its nav list scrolling on its own when the menu is taller than
  // the screen. `dvh`, not `vh`: on mobile browsers `100vh` is the height with
  // the toolbar hidden, which would push Sign Out under the toolbar.
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
        <nav
          className="flex-1 min-h-0 overflow-y-auto py-3 px-2 space-y-4"
          aria-label="ContentForge"
        >
          {NAV_GROUPS.map((group, index) => (
            <div key={group.id} className="space-y-0.5">
              {!isSidebarCollapsed && index > 0 && (
                <p
                  className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none"
                  title={group.description}
                >
                  {group.label}
                </p>
              )}
              {isSidebarCollapsed && index > 0 && (
                <div className="h-px bg-border/50 mx-1 mb-2 mt-1" role="separator" />
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
