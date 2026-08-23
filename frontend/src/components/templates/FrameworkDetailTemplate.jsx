/* eslint-disable complexity */
import React, { lazy, Suspense } from 'react';
import RichTextBody from '@/components/shared/RichTextBody';
import { Helmet } from 'react-helmet-async';
import { useParams, Link } from 'react-router';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicContentItem } from '@/lib/publicApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, ExternalLink, Code, Loader2, BookOpen, Layers } from 'lucide-react';
const FrameworkRadar = lazy(() => import('@/components/widgets/FrameworkRadar'));
import ContextSidebar from '@/components/layout/ContextSidebar';
import ShareVia from '@/components/shared/ShareVia';

/**
 * Detail page template for framework entries.
 * Resolution (slug lookup, content then legacy blogs, published-only) is
 * folded into GET public/content/{slugOrId}; the type check stays client-side
 * so a blog sharing the slug can't render as a framework.
 * Tabs: Overview | Pillars | Implementation (CLI + IaC) | Resources (docs)
 */
export default function FrameworkDetailTemplate({ provider = 'aws' }) {
  const { slug } = useParams();

  const { data: item, loading } = usePublicData(
    () => fetchPublicContentItem(slug),
    slug ? `framework:${slug}` : ''
  );

  const framework = item && String(item.type || '').toLowerCase() === 'framework' ? item : null;
  // The server 404s anything non-public, so a returned document is live.
  const isFrameworkLive = Boolean(framework);

  if (loading && !framework) {
    return (
      <div className="container mx-auto px-4 py-20 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!framework || !isFrameworkLive) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-3xl font-bold mb-4">Framework Not Found</h1>
        <p className="text-muted-foreground mb-6">
          The framework you&apos;re looking for doesn&apos;t exist or hasn&apos;t been published
          yet.
        </p>
        <Button asChild>
          <Link to={`/${provider}/frameworks`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Frameworks
          </Link>
        </Button>
      </div>
    );
  }

  // Prepare radar data
  const maturityScores = framework.maturityScores || {
    Security: 3,
    Reliability: 3,
    Cost: 3,
    Operations: 3,
    Performance: 3,
    Sustainability: 3,
  };
  const radarData = {
    labels: Object.keys(maturityScores),
    datasets: [
      {
        label: 'Maturity Level',
        data: Object.values(maturityScores),
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 2,
      },
    ],
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Helmet>
        <title>{framework.title} | HCW</title>
        <meta name="description" content={framework.summary || framework.description} />
      </Helmet>

      {/* Sidebar for extras */}
      <ContextSidebar content={framework.sidebarContent || ''} />

      {/* Back */}
      <Button variant="ghost" asChild className="mb-6">
        <Link to={`/${provider}/frameworks`}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Frameworks
        </Link>
      </Button>

      {/* Header */}
      <div className="mb-8">
        <div className="mb-6 flex justify-end">
          <ShareVia
            title={framework.title || 'Framework'}
            summary={framework.summary || framework.description || ''}
          />
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {framework.category && <Badge variant="default">{framework.category}</Badge>}
          {framework.complexity && <Badge variant="secondary">{framework.complexity}</Badge>}
          {(framework.tags || []).map((tag, i) => (
            <Badge key={i} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 leading-tight">
          {framework.title}
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-6">
          {framework.summary || framework.description}
        </p>

        <div className="flex gap-3 flex-wrap">
          {framework.docLink && (
            <Button asChild>
              <a href={framework.docLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Official Docs
              </a>
            </Button>
          )}
          <Button variant="outline">
            <Code className="h-4 w-4 mr-2" />
            View IaC Example
          </Button>
          <Button variant="outline">
            <BookOpen className="h-4 w-4 mr-2" />
            Assessment Checklist
          </Button>
        </div>
      </div>

      <Separator className="my-8" />

      {/* Content Tabs */}
      <Tabs defaultValue="overview" className="mb-12">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pillars">Pillars</TabsTrigger>
          <TabsTrigger value="implementation">Implementation</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 prose prose-invert max-w-none">
              {framework.overviewHtml || framework.postContent || framework.blogDraft ? (
                <RichTextBody
                  value={framework.overviewHtml || framework.postContent || framework.blogDraft}
                />
              ) : (
                <div className="space-y-4">
                  <h2 className="text-2xl font-bold">Framework Overview</h2>
                  <p className="text-muted-foreground">
                    {framework.summary || framework.description}
                  </p>
                  <div className="grid md:grid-cols-2 gap-4 mt-6">
                    <Card className="bg-card/40">
                      <CardHeader>
                        <CardTitle className="text-base">What It Covers</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                          <li>Architecture design principles</li>
                          <li>Operational best practices</li>
                          <li>Security and compliance guidance</li>
                          <li>Cost optimization strategies</li>
                        </ul>
                      </CardContent>
                    </Card>
                    <Card className="bg-card/40">
                      <CardHeader>
                        <CardTitle className="text-base">Target Audience</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                          <li>Cloud architects</li>
                          <li>Solution engineers</li>
                          <li>DevOps / platform teams</li>
                          <li>Technical leadership</li>
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </div>

            {/* Dynamic Widget */}
            <div className="md:col-span-1">
              <div className="sticky top-28">
                <Suspense
                  fallback={
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                      Loading chart…
                    </div>
                  }
                >
                  <FrameworkRadar data={radarData} title="Maturity Model" />
                </Suspense>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── PILLARS ── */}
        <TabsContent value="pillars" className="mt-6">
          <div className="space-y-4">
            {framework.keyPillars && framework.keyPillars.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-4">
                {framework.keyPillars.map((pillar, i) => (
                  <Card key={i} className="bg-card/40">
                    <CardContent className="flex items-start gap-3 pt-6">
                      <Layers className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <p className="font-semibold">{pillar}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-card/40">
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-sm">
                    Framework pillars will be populated from the review board.
                  </p>
                </CardContent>
              </Card>
            )}

            {framework.patterns && framework.patterns.length > 0 && (
              <>
                <h3 className="text-xl font-bold mt-8 mb-4">Architecture Patterns</h3>
                <div className="grid md:grid-cols-3 gap-4">
                  {framework.patterns.map((pattern, i) => (
                    <Card key={i} className="bg-card/40">
                      <CardContent className="pt-4 pb-4">
                        <p className="text-sm font-medium">{pattern}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>
        </TabsContent>

        {/* ── IMPLEMENTATION ── */}
        <TabsContent value="implementation" className="mt-6 space-y-6">
          {framework.commandExample && (
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-base">CLI Command Reference</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted/20 p-4 rounded-lg overflow-x-auto">
                  <code className="text-sm font-mono">{framework.commandExample}</code>
                </pre>
              </CardContent>
            </Card>
          )}
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle className="text-base">IaC Example</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto">
                <code className="text-sm font-mono">
                  {framework.terraformCode || '# IaC example will be added via the review board.'}
                </code>
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── RESOURCES ── */}
        <TabsContent value="resources" className="mt-6">
          {framework.docLink ? (
            <Card className="bg-card/40 hover:bg-card/60 transition-colors">
              <CardContent className="flex items-center justify-between pt-6">
                <div>
                  <p className="font-semibold">Official Documentation</p>
                  <p className="text-sm text-muted-foreground truncate max-w-md">
                    {framework.docLink}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={framework.docLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/40">
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">
                  No resources linked yet. Add via the review board.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
