/**
 * integrationsDirectory.js — the Integrations directory, as configuration
 * (owner brief 2026-10-06, #919).
 *
 * The Services tab is operational: keys, lights, tests. The Directory tab is
 * descriptive: what each external service is, what it brings to this site,
 * where its documentation and official site are, and how to set it up here.
 * Both read the same service registry (components/admin/integrations/
 * serviceRegistry.jsx), so a service cannot be in one and not the other, and
 * the brand registry (components/admin/shared/IntegrationBadge.jsx) for the
 * official site and colour. This file adds only what neither holds: a
 * directory category, a one-line summary written for a reader rather than an
 * operator, what the service powers here, and a documentation link where
 * the publisher has one worth sending someone to.
 *
 * Adding a service to the directory is one row here and one in the service
 * registry; the tab itself never changes. The tests hold both registries to
 * each other, so a row with no service, or a service with no row, fails
 * the build rather than vanishing from the page.
 *
 * ADMIN ONLY, like everything that names a vendor (rule of 2026-09-28).
 */
import { BRANDS } from '@/components/admin/shared/IntegrationBadge';
import { SERVICES } from '@/components/admin/integrations/serviceRegistry';
import { tabHref } from '@/components/admin/integrations/tabs';

/** The categories, in the order the filter shows them. Payments and CRM are held for later. */
export const DIRECTORY_CATEGORIES = Object.freeze([
  { id: 'communication', label: 'Communication' },
  { id: 'ai', label: 'AI' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'education', label: 'Education' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'automation', label: 'Automation' },
  { id: 'cloud', label: 'Cloud services' },
  { id: 'payments', label: 'Payments' },
  { id: 'crm', label: 'CRM' },
]);

/**
 * One row per service: `id` is the service registry's; `category` one of
 * DIRECTORY_CATEGORIES; `summary` what the platform is; `powers` what it does
 * for this site; `docsUrl` the publisher's documentation, or null when there
 * is none worth a reader's time.
 */
