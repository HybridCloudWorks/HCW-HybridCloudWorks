/* eslint-disable complexity -- the initial form state reads every legacy spelling of every field */
import React, { useState, lazy, Suspense } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Eye, Code, BookOpen, Layers, ExternalLink, Activity } from 'lucide-react';
import ReviewBoardShell from '@/components/admin/ReviewBoardShell';
const FrameworkRadar = lazy(() => import('@/components/widgets/FrameworkRadar'));

/**
 * Framework Review Board
 * Specialized admin editor for "Framework" content type.
 * Includes "Next Level Interaction": Radar Chart scoring for pillars.
 *
 * The two-column chrome (title, summary, Delete / Save / Publish, tabs) is
 * ReviewBoardShell, shared with the Architecture board (ADR 0033 §2); this
 * file is the framework's own fields.
 */
export default function FrameworkReviewBoard({ blog, onSave, onPublish, onDelete, saving, error }) {
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

  const aside = (
    <>
      {/* Live Preview Card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Eye className="h-4 w-4" /> Framework Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-62.5 mb-4">
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
                <label htmlFor={`fw-score-${pillar}`}>{pillar}</label>
                <span className="font-mono">{score}/5</span>
              </div>
              <input
                id={`fw-score-${pillar}`}
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
    </>
  );

  const lines = (field) => (formData[field] || []).join('\n');
  const setLines = (field) => (e) =>
    handleChange(
      field,
      e.target.value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
    );

  const tabs = [
    {
      value: 'overview',
      label: 'Overview',
      icon: BookOpen,
      className: 'mt-0 h-full',
      content: (
        <Card className="h-full">
          <CardContent className="h-full p-0">
            <div className="p-4 space-y-4">
              <label htmlFor="fw-overview" className="sr-only">
                HTML overview
              </label>
              <Textarea
                id="fw-overview"
                value={formData.overviewHtml}
                onChange={(e) => handleChange('overviewHtml', e.target.value)}
                className="w-full min-h-65 border-none resize-none p-0 font-mono text-sm"
                placeholder="HTML overview content for the Overview tab..."
              />
              <div>
                <label
                  htmlFor="framework-architecture-recommendation"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Architecture Recommendation
                </label>
                <Textarea
                  id="framework-architecture-recommendation"
                  value={formData.architectureRecommendation}
                  onChange={(e) => handleChange('architectureRecommendation', e.target.value)}
                  className="min-h-22.5 mt-2 text-sm"
                  placeholder="Recommendation pane content shown under concept selections."
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      value: 'pillars',
      label: 'Pillars',
      icon: Layers,
      content: (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Key Pillars</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={lines('keyPillars')}
                onChange={(e) =>
                  handleChange('keyPillars', e.target.value.split('\n').filter(Boolean))
                }
                aria-label="Key pillars, one per line"
                className="min-h-37.5 font-mono text-sm"
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
                value={lines('patterns')}
                onChange={(e) =>
                  handleChange('patterns', e.target.value.split('\n').filter(Boolean))
                }
                aria-label="Architecture patterns, one per line"
                className="min-h-25 font-mono text-sm"
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
                value={lines('frameworkConcepts')}
                onChange={(e) =>
                  handleChange('frameworkConcepts', e.target.value.split('\n').filter(Boolean))
                }
                aria-label="Framework concepts, one per line"
                className="min-h-32.5 font-mono text-sm"
                placeholder="Security posture&#10;Reliability guardrails&#10;Cost governance"
              />
              <p className="text-xs text-muted-foreground mt-2">One concept node per line</p>
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      value: 'implementation',
      label: 'IaC',
      icon: Code,
      content: (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">CLI Command Example</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={formData.commandExample}
                onChange={(e) => handleChange('commandExample', e.target.value)}
                aria-label="CLI command example"
                className="min-h-20 font-mono text-sm"
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
                aria-label="Terraform code"
                className="w-full min-h-75 border-none resize-none p-4 font-mono text-sm bg-slate-950 text-slate-50"
                placeholder="# Resource definitions..."
                spellCheck={false}
              />
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      value: 'resources',
      label: 'Resources',
      icon: ExternalLink,
      content: (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Official Documentation URL</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                value={formData.docLink}
                onChange={(e) => handleChange('docLink', e.target.value)}
                aria-label="Official documentation URL"
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
                value={lines('frameworkSourceUrls')}
                onChange={setLines('frameworkSourceUrls')}
                aria-label="Official source URLs, one per line"
                className="min-h-30 font-mono text-xs"
                placeholder="https://learn.microsoft.com/...&#10;https://docs.aws.amazon.com/..."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">AI/Scraping Prompt Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ['frameworkKnowledgePrompt', 'framework-knowledge-prompt', 'Knowledge Prompt'],
                ['frameworkDiagramPrompt', 'framework-diagram-prompt', 'Diagram Prompt'],
                ['frameworkImagePrompt', 'framework-image-prompt', 'Image Prompt'],
              ].map(([field, id, label]) => (
                <div key={field}>
                  <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                    {label}
                  </label>
                  <Textarea
                    id={id}
                    value={formData[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    className="min-h-17.5 mt-1 text-xs"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ),
    },
  ];

  return (
    <ReviewBoardShell
      title={formData.title}
      summary={formData.summary}
      onTitleChange={(value) => handleChange('title', value)}
      onSummaryChange={(value) => handleChange('summary', value)}
      titlePlaceholder="Framework Title"
      summaryPlaceholder="Short description / executive summary..."
      saving={saving}
      error={error}
      onSave={() => onSave(formData)}
      onPublish={() => onPublish(formData)}
      onDelete={onDelete ? () => onDelete() : undefined}
      aside={aside}
      tabs={tabs}
    />
  );
}
