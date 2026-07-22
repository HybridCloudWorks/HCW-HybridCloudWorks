import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useProvider } from '@/context/ProviderContext';
import { routes, staticRoutes, parseRoute } from '@/lib/routeFactory';
import { SkipToMainContent } from '@/components/accessibility/SkipToMainContent';

export default function Header() {
  const location = useLocation();
  const _currentProvider = useProvider();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const toolsRef = useRef(null);
  const toolsButtonRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    const handleClickOutside = (event) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target)) {
        setToolsDropdownOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (toolsDropdownOpen) {
          setToolsDropdownOpen(false);
          toolsButtonRef.current?.focus();
        }
        if (mobileMenuOpen) setMobileMenuOpen(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [toolsDropdownOpen, mobileMenuOpen]);

  // Parse route info for provider context
  const _routeInfo = parseRoute(location.pathname);
  const currentProvider = _routeInfo?.provider || null;

  // Shared nav links (consistent across all headers)
  const sharedLinks = [
    { label: 'About', path: staticRoutes.about },
    { label: 'Contact', path: staticRoutes.contact },
  ];

  // Define navigation groups
  const allProviders = [
    { label: 'Azure', path: routes.landing('azure') },
    { label: 'AWS', path: routes.landing('aws') },
    { label: 'Google Cloud', path: routes.landing('gcp') },
    { label: 'VMware', path: routes.landing('vmware') },
    { label: 'GitHub', path: routes.landing('github') },
    { label: 'FinOps', path: routes.landing('finops') },
    { label: 'Terraform', path: routes.landing('terraform') },
    { label: 'Ansible', path: routes.landing('ansible') },
  ];

  // Cloud provider page navigation (absolute paths will be set dynamically)
  const getCloudPageLinks = (provider) => [
    { label: 'News', path: routes.rss(provider) },
    { label: 'Blogs', path: routes.blog(provider) },
    { label: 'Architecture', path: routes.architectureDesigns(provider) },
    { label: 'Podcast', path: routes.audioArchitecture(provider) },
    { label: 'Frameworks', path: routes.frameworks(provider) },
    { label: 'Learning', path: routes.education(provider) },
  ];

  // FinOps page navigation
  const getFinOpsPageLinks = () => [
    { label: 'News', path: routes.rss('finops') },
    { label: 'Blogs', path: routes.blog('finops') },
    { label: 'Architecture', path: routes.architectureDesigns('finops') },
    { label: 'FOCUS', path: routes.focus('finops') },
    { label: 'Frameworks', path: routes.frameworks('finops') },
    { label: 'Learning', path: routes.education('finops') },
  ];

  // GitHub page navigation
  const getGitHubPageLinks = () => [
    { label: 'News', path: routes.rss('github') },
    { label: 'Blogs', path: routes.blog('github') },
    { label: 'Code', path: routes.code('github') },
    { label: 'Workflows', path: routes.workflows('github') },
    { label: 'Tools', path: routes.tools('github') },
    { label: 'Learning', path: routes.education('github') },
  ];

  // Terraform page navigation
  const getTerraformPageLinks = () => [
    { label: 'News', path: routes.rss('terraform') },
    { label: 'Blogs', path: routes.blog('terraform') },
    { label: 'Code', path: routes.code('terraform') },
    { label: 'Modules', path: routes.modules('terraform') },
    { label: 'Tools', path: routes.tools('terraform') },
    { label: 'Learning', path: routes.education('terraform') },
  ];

  // Ansible page navigation (service-provider pattern, mirrors Terraform)
  const getAnsiblePageLinks = () => [
    { label: 'News', path: routes.rss('ansible') },
    { label: 'Blogs', path: routes.blog('ansible') },
    { label: 'Code', path: routes.code('ansible') },
    { label: 'Learning', path: routes.education('ansible') },
  ];

  // Tools dropdown menu items (global standalone tools + provider-specific tools)
  const getToolsDropdownItems = () => [
    { label: 'Resource Comparison', path: staticRoutes.resources },
    { label: 'Decision Matrix', path: staticRoutes.decisions },
    { label: 'Pillar Comparison', path: staticRoutes.comparison },
    { label: 'Migration Hub', path: staticRoutes.migration },
    ...(currentProvider === 'finops'
      ? [{ label: 'FinOps Tools', path: routes.tools('finops') }]
      : []),
    ...(currentProvider === 'github'
      ? [{ label: 'GitHub Tools', path: routes.tools('github') }]
      : []),
    ...(currentProvider === 'terraform'
      ? [{ label: 'Terraform Tools', path: routes.tools('terraform') }]
      : []),
  ];

  const _serviceProviders = [
    { label: 'FinOps', path: routes.landing('finops') },
    { label: 'GitHub', path: routes.landing('github') },
    { label: 'Terraform', path: routes.landing('terraform') },
  ];

  // Determine which navigation to show based on current provider
  let hubLinks;
  if (!currentProvider) {
    // Root page - show all providers
    hubLinks = allProviders;
  } else if (['aws', 'azure', 'gcp', 'vmware'].includes(currentProvider)) {
    // Cloud provider pages - show page navigation
    hubLinks = getCloudPageLinks(currentProvider);
  } else if (currentProvider === 'finops') {
    // FinOps pages - show FinOps-specific navigation
    hubLinks = getFinOpsPageLinks();
  } else if (currentProvider === 'github') {
    // GitHub pages - show GitHub-specific navigation
    hubLinks = getGitHubPageLinks();
  } else if (currentProvider === 'terraform') {
    // Terraform pages - show Terraform-specific navigation
    hubLinks = getTerraformPageLinks();
  } else if (currentProvider === 'ansible') {
    // Ansible pages - service-provider navigation like Terraform
    hubLinks = getAnsiblePageLinks();
  } else {
    // Fallback to all providers
    hubLinks = allProviders;
  }

  return (
    <header
      className={cn(
        // Background/blur come from the tokenized header chrome in index.css
        // (--header-bg / --header-blur, overridden per provider theme).
        'sticky top-0 z-50 border-b border-glass-border h-16 transition-all duration-300',
        scrolled && 'shadow-(--shadow-sm)'
      )}
    >
      <SkipToMainContent href="#main-content" />
      <div className="max-w-[1400px] mx-auto h-full px-4 md:px-8 flex items-center">
        {/* Logo - use brand logo image in top-left */}
        <div className="flex items-center w-60">
          <Link to="/" className="flex items-center group h-full py-0">
            <img
              src="/icons/hcw-logo.png"
              alt="HybridCloudWorks logo"
              width="160"
              height="32"
              fetchPriority="high"
              decoding="async"
              className="h-8 w-auto object-contain"
            />
            <span className="sr-only">HybridCloudWorks</span>
          </Link>
        </div>

        {/* Centered Nav */}
        <div className="flex-1 hidden lg:flex items-center justify-center gap-5">
          {/* Provider links with GRID layout for perfect alignment across all providers */}
          <nav
            aria-label="Primary"
            className="grid gap-1 items-center"
            style={{ gridTemplateColumns: `repeat(${hubLinks.length + 1}, 90px)` }}
          >
            {hubLinks.map((item, index) => (
              <Link
                key={item.path}
                to={item.path}
                style={{ gridColumn: index + 1 }}
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-wide transition-colors px-2.5 py-2 rounded-full border whitespace-nowrap inline-flex items-center justify-center',
                  location.pathname.startsWith(item.path)
                    ? 'text-(--dark-gray) dark:text-(--light-gray) bg-secondary/15 border-secondary/40'
                    : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-(--dark-gray) dark:hover:text-(--light-gray) hover:bg-secondary/15 hover:border-secondary/40'
                )}
              >
                {item.label}
              </Link>
            ))}

            {/* Tools Dropdown - repositioned and stabilized with Click-to-Toggle */}
            {true && (
              <div className="relative" style={{ gridColumn: hubLinks.length + 1 }} ref={toolsRef}>
                <button
                  ref={toolsButtonRef}
                  onClick={() => setToolsDropdownOpen(!toolsDropdownOpen)}
                  aria-expanded={toolsDropdownOpen}
                  aria-haspopup="menu"
                  aria-controls="tools-dropdown-menu"
                  aria-label="Toggle tools menu"
                  className={cn(
                    'text-[11px] font-semibold uppercase tracking-wide transition-all px-2.5 py-2 rounded-full border whitespace-nowrap inline-flex items-center justify-center w-full gap-1',
                    location.pathname.startsWith('/tools/') || toolsDropdownOpen
                      ? 'text-(--dark-gray) dark:text-(--light-gray) bg-secondary/15 border-secondary/40 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-(--dark-gray) dark:hover:text-(--light-gray) hover:bg-secondary/15 hover:border-secondary/40'
                  )}
                >
                  Tools
                  <span
                    className={cn(
                      'material-symbols-outlined text-[13px] transition-transform duration-200',
                      toolsDropdownOpen && 'rotate-180'
                    )}
                    aria-hidden="true"
                  >
                    expand_more
                  </span>
                </button>

                {/* Dropdown Menu - stabilized with higher z-index and click logic */}
                {toolsDropdownOpen && (
                  <div
                    id="tools-dropdown-menu"
                    role="menu"
                    aria-label="Tools"
                    className="absolute top-[calc(100%+8px)] left-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-2 min-w-50 z-100 animate-in fade-in slide-in-from-top-2 duration-200"
                  >
                    {getToolsDropdownItems().map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        role="menuitem"
                        onClick={() => setToolsDropdownOpen(false)}
                        className="block px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 hover:bg-secondary/10 hover:text-(--dark-gray) dark:hover:text-(--light-gray) transition-colors"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </nav>
          {/* Divider - always in same position */}
          <div className="h-6 w-px bg-slate-300 dark:bg-slate-800 shrink-0"></div>
          {/* About/Contact - always in same position */}
          <nav aria-label="Secondary" className="hidden xl:flex items-center gap-1 w-42.5">
            {sharedLinks.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-wide transition-colors px-2.5 py-2 rounded-full border whitespace-nowrap inline-flex items-center justify-center min-w-20',
                  location.pathname === item.path
                    ? 'text-(--dark-gray) dark:text-(--light-gray) bg-secondary/15 border-secondary/40'
                    : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-(--dark-gray) dark:hover:text-(--light-gray) hover:bg-secondary/15 hover:border-secondary/40'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right Controls - fixed width to prevent shifts */}
        <div className="flex items-center gap-2 ml-auto min-w-41 justify-end">
          <button
            className="lg:hidden text-slate-900 dark:text-white h-11 w-11 inline-flex items-center justify-center rounded-md hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
            aria-label="Toggle menu"
          >
            <span className="material-symbols-outlined">{mobileMenuOpen ? 'close' : 'menu'}</span>
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="lg:hidden absolute left-0 right-0 top-16 bg-background/98 backdrop-blur-xl border-b border-glass-border z-50 px-4 py-4 flex flex-col gap-1 shadow-xl"
        >
          {hubLinks.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center h-11 px-4 rounded-lg text-sm font-bold uppercase tracking-wide',
                location.pathname.startsWith(item.path)
                  ? 'bg-slate-200/70 dark:bg-slate-700/60 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white'
              )}
              onClick={() => setMobileMenuOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <div className="border-t border-slate-300 dark:border-slate-800 mt-2 pt-2">
            {sharedLinks.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className="flex items-center h-11 px-4 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
