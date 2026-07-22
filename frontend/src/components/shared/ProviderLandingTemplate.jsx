import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { routes } from '@/lib/routeFactory';
import { useProviderConfig } from '@/context/ProviderContext';
import ProviderLatestContentPanel from '@/components/landing/ProviderLatestContentPanel';
import Eyebrow from '@/components/shared/Eyebrow';
import NumberedSection from '@/components/shared/NumberedSection';
import StatBlock from '@/components/shared/StatBlock';

/**
 * ProviderLandingTemplate — shared Hyoga-style landing page for all
 * provider hubs (AWS, Azure, GCP, FinOps, Terraform, GitHub, ...).
 *
 * Design language: charcoal dark-luxe base + warm ambient glow, large
 * light-weight two-line display headline, uppercase eyebrow, pill CTA,
 * glassy stat blocks, numbered sections, dark cards with circular icon
 * chips. The ACCENT slot is always the active provider theme
 * (`--primary` / `--slate-blue`) — this component never introduces its
 * own palette, so it inherits each provider's colors automatically when
 * rendered inside the provider's `.theme-{provider}` wrapper.
 *
 * Usage (per-provider page stays a thin wrapper):
 *   <ProviderLandingTemplate
 *     provider="aws"
 *     hero={{
 *       eyebrow: 'BUILD. INNOVATE. ELEVATE.',
 *       title: <>Architecture intelligence for <span className="display-accent">AWS</span></>,
 *       description: 'Curated insights, technical blueprints, ...',
 *       media: <HeroImageCarousel images={AWS_HERO_IMAGES} ... />,   // optional
 *       cta: { label: 'Explore Architectures', to: routes.architectureDesigns('aws') }, // optional
 *       stats: [{ value: '24', suffix: '+', label: 'Blueprints' }, ...], // optional
 *     }}
 *     sections={[
 *       {
 *         eyebrow: 'REFERENCE DESIGNS',
 *         title: 'AWS Reference Architectures',
 *         action: { label: 'All designs', to: routes.architectureDesigns('aws') }, // optional
 *         content: <YourSectionBody />,        // any JSX
 *       },
 *       ...
 *     ]}
 *     latestContent          // boolean (default true) — appends the live
 *                            // ProviderLatestContentPanel as the final section
 *   />
 *
 * @param {object} props
 * @param {string} props.provider - Provider key ('aws' | 'azure' | 'gcp' | 'finops' | 'terraform' | 'github' | ...).
 * @param {object} props.hero
 * @param {string} props.hero.eyebrow - Uppercase eyebrow label above the headline.
 * @param {React.ReactNode} props.hero.title - Display headline (use <span className="display-accent"> for the accent word).
 * @param {string|React.ReactNode} props.hero.description - Supporting paragraph.
 * @param {React.ReactNode} [props.hero.media] - Optional right-column hero media (carousel/illustration).
 * @param {{label: string, to: string}} [props.hero.cta] - Optional pill CTA; defaults to the provider blog.
 * @param {Array<{value: React.ReactNode, suffix?: string, label: string}>} [props.hero.stats] - Optional glassy stat blocks.
 * @param {Array<{eyebrow?: string, title: React.ReactNode, action?: {label: string, to: string}, content: React.ReactNode}>} [props.sections]
 * @param {boolean} [props.latestContent=true] - Append the live latest-content panel.
 */
function LandingHero({ hero, displayName, cta }) {
  return (
    <section className="relative grid lg:grid-cols-2 gap-10 items-center pt-8">
      <div className="flex flex-col gap-6">
        {hero?.eyebrow && <Eyebrow>{hero.eyebrow}</Eyebrow>}
        <h1 className="display-heading text-4xl sm:text-5xl lg:text-6xl text-slate-900 dark:text-white max-w-2xl">
          {hero?.title || displayName}
        </h1>
        {hero?.description && (
          <p className="text-base sm:text-lg text-slate-700 dark:text-(--subtitle-gray) max-w-xl leading-relaxed">
            {hero.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4 mt-2">
          <Link
            to={cta.to}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-7 py-3 text-[11px] font-semibold uppercase tracking-[0.24em] transition-opacity hover:opacity-90"
          >
            {cta.label}
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        </div>
        {Array.isArray(hero?.stats) && hero.stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6 max-w-lg">
            {hero.stats.map((stat) => (
              <StatBlock key={stat.label} value={stat.value} suffix={stat.suffix} label={stat.label} />
            ))}
          </div>
        )}
      </div>
      {hero?.media && (
        <div className="relative rounded-2xl overflow-hidden border border-glass-border min-h-64">
          {hero.media}
        </div>
      )}
    </section>
  );
}

export default function ProviderLandingTemplate({
  provider,
  hero,
  sections = [],
  latestContent = true,
}) {
  const config = useProviderConfig();
  const displayName = config?.displayName || config?.name || provider;
  const cta = hero?.cta || { label: `Explore ${config?.name || provider}`, to: routes.blog(provider) };

  return (
    <>
      <Helmet>
        <title>{`${displayName} Hub | Hybrid Cloud Works`}</title>
        {typeof hero?.description === 'string' && (
          <meta name="description" content={hero.description} />
        )}
      </Helmet>

      <main className="relative z-10 max-w-[1400px] mx-auto w-full px-4 md:px-8 py-10 flex flex-col gap-20 text-foreground">
        {/* Warm ambient glow wash + provider glow (decorative) */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[60vh] ambient-glow" />
          <div className="absolute -top-32 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full glow-primary blur-2xl" />
        </div>

        <LandingHero hero={hero} displayName={displayName} cta={cta} />

        {/* Numbered content sections */}
        {sections.map((section, index) => (
          <NumberedSection
            key={typeof section.title === 'string' ? section.title : index}
            number={index + 1}
            eyebrow={section.eyebrow}
            title={section.title}
            actions={
              section.action ? (
                <Link
                  to={section.action.to}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  {section.action.label}
                  <span className="material-symbols-outlined text-xs" aria-hidden="true">
                    arrow_forward
                  </span>
                </Link>
              ) : null
            }
          >
            {section.content}
          </NumberedSection>
        ))}

        {/* Live published content */}
        {latestContent && (
          <NumberedSection
            number={sections.length + 1}
            eyebrow="LIVE FROM THE FORGE"
            title="Latest Published Content"
          >
            <ProviderLatestContentPanel provider={provider} title="Latest Published Content" />
          </NumberedSection>
        )}
      </main>
    </>
  );
}
