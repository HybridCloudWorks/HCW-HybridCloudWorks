/* eslint-disable complexity */
import React from 'react';
import RichTextBody from '@/components/shared/RichTextBody';
// Lazy: WafAssessment pulls chart.js (vendor-charts) via FrameworkRadar.
const WafAssessment = React.lazy(() => import('@/components/architecture/WafAssessment'));
import { Helmet } from 'react-helmet-async';
import { useParams, Link } from 'react-router';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicContentItem } from '@/lib/publicApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, ExternalLink, Code, Loader2 } from 'lucide-react';
import { awsArchitectures } from '@/data/architectures';
import InteractiveDiagram from '@/components/widgets/InteractiveDiagram';
import ContextSidebar from '@/components/layout/ContextSidebar';
import ShareVia from '@/components/shared/ShareVia';

/**
 * Detail page template for architecture designs.
 * Resolution (slug lookup, content then legacy blogs, published-only) is
 * folded into GET public/content/{slugOrId}; the type check stays client-side
 * so a blog sharing the slug can't render as an architecture. The static
 * awsArchitectures map remains the last-resort fallback.
 */
export default function ArchitectureDetailTemplate({ provider = 'aws' }) {
  const { slug } = useParams();

  const { data: item, loading } = usePublicData(
    () => fetchPublicContentItem(slug),
    slug ? `architecture:${slug}` : ''
  );

  // Static fallback for "Real Data Phase 1"
  const staticData = provider === 'aws' ? awsArchitectures[slug] : null;

  const dynamicArchitecture =
    item && String(item.type || '').toLowerCase() === 'architecture' ? item : null;
  const architecture = dynamicArchitecture || staticData;

  if (loading && !staticData && !architecture) {
    return (
      <div className="container mx-auto px-4 py-20 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!architecture) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-3xl font-bold mb-4">Architecture Not Found</h1>
        <p className="text-muted-foreground mb-6">
          The architecture you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button asChild>
          <Link to={`/${provider}/architecture-designs`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Architectures
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Helmet>
        <title>{`${architecture.title} | HCW`}</title>
        <meta name="description" content={architecture.description} />
        <link
          rel="canonical"
          href={`https://hybridcloudworks.com/${provider}/architecture-designs/${slug}`}
        />
        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={`${architecture.title} | HCW`} />
        <meta property="og:description" content={architecture.description} />
        <meta
          property="og:url"
          content={`https://hybridcloudworks.com/${provider}/architecture-designs/${slug}`}
        />
        {architecture.diagramUrl && <meta property="og:image" content={architecture.diagramUrl} />}
        {/* Twitter Card */}
        <meta
          name="twitter:card"
          content={architecture.diagramUrl ? 'summary_large_image' : 'summary'}
        />
        <meta name="twitter:title" content={`${architecture.title} | HCW`} />
        <meta name="twitter:description" content={architecture.description} />
        {architecture.diagramUrl && <meta name="twitter:image" content={architecture.diagramUrl} />}
      </Helmet>

      {/* Context Sidebar for Extras */}
      <ContextSidebar content={architecture.sidebarContent} />

      {/* Back Button */}
      <Button variant="ghost" asChild className="mb-6">
        <Link to={`/${provider}/architecture-designs`}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Architectures
        </Link>
      </Button>

      {/* Architecture Header */}
      <div className="mb-8">
        <div className="mb-6 flex justify-end">
          <ShareVia
            title={architecture.title || 'Architecture'}
            summary={architecture.summary || architecture.description || ''}
          />
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {architecture.category && <Badge variant="default">{architecture.category}</Badge>}
          {architecture.complexity && <Badge variant="secondary">{architecture.complexity}</Badge>}
          {architecture.tags?.map((tag, i) => (
            <Badge key={i} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 leading-tight">
          {architecture.title}
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-6">
          {architecture.description}
        </p>

        <div className="flex gap-3">
          <Button>
            <Download className="h-4 w-4 mr-2" />
            Download Diagram
          </Button>
          <Button variant="outline">
            <Code className="h-4 w-4 mr-2" />
            View IaC Code
          </Button>
          <Button variant="outline">
            <ExternalLink className="h-4 w-4 mr-2" />
            Live Demo
          </Button>
        </div>
      </div>

      <Separator className="my-8" />

      {/* Architecture Content */}
      <Tabs defaultValue="diagram" className="mb-12">
        <TabsList className={`grid w-full ${architecture.waf ? 'grid-cols-5' : 'grid-cols-4'}`}>
          <TabsTrigger value="diagram">Diagram</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {architecture.waf && <TabsTrigger value="waf">Well-Architected</TabsTrigger>}
          <TabsTrigger value="implementation">Implementation</TabsTrigger>
          <TabsTrigger value="cost">Cost Analysis</TabsTrigger>
        </TabsList>

        {architecture.waf && (
          <TabsContent value="waf" className="mt-6">
            <React.Suspense
              fallback={<p className="text-sm text-muted-foreground">Loading assessment…</p>}
            >
              <WafAssessment waf={architecture.waf} />
            </React.Suspense>
          </TabsContent>
        )}

        <TabsContent value="diagram" className="mt-6">
          <Card className="bg-card/40 border-none shadow-none">
            <CardContent className="p-0">
              {architecture.diagramUrl ? (
                <InteractiveDiagram
                  imageUrl={architecture.diagramUrl}
                  hotspots={architecture.hotspots || []}
                  onHotspotClick={() => {}}
                />
              ) : (
                <div className="aspect-video bg-muted/20 rounded-lg flex items-center justify-center border border-dashed border-border">
                  <p className="text-muted-foreground">
                    Architecture diagram will be displayed here
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overview" className="mt-6">
          <div className="prose prose-invert max-w-none">
            {architecture.overview ? (
              <RichTextBody value={architecture.overview} />
            ) : (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">Architecture Overview</h2>
                <p className="text-muted-foreground">
                  Detailed architecture overview will be loaded from Firestore, including:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Key components and services</li>
                  <li>Data flow and communication patterns</li>
                  <li>Security and compliance considerations</li>
                  <li>Scalability and performance characteristics</li>
                </ul>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="implementation" className="mt-6">
          <div className="space-y-6">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Terraform Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted/20 p-4 rounded-lg overflow-x-auto">
                  <code className="text-sm">
                    {architecture.terraformCode ||
                      '# Terraform code will be loaded from Firestore\n# Example infrastructure as code implementation'}
                  </code>
                </pre>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Deployment Steps</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>Configure provider credentials</li>
                  <li>Initialize Terraform workspace</li>
                  <li>Review and apply infrastructure plan</li>
                  <li>Verify deployment and test endpoints</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cost" className="mt-6">
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">Estimated Monthly Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">
                  {architecture.estimatedCost || '$500-$2,000'}
                </p>
                <p className="text-sm text-muted-foreground mt-2">Based on moderate usage</p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">Cost Optimization</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li>• Use Reserved Instances</li>
                  <li>• Enable auto-scaling</li>
                  <li>• Implement caching layers</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">Cost Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Compute</span>
                    <span className="font-semibold">60%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Storage</span>
                    <span className="font-semibold">25%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Networking</span>
                    <span className="font-semibold">15%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Related Architectures */}
      {architecture.relatedArchitectures && architecture.relatedArchitectures.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-6">Related Architectures</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {architecture.relatedArchitectures.map((related, i) => (
              <Card key={i} className="bg-card/40 hover:bg-card/60 transition-all">
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-2">{related.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {related.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
