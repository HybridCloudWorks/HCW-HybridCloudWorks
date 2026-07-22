/* eslint-disable complexity */
import React, { useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Save,
  CheckCircle,
  Eye,
  Code,
  BookOpen,
  Layers,
  ExternalLink,
  Activity,
  Trash2,
} from 'lucide-react';
const FrameworkRadar = lazy(() => import('@/components/widgets/FrameworkRadar'));

/**
 * Framework Review Board
 * Specialized admin editor for "Framework" content type.
 * Includes "Next Level Interaction": Radar Chart scoring for pillars.
 */
export default function FrameworkReviewBoard({ blog, onSave, onPublish, onDelete, saving }) {
  const [formData, setFormData] = useState({
    title: blog.title || blog.Title || '',
    summary: blog.summary || blog.Summary || '',
    cloudProvider: blog.cloudProvider || blog['Cloud Provider'] || 'AWS',
    category: blog.category || 'Architecture',
    complexity: blog.complexity || 'Foundation',
    tags: blog.tags || blog.Tags || [],
    featured: blog.featured || false,
    docLink: blog.docLink || '',
    overviewHtml: blog.overviewHtml || blog.overview || '',
    commandExample: blog.commandExample || '',
    keyPillars: blog.keyPillars || [],
    frameworkConcepts:
      blog.frameworkConcepts || blog.frameworkConceptSeeds || blog.keyPillars || [],
    patterns: blog.patterns || [],
    architectureRecommendation: blog.architectureRecommendation || blog.recommendation || '',
    frameworkSourceUrls: blog.frameworkSourceUrls || blog.officialSources || [],
    frameworkKnowledgePrompt: blog.frameworkKnowledgePrompt || '',
    frameworkDiagramPrompt: blog.frameworkDiagramPrompt || '',
    frameworkImagePrompt: blog.frameworkImagePrompt || '',
    terraformCode: blog.terraformCode || '# IaC example',
    // Maturity Scoring
    maturityScores: blog.maturityScores || {
      Security: 3,
      Reliability: 3,
      Cost: 3,
      Operations: 3,
      Performance: 3,
      Sustainability: 3,
    },
  });

  const [activeTab, setActiveTab] = useState('overview');

  const handleChange = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const handleScoreChange = (pillar, value) => {
    setFormData((prev) => ({
      ...prev,
      maturityScores: {
        ...prev.maturityScores,
        [pillar]: value,
      },
    }));
  };

  // Prepare data for Radar Chart preview
  const radarData = {
    labels: Object.keys(formData.maturityScores),
    datasets: [
      {
        label: 'Maturity Level',
        data: Object.values(formData.maturityScores),
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 2,
      },
    ],
  };

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-6">
      {/* ── LEFT: PREVIEW & METADATA ───────────────────────────────────────── */}
      <div className="w-1/3 flex flex-col gap-4 overflow-y-auto pr-2">
        {/* Live Preview Card */}
        <Card className="bg-card/50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Eye className="h-4 w-4" /> Framework Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-[250px] mb-4">
              <Suspense
                fallback={
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Loading chart…
                  </div>
                }
              >
                <FrameworkRadar data={radarData} title="Maturity Model Preview" />
              </Suspense>
            </div>
          </CardContent>
        </Card>

        {/* Maturity Scoring Editor */}
        <Card className="bg-card/50 border-l-4 border-l-purple-500">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" /> Maturity Scoring
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(formData.maturityScores).map(([pillar, score]) => (
              <div key={pillar}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{pillar}</span>
                  <span className="font-mono">{score}/5</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={score}
                  onChange={(e) => handleScoreChange(pillar, parseInt(e.target.value))}
                  className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Metadata Card */}
        <Card className="bg-card/50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-muted-foreground">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label
                htmlFor="fw-cloud-provider"
                className="text-xs font-medium text-muted-foreground"
              >
                Cloud Provider
              </label>
              <select
                id="fw-cloud-provider"
                value={formData.cloudProvider}
                onChange={(e) => handleChange('cloudProvider', e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="AWS">AWS</option>
                <option value="Azure">Azure</option>
                <option value="GCP">GCP</option>
                <option value="FinOps">FinOps</option>
              </select>
            </div>
            {/* ... other metadata fields (complexity, category, etc) ... */}
            <div>
              <label htmlFor="fw-complexity" className="text-xs font-medium text-muted-foreground">
                Complexity
              </label>
              <select
                id="fw-complexity"
                value={formData.complexity}
                onChange={(e) => handleChange('complexity', e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="Foundation">Foundation</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>
            <div>
              <label htmlFor="fw-category" className="text-xs font-medium text-muted-foreground">
                Category
              </label>
              <Input
                id="fw-category"
                value={formData.category}
                onChange={(e) => handleChange('category', e.target.value)}
                className="mt-1 h-8"
                placeholder="Architecture, Security, FinOps..."
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── RIGHT: EDITOR ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* Title / Summary + Actions */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex-1 mr-4">
            <Input
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              className="text-xl font-bold border-none px-0 h-auto focus-visible:ring-0"
              placeholder="Framework Title"
            />
            <Input
              value={formData.summary}
              onChange={(e) => handleChange('summary', e.target.value)}
              className="text-sm text-muted-foreground border-none px-0 h-auto focus-visible:ring-0 mt-1"
              placeholder="Short description / executive summary..."
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="destructive" size="sm" onClick={() => onDelete?.()} disabled={saving}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <Button variant="outline" size="sm" onClick={() => onSave(formData)} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              Save Draft
            </Button>
            <Button size="sm" onClick={() => onPublish(formData)} disabled={saving}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Publish
            </Button>
          </div>
        </div>

        <Separator />

        {/* Editor Tabs */}
        <Tabs
          defaultValue="overview"
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">
              <BookOpen className="h-3 w-3 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="pillars">
              <Layers className="h-3 w-3 mr-2" />
              Pillars
            </TabsTrigger>
            <TabsTrigger value="implementation">
              <Code className="h-3 w-3 mr-2" />
              IaC
            </TabsTrigger>
            <TabsTrigger value="resources">
              <ExternalLink className="h-3 w-3 mr-2" />
              Resources
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 pr-2">
            {/* OVERVIEW */}
            <TabsContent value="overview" className="mt-0 h-full">
              <Card className="h-full">
                <CardContent className="h-full p-0">
                  <div className="p-4 space-y-4">
                    <Textarea
                      value={formData.overviewHtml}
                      onChange={(e) => handleChange('overviewHtml', e.target.value)}
                      className="w-full min-h-[260px] border-none resize-none p-0 font-mono text-sm"
                      placeholder="HTML overview content for the Overview tab..."
                    />
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">
                        Architecture Recommendation
                      </label>
                      <Textarea
                        value={formData.architectureRecommendation}
                        onChange={(e) => handleChange('architectureRecommendation', e.target.value)}
                        className="min-h-[90px] mt-2 text-sm"
                        placeholder="Recommendation pane content shown under concept selections."
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* PILLARS */}
            <TabsContent value="pillars" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Key Pillars</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={(formData.keyPillars || []).join('\n')}
                    onChange={(e) =>
                      handleChange('keyPillars', e.target.value.split('\n').filter(Boolean))
                    }
                    className="min-h-[150px] font-mono text-sm"
                    placeholder="Security&#10;Reliability&#10;Cost Optimization&#10;Operational Excellence&#10;Performance Efficiency"
                  />
                  <p className="text-xs text-muted-foreground mt-2">One pillar per line</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Architecture Patterns</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={(formData.patterns || []).join('\n')}
                    onChange={(e) =>
                      handleChange('patterns', e.target.value.split('\n').filter(Boolean))
                    }
                    className="min-h-[100px] font-mono text-sm"
                    placeholder="Event-Driven&#10;Microservices&#10;Multi-Region"
                  />
                  <p className="text-xs text-muted-foreground mt-2">One pattern per line</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Framework Concepts (Interactive Nodes)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={(formData.frameworkConcepts || []).join('\n')}
                    onChange={(e) =>
                      handleChange('frameworkConcepts', e.target.value.split('\n').filter(Boolean))
                    }
                    className="min-h-[130px] font-mono text-sm"
                    placeholder="Security posture&#10;Reliability guardrails&#10;Cost governance"
                  />
                  <p className="text-xs text-muted-foreground mt-2">One concept node per line</p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* IaC / IMPLEMENTATION */}
            <TabsContent value="implementation" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">CLI Command Example</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={formData.commandExample}
                    onChange={(e) => handleChange('commandExample', e.target.value)}
                    className="min-h-[80px] font-mono text-sm"
                    placeholder="aws wellarchitected list-workloads --region us-east-1"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between py-2">
                  <CardTitle className="text-sm">Terraform / IaC</CardTitle>
                  <Badge variant="outline">HCL</Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <Textarea
                    value={formData.terraformCode}
                    onChange={(e) => handleChange('terraformCode', e.target.value)}
                    className="w-full min-h-[300px] border-none resize-none p-4 font-mono text-sm bg-slate-950 text-slate-50"
                    placeholder="# Resource definitions..."
                    spellCheck={false}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* RESOURCES */}
            <TabsContent value="resources" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Official Documentation URL</CardTitle>
                </CardHeader>
                <CardContent>
                  <Input
                    value={formData.docLink}
                    onChange={(e) => handleChange('docLink', e.target.value)}
                    className="font-mono text-xs"
                    placeholder="https://docs.provider.com/framework/welcome.html"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    This appears on the Resources tab and the header button.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Official Source URLs</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={(formData.frameworkSourceUrls || []).join('\n')}
                    onChange={(e) =>
                      handleChange(
                        'frameworkSourceUrls',
                        e.target.value
                          .split('\n')
                          .map((item) => item.trim())
                          .filter(Boolean)
                      )
                    }
                    className="min-h-[120px] font-mono text-xs"
                    placeholder="https://learn.microsoft.com/...&#10;https://docs.aws.amazon.com/..."
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">AI/Scraping Prompt Metadata</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Knowledge Prompt
                    </label>
                    <Textarea
                      value={formData.frameworkKnowledgePrompt}
                      onChange={(e) => handleChange('frameworkKnowledgePrompt', e.target.value)}
                      className="min-h-[70px] mt-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Diagram Prompt
                    </label>
                    <Textarea
                      value={formData.frameworkDiagramPrompt}
                      onChange={(e) => handleChange('frameworkDiagramPrompt', e.target.value)}
                      className="min-h-[70px] mt-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Image Prompt
                    </label>
                    <Textarea
                      value={formData.frameworkImagePrompt}
                      onChange={(e) => handleChange('frameworkImagePrompt', e.target.value)}
                      className="min-h-[70px] mt-1 text-xs"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
