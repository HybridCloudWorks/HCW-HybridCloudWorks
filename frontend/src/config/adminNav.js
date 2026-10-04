/**
 * The ContentForge navigation registry (ADR 0033 §3).
 *
 * ONE list, read by the sidebar (AdminLayout), the dashboard's "Explore"
 * strip and each page's header, so a group's name, an item's description
 * and its route are written once. A new user reads the description on
 * hover in the sidebar, under the title on the page, and on the dashboard
 * card — the same sentence in all three places.
 *
 * Groups answer the question a first-time user has at the menu:
 *
 *   Pipeline   where a piece of content moves from idea to live page
 *   Enhanced   tools that turn published content into something more
 *   Creative   where new content and images are made
 *   Amplify    where finished content reaches an audience
 *   Spotlight  the author's own visibility: talks, credentials, programs
 *   Platform   how the system itself is configured and watched
 *
 * Item order inside Pipeline is the order the work happens. No text tags
 * beside an item (#566): a badge is state, a tag naming the product behind a
 * page belongs on that page's header.
 *
 * The registry is two tables — the groups, and the items with the group each
 * belongs to — joined once below. One row per entry, so adding a page is one
 * line and no group is a copy of another's shape.
 */
import {
  Activity,
  Award,
  BadgeCheck,
  BookOpen,
  Bot,
  Calendar,
  Code2,
  FilePen,
  FlaskConical,
  Flame,
  Globe,
  Headphones,
  Image,
  Images,
  LayoutDashboard,
  Link2,
  ListChecks,
  Mail,
  Mic,
  Newspaper,
  PenLine,
  Plug,
  Radio,
  Share2,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';

/** `[id, label, description]`, in menu order. */
const GROUPS = [
  ['home', 'Home', 'Where you are, what is waiting, and what to do next.'],
  [
    'pipeline',
    'Pipeline',
    'Every piece of content moves through these stages, in this order, to a live page.',
  ],
  [
    'enhanced',
    'Enhanced',
    'Tools that turn published content into something more: audio, labs, structured guides.',
  ],
  [
    'creative',
    'Creative',
    'Where new content and images are made, and how the AI behind them is set up.',
  ],
  [
    'amplify',
    'Amplify',
    'Where finished content reaches an audience: the calendar, the newsletter, social.',
  ],
  [
    'spotlight',
    'Spotlight',
    'Your own visibility: the talks you give, the credentials you hold, the programs you pursue.',
  ],
  ['platform', 'Platform', 'How the system itself is configured, connected and watched.'],
];

/**
 * `[group, to, icon, label, description, extra?]`, in the order each group
 * shows them. `extra` carries `end` (exact match for the dashboard route)
 * and `badgeKey` (which count the sidebar shows beside the item).
 */
const ITEMS = [
  [
    'home',
    '/admin',
    LayoutDashboard,
    'Dashboard',
    'Everything waiting on you, the pipeline at a glance, and recent activity.',
    { end: true },
  ],

  // Pipeline, in the order the work happens.
  [
    'pipeline',
    '/admin/submit',
    Zap,
    'New Content',
    'Start something: import a URL or document, or draft from a source.',
  ],
  [
    'pipeline',
    '/admin/drafts',
    FilePen,
    'Drafts',
    'Your writing desk. Articles you are still writing, before anyone reviews them.',
  ],
  [
    'pipeline',
    '/admin/queue',
    ListChecks,
    'Review Queue',
    'Triage what arrived: approve it for editing, send it back, or reject it.',
    { badgeKey: 'queue' },
  ],
  [
    'pipeline',
    '/admin/editor',
    PenLine,
    'Editor',
    'Polish approved drafts: text, metadata, images, and the publish date.',
    { badgeKey: 'editor' },
  ],
  [
    'pipeline',
    '/admin/published',
    Newspaper,
    'Publish',
    'Push finished content live, now or on a schedule, and see what went out.',
  ],
  [
    'pipeline',
    '/admin/live-pages',
    Globe,
    'Live Pages',
    'Every page visitors can open right now, with its URL, type and provider.',
    { badgeKey: 'live' },
  ],

  // Enhanced
  [
    'enhanced',
    '/admin/listen-and-learn',
    Headphones,
    'Listen & Learn',
    'Turn study guides and articles into spoken chapters, organised as books and courses.',
  ],
  [
    'enhanced',
    '/admin/labs',
    FlaskConical,
    'Labs',
    'Hands-on learning environments per provider, and the agent and desktop behind them.',
  ],
  [
    'enhanced',
    '/admin/frameworks',
    BookOpen,
    'Frameworks',
    'Well-Architected style reference guides, reviewed and published on their own board.',
  ],
  [
    'enhanced',
    '/admin/coder-corner',
    Code2,
    'Coder Corner',
    'Code-first tutorials and snippets, reviewed and published on their own board.',
  ],

  // Creative
  [
    'creative',
    '/admin/forge-studio',
    Flame,
    'Forge Studio',
    'Brief, draft and shape a piece with AI help, then send it into the pipeline.',
  ],
  [
    'creative',
    '/admin/ai-engine',
    Bot,
    'AI Engine',
    'Which AI provider and model handles each kind of task, with fallbacks and usage.',
  ],
  [
    'creative',
    '/admin/image-prompts',
    Image,
    'Image Prompts',
    'Prompt sets that generate coordinated images on a shared theme.',
  ],
  [
    'creative',
    '/admin/image-gallery',
    Images,
    'Image Gallery',
    'Every image the site holds: generated, uploaded or imported, with where it is used.',
  ],

  // Amplify
  [
    'amplify',
    '/admin/calendar',
    Calendar,
    'Calendar',
    'Everything scheduled across ContentForge: publishes, sends, posts, talks, deadlines.',
  ],
  [
    'amplify',
    '/admin/mailing-list',
    Mail,
    'Newsletter Hub',
    'Build, review, send and measure newsletter issues; manage who receives them.',
  ],
  [
    'amplify',
    '/admin/social',
    Share2,
    'Social Hub',
    'Schedule live pages to LinkedIn, X and other networks through Publer.',
  ],
  [
    'amplify',
    '/admin/linkie',
    Link2,
    'Linkie Hub',
    'The link-in-bio profile: which pages it lists and how they perform.',
  ],
  [
    'amplify',
    '/admin/recording-hub',
    Radio,
    'Recording Hub',
    'Plaud recordings to transcripts to podcast episodes, and their distribution.',
  ],

  // Spotlight
  [
    'spotlight',
    '/admin/speaking-events',
    Mic,
    'Speaking',
    'Talks, proposals and deadlines, synced from Sessionize and published to About.',
  ],
  [
    'spotlight',
    '/admin/certifications',
    Award,
    'Certifications',
    'Credentials, badges, expiry and renewal dates, published to About.',
  ],
  [
    'spotlight',
    '/admin/ambassador',
    BadgeCheck,
    'Ambassador',
    'Prepare and track applications to MVP, Hero, Captain and other programs, with evidence.',
  ],

  // Platform
  [
    'platform',
    '/admin/platform',
    SlidersHorizontal,
    'Platform Settings',
    'Defaults the pipeline reads on every run: covers, voices, content types, autoposting.',
  ],
  [
    'platform',
    '/admin/health',
    Activity,
    'Health',
    'Whether each part of the platform is working, with last-checked times and fixes.',
  ],
  [
    'platform',
    '/admin/integrations',
    Plug,
    'Integrations',
    'Every external service, its keys, its connection test and where it is used.',
  ],
];

/** One row of ITEMS as the registry entry the sidebar and the headers read. */
const navItem = ([, to, icon, label, description, extra = {}]) => ({
  to,
  icon,
  label,
  ...extra,
  description,
});

export const NAV_GROUPS = Object.freeze(
  GROUPS.map(([id, label, description]) => ({
    id,
    label,
    description,
    items: ITEMS.filter(([group]) => group === id).map(navItem),
  }))
);

/** Every item across every group, flat. */
export const NAV_ITEMS = Object.freeze(NAV_GROUPS.flatMap((group) => group.items));

/**
 * The registry entry for a route, so a page header can show the same
 * description the sidebar does. Exact match first, then the longest prefix
 * (so /admin/queue/abc resolves to Review Queue), never the bare /admin for
 * a deeper path.
 */
export function navItemFor(pathname) {
  const path = String(pathname || '');
  const exact = NAV_ITEMS.find((item) => item.to === path);
  if (exact) return exact;
  return (
    NAV_ITEMS.filter((item) => item.to !== '/admin' && path.startsWith(`${item.to}/`)).sort(
      (a, b) => b.to.length - a.to.length
    )[0] || null
  );
}

/** The group an item belongs to. */
export function navGroupFor(item) {
  return NAV_GROUPS.find((group) => group.items.includes(item)) || null;
}
