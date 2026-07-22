import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * 1. Provider Landing Pattern
 * Large Hero + Wavy/Diagonal Graphic + Features Grid + Resource Sections
 */
export function ProviderLanding({
  provider,
  title,
  titleText,
  subtitle,
  description,
  primaryCTA,
  secondaryCTA,
  features = [],
  children,
}) {
  const isTitleTextValid = typeof titleText === 'string' && titleText.trim();
  const isTitleValid = typeof title === 'string' && title.trim();
  const helmetTitleFallback = isTitleValid ? title : provider;
  const helmetTitle = isTitleTextValid ? titleText : helmetTitleFallback;

  return (
    <div className={`theme-${provider.toLowerCase()} min-h-screen pt-20 pb-20`}>
      <Helmet>
        <title>{helmetTitle} | HCW</title>
      </Helmet>

      {/* Hero Section */}
      <section className="relative px-4 mb-24 overflow-hidden pt-12">
        <div className="max-w-[1600px] mx-auto text-left relative z-10 px-4 md:px-8">
          <Badge
            variant="outline"
            className="mb-6 px-4 py-1 border-primary/50 text-primary backdrop-blur-md"
          >
            {subtitle}
          </Badge>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black mb-6 tracking-tight leading-tight font-display">
            HybridCloudWorks | {title}
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-slate-900 dark:text-white max-w-2xl mb-10 leading-relaxed">
            {description}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-start">
            {primaryCTA && (
              <Button
                asChild
                size="xl"
                className="h-14 px-8 text-lg text-white hover:shadow-[0_0_30px_-5px_hsl(var(--primary)/0.5)]"
              >
                <Link to={primaryCTA.href}>
                  {primaryCTA.label} <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            )}
            {secondaryCTA && (
              <Button
                asChild
                variant="secondary"
                size="xl"
                className="h-14 px-8 text-lg bg-white/80 dark:bg-slate-900/70 border-primary/40 text-slate-900 dark:text-white backdrop-blur-sm hover:bg-white dark:hover:bg-slate-900"
              >
                <Link to={secondaryCTA.href}>{secondaryCTA.label}</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Pattern Specific Graphics (Placeholder for actual SVG wavy graphics) */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none -z-10 opacity-20">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/30 rounded-full blur-[160px]"></div>
        </div>
      </section>

      <div className="max-w-[1600px] mx-auto px-4 md:px-8">
        {/* Features Hubs Grid */}
        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-24">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <Link key={i} to={feature.link} className="group block">
                <Card className="h-full glass-card hover:border-primary/50 transition-all duration-300 transform hover:-translate-y-1">
                  <CardHeader>
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                      {Icon && <Icon className="h-6 w-6" />}
                    </div>
                    <CardTitle className="text-xl mb-2">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-slate-900 dark:text-white text-sm leading-relaxed mb-4">
                      {feature.description}
                    </p>
                    <div className="flex items-center text-primary text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                      Explore Details <ChevronRight className="ml-1 h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>

        {children}
      </div>
    </div>
  );
}

/**
 * 2. Architecture Gallery Pattern
 * Multi-column grid of architecture cards with filtering
 */
export function ArchitectureGallery({ title, description, designs = [] }) {
  return (
    <section className="py-20">
      <div className="mb-12">
        <h2 className="text-3xl font-bold mb-4">{title}</h2>
        <p className="text-slate-900 dark:text-white">{description}</p>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {designs.map((design, i) => (
          <Card key={i} className="glass-card overflow-hidden group">
            <div className="aspect-video bg-muted relative overflow-hidden">
              {/* Architecture Preview Placeholder */}
              <div className="absolute inset-0 flex items-center justify-center opacity-40">
                <span className="font-mono text-xs">ARCHITECTURE DIAGRAM</span>
              </div>
              <div className="absolute inset-0 bg-primary/10 group-hover:bg-primary/20 transition-colors"></div>
            </div>
            <CardHeader>
              <CardTitle className="text-lg">{design.title}</CardTitle>
              <div className="flex gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {design.category}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-900 dark:text-white line-clamp-2 mb-4">
                {design.description}
              </p>
              <Button variant="ghost" className="w-full text-primary hover:bg-primary/10">
                View Blueprint
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * 3. Blog Feed Pattern
 */
export function BlogFeed({ title, items = [] }) {
  return (
    <section className="py-20">
      <h2 className="text-2xl font-bold mb-8">{title}</h2>
      <div className="space-y-6">
        {items.map((post, i) => (
          <Card
            key={i}
            className="glass-card hover:border-primary/40 transition-colors group cursor-pointer"
          >
            <div className="flex flex-col md:flex-row gap-6 p-6">
              <div className="h-24 w-full md:w-40 bg-muted rounded-lg shrink-0"></div>
              <div className="flex-grow">
                <div className="flex gap-2 mb-2">
                  <Badge className="bg-primary/20 text-primary border-0">{post.tag}</Badge>
                  <span className="text-xs text-slate-900 dark:text-white">{post.date}</span>
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
                  {post.title}
                </h3>
                <p className="text-sm text-slate-900 dark:text-white line-clamp-2">
                  {post.excerpt}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
