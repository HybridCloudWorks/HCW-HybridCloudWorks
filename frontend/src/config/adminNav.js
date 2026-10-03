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

export const NAV_GROUPS = Object.freeze([
  {
    id: 'home',
    label: 'Home',
    description: 'Where you are, what is waiting, and what to do next.',
    items: [
      {
        to: '/admin',
        icon: LayoutDashboard,
        label: 'Dashboard',
        end: true,
        description: 'Everything waiting on you, the pipeline at a glance, and recent activity.',
      },
    ],
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description:
      'Every piece of content moves through these stages, in this order, to a live page.',
    items: [
      {
        to: '/admin/submit',
        icon: Zap,
        label: 'New Content',
        description: 'Start something: import a URL or document, or draft from a source.',
      },
      {
        to: '/admin/drafts',
        icon: FilePen,
        label: 'Drafts',
        description:
          'Your writing desk. Articles you are still writing, before anyone reviews them.',
      },
      {
        to: '/admin/queue',
        icon: ListChecks,
        label: 'Review Queue',
        badgeKey: 'queue',
        description: 'Triage what arrived: approve it for editing, send it back, or reject it.',
      },
      {
        to: '/admin/editor',
        icon: PenLine,
        label: 'Editor',
        badgeKey: 'editor',
        description: 'Polish approved drafts: text, metadata, images, and the publish date.',
      },
      {
        to: '/admin/published',
        icon: Newspaper,
        label: 'Publish',
        description: 'Push finished content live, now or on a schedule, and see what went out.',
      },
      {
        to: '/admin/live-pages',
        icon: Globe,
        label: 'Live Pages',
        badgeKey: 'live',
        description: 'Every page visitors can open right now, with its URL, type and provider.',
      },
    ],
  },
  {
    id: 'enhanced',
    label: 'Enhanced',
    description:
      'Tools that turn published content into something more: audio, labs, structured guides.',
    items: [
      {
        to: '/admin/listen-and-learn',
        icon: Headphones,
        label: 'Listen & Learn',
        description:
          'Turn study guides and articles into spoken chapters, organised as books and courses.',
      },
      {
        to: '/admin/labs',
        icon: FlaskConical,
        label: 'Labs',
        description:
          'Hands-on learning environments per provider, and the agent and desktop behind them.',
      },
      {
        to: '/admin/frameworks',
        icon: BookOpen,
        label: 'Frameworks',
        description:
          'Well-Architected style reference guides, reviewed and published on their own board.',
      },
      {
        to: '/admin/coder-corner',
        icon: Code2,
        label: 'Coder Corner',
        description:
          'Code-first tutorials and snippets, reviewed and published on their own board.',
      },
    ],
  },
  {
    id: 'creative',
    label: 'Creative',
    description: 'Where new content and images are made, and how the AI behind them is set up.',
    items: [
      {
        to: '/admin/forge-studio',
        icon: Flame,
        label: 'Forge Studio',
        description: 'Brief, draft and shape a piece with AI help, then send it into the pipeline.',
      },
      {
        to: '/admin/ai-engine',
        icon: Bot,
        label: 'AI Engine',
        description:
          'Which AI provider and model handles each kind of task, with fallbacks and usage.',
      },
      {
        to: '/admin/image-prompts',
        icon: Image,
        label: 'Image Prompts',
        description: 'Prompt sets that generate coordinated images on a shared theme.',
      },
      {
        to: '/admin/image-gallery',
        icon: Images,
        label: 'Image Gallery',
        description:
          'Every image the site holds: generated, uploaded or imported, with where it is used.',
      },
    ],
  },
  {
    id: 'amplify',
    label: 'Amplify',
    description:
      'Where finished content reaches an audience: the calendar, the newsletter, social.',
    items: [
      {
        to: '/admin/calendar',
        icon: Calendar,
        label: 'Calendar',
        description:
          'Everything scheduled across ContentForge: publishes, sends, posts, talks, deadlines.',
      },
      {
        to: '/admin/mailing-list',
        icon: Mail,
        label: 'Newsletter Hub',
        description: 'Build, review, send and measure newsletter issues; manage who receives them.',
      },
      {
        to: '/admin/social',
        icon: Share2,
        label: 'Social Hub',
        description: 'Schedule live pages to LinkedIn, X and other networks through Publer.',
      },
      {
        to: '/admin/linkie',
        icon: Link2,
        label: 'Linkie Hub',
        description: 'The link-in-bio profile: which pages it lists and how they perform.',
      },
      {
        to: '/admin/recording-hub',
        icon: Radio,
        label: 'Recording Hub',
        description: 'Plaud recordings to transcripts to podcast episodes, and their distribution.',
      },
    ],
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    description:
      'Your own visibility: the talks you give, the credentials you hold, the programs you pursue.',
    items: [
      {
        to: '/admin/speaking-events',
        icon: Mic,
        label: 'Speaking',
        description:
          'Talks, proposals and deadlines, synced from Sessionize and published to About.',
      },
      {
        to: '/admin/certifications',
        icon: Award,
        label: 'Certifications',
        description: 'Credentials, badges, expiry and renewal dates, published to About.',
      },
      {
        to: '/admin/ambassador',
        icon: BadgeCheck,
        label: 'Ambassador',
        description:
          'Prepare and track applications to MVP, Hero, Captain and other programs, with evidence.',
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    description: 'How the system itself is configured, connected and watched.',
    items: [
      {
        to: '/admin/platform',
        icon: SlidersHorizontal,
        label: 'Platform Settings',
        description:
          'Defaults the pipeline reads on every run: covers, voices, content types, autoposting.',
      },
      {
        to: '/admin/health',
        icon: Activity,
        label: 'Health',
        description:
          'Whether each part of the platform is working, with last-checked times and fixes.',
      },
      {
        to: '/admin/integrations',
        icon: Plug,
        label: 'Integrations',
        description: 'Every external service, its keys, its connection test and where it is used.',
      },
    ],
  },
]);

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
