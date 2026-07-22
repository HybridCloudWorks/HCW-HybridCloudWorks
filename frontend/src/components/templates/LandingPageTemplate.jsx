import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useProviderConfig } from '@/context/ProviderContext';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

/**
 * @param {string} providerName - Display name (e.g. "AWS")
 * @param {string} heroTitle - Main title
 * @param {string} heroDescription - Subtitle description
 * @param {Array} features - List of {icon, title, description, link}
 * @param {React.ReactNode} children - Custom sections to render
 */
export function LandingPageTemplate({
  providerName,
  heroTitle,
  heroDescription,
  heroSubtitle,
  features = [],
  primaryCTA,
  secondaryCTA,
  ctaSection,
  children,
}) {
  const { _theme, loading: configLoading } = useProviderConfig();

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-12">
      <Helmet>
        <title>{heroTitle} | HCW</title>
        <meta name="description" content={heroDescription} />
      </Helmet>

      {/* Hero Section */}
      <section className="text-left mb-16 space-y-6">
        <h2 className="text-accent-foreground uppercase tracking-widest text-sm font-semibold">
          {heroSubtitle || `${providerName} Hub`}
        </h2>
        <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent-foreground font-display leading-tight">
          {heroTitle}
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl">
          {heroDescription}
        </p>

        <div className="flex gap-4 justify-start pt-4">
          {primaryCTA && (
            <Button asChild size="lg" className="gap-2">
              <Link to={primaryCTA.href}>
                {primaryCTA.label} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
          {secondaryCTA && (
            <Button asChild variant="outline" size="lg">
              <Link to={secondaryCTA.href}>{secondaryCTA.label}</Link>
            </Button>
          )}
        </div>
      </section>

      {/* Features Grid */}
      {features.length > 0 && (
        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
          {features.map((feature, idx) => {
            const Icon = feature.icon || ArrowRight; // Fallback icon
            return (
              <Card
                key={idx}
                className="hover:border-primary/50 transition-colors bg-card/50 backdrop-blur-sm group cursor-pointer"
              >
                <CardHeader>
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <Icon className="h-6 w-6" />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">{feature.description}</p>
                  {feature.link && (
                    <Link
                      to={feature.link}
                      className="text-primary hover:underline text-sm font-medium flex items-center gap-1"
                    >
                      Learn more <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {/* Custom Children */}
      {children}

      {/* CTA Section */}
      {ctaSection && (
        <section className="rounded-2xl bg-gradient-to-br from-primary/10 to-transparent p-10 text-center border border-primary/20 mt-20">
          <h2 className="text-3xl font-bold mb-4">{ctaSection.title}</h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
            {ctaSection.description}
          </p>
          {ctaSection.cta && (
            <Button asChild size="lg">
              <Link to={ctaSection.cta.href}>{ctaSection.cta.label}</Link>
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

export default LandingPageTemplate;