export const DIRECTORY = Object.freeze([
  {
    id: 'telegram',
    category: 'communication',
    summary: 'Messaging and notification delivery.',
    powers:
      'Reminder and alert messages to the owner, and the approve / reject replies on new content.',
    docsUrl: 'https://core.telegram.org/bots/api',
  },
  {
    id: 'publer',
    category: 'communication',
    summary: 'Social media scheduling across networks.',
    powers: 'Autoposting when content goes live, and the social calendar.',
    docsUrl: null,
  },
  {
    id: 'resend',
    category: 'communication',
    summary: 'Transactional and newsletter email delivery.',
    powers: 'The newsletter issues and the signup confirmations.',
    docsUrl: 'https://resend.com/docs',
  },
  {
    id: 'rsscom',
    category: 'communication',
    summary: 'Podcast hosting and distribution.',
    powers: 'Publishing approved podcast episodes to the show feed.',
    docsUrl: null,
  },
  {
    id: 'youtube',
    category: 'communication',
    summary: 'Video hosting.',
    powers: 'The video listings the site reads and embeds.',
    docsUrl: 'https://developers.google.com/youtube/v3',
  },
  {
    id: 'linkie',
    category: 'productivity',
    summary: 'Link-in-bio profile pages.',
    powers: 'The Linkie Hub, which keeps the public link pages current.',
    docsUrl: null,
  },
  {
    id: 'plaud',
    category: 'productivity',
    summary: 'Voice recorder with cloud transcripts.',
    powers: 'Reading recordings and transcripts into the Recording Hub.',
    docsUrl: null,
  },
  {
    id: 'sessionize',
    category: 'productivity',
    summary: 'Speaker profiles and conference sessions.',
    powers: 'The Speaking page, read from the speaker profile.',
    docsUrl: null,
  },
  {
    id: 'credly',
    category: 'education',
    summary: 'Digital credentials and badges.',
    powers: 'Verifying the certifications shown on the site.',
    docsUrl: null,
  },
  {
    id: 'microsoft-learn',
    category: 'education',
    summary: "Microsoft's training and certification catalogue.",
    powers: 'The Learn pages and the certification catalogue dates.',
    docsUrl: 'https://learn.microsoft.com/training/',
  },
  {
    id: 'aws-skill-builder',
    category: 'education',
    summary: "AWS's training and certification catalogue.",
    powers: 'The AWS entries on the Learn pages.',
    docsUrl: 'https://aws.amazon.com/training/',
  },
  {
    id: 'google-developer',
    category: 'education',
    summary: "Google's developer profiles and badges.",
    powers: 'The Google entries on the Learn pages.',
    docsUrl: 'https://developers.google.com/profile',
  },
  {
    id: 'gemini',
    category: 'ai',
    summary: "Google's language and speech models.",
    powers: 'Drafting, summarising and grading content, and the Listen & Learn voice.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
  },
  {
    id: 'anthropic',
    category: 'ai',
    summary: 'The Claude family of language models.',
    powers: 'Drafting, summarising and grading content, in the order set on AI Engine.',
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'openai',
    category: 'ai',
    summary: 'The GPT family of language models.',
    powers: 'Drafting, summarising and grading content, in the order set on AI Engine.',
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'nvidia',
    category: 'ai',
    summary: 'Hosted open models on the NVIDIA API catalogue.',
    powers: 'The backup for owner-triggered content features.',
    docsUrl: 'https://docs.api.nvidia.com',
  },
  {
    id: 'perplexity',
    category: 'ai',
    summary: 'Answer engine with web grounding.',
    powers: 'Grounded research where a task asks for it.',
    docsUrl: 'https://docs.perplexity.ai',
  },
  {
    id: 'elevenlabs',
    category: 'ai',
    summary: 'Text-to-speech voices.',
    powers: 'The podcast voices.',
    docsUrl: 'https://elevenlabs.io/docs',
  },
  {
    id: 'azure-speech',
    category: 'ai',
    summary: "Microsoft's speech service.",
    powers: 'Speech where the podcast pipeline asks for it.',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/speech-service/',
  },
  {
    id: 'firecrawl',
    category: 'ai',
    summary: 'Web scraping that returns clean text.',
    powers: 'Reading a web page well enough to summarise it, and the blog listings.',
    docsUrl: 'https://docs.firecrawl.dev',
  },
  {
    id: 'replicate',
    category: 'ai',
    summary: 'Hosted image and media models.',
    powers: 'Cover images and manual image generation.',
    docsUrl: 'https://replicate.com/docs',
  },
  {
    id: 'cloud-pricing',
    category: 'cloud',
    summary: 'The public price lists of Azure, AWS and Google Cloud.',
    powers: 'The cost comparison tools.',
    docsUrl: null,
  },
  {
    id: 'qlty',
    category: 'analytics',
    summary: 'Code quality and coverage analysis.',
    powers: "The repository's scanner results on the Health page.",
    docsUrl: 'https://docs.qlty.sh',
  },
  {
    id: 'hybrid-lab',
    category: 'cloud',
    summary: 'Browser workspaces on the lab host, behind a human check.',
    powers: 'The labs learners open from the labs page.',
    docsUrl: 'https://coder.com/docs',
  },
]);

/** The directory's rows merged with the service and brand registries. */
export function directoryEntries({
  directory = DIRECTORY,
  services = SERVICES,
  brands = BRANDS,
} = {}) {
  const byId = new Map(services.map((service) => [service.id, service]));
  return directory
    .map((row) => {
      const service = byId.get(row.id);
      if (!service) return null;
      const brand = brands[row.id] ?? null;
      const keyed = (service.secrets ?? []).length > 0;
      return {
        ...row,
        name: service.name,
        group: service.group,
        usedIn: service.usedIn ?? [],
        siteUrl: brand?.site ?? service.url ?? null,
        keyed,
        // Where it is set up here: the Services tab opened on its group,
        // which shows its card, its lights and its test.
        setupHref: `${tabHref('services')}&group=${encodeURIComponent(service.group)}`,
      };
    })
    .filter(Boolean);
}

/** Whether a status key from integrationView.js reads as connected, not, or unknown. */
export function connectionOf(statusKey) {
  if (statusKey === 'ok' || statusKey === 'link-only') return 'connected';
  if (statusKey === 'broken' || statusKey === 'not-configured') return 'not-connected';
  return 'unknown';
}
