/* eslint-disable complexity -- the initial form state reads every legacy spelling of every field */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Eye, Code, DollarSign, Layers, FileText, Plus, Trash2, MousePointer } from 'lucide-react';
import InteractiveDiagram from '@/components/widgets/InteractiveDiagram';
import DiagramSourcePanel from '@/components/admin/architecture/DiagramSourcePanel';
import ReviewBoardShell from '@/components/admin/ReviewBoardShell';
import { useResolvedHotspots } from '@/hooks/useResolvedHotspots';

/**
 * Architecture Review Board
 * Specialized editor for "Blueprints" content type.
 * Includes interactive hotspot management for diagrams.
 *
 * The two-column chrome (title, summary, Save / Publish, tabs) is
 * ReviewBoardShell, shared with the Framework board (ADR 0033 §2); this file
 * is the blueprint's own fields.
 */
export default function ArchitectureReviewBoard({ blog, onSave, onPublish, saving, error }) {
  const [formData, setFormData] = useState({
    title: blog.title || blog.Title || '',
    summary: blog.summary || blog.Summary || '',
    cloudProvider: blog.cloudProvider || blog['Cloud Provider'] || 'AWS',
    category: blog.category || 'Compute',
    complexity: blog.complexity || 'Medium',
    tags: blog.tags || blog.Tags || [],
    overviewHtml: blog.overviewHtml || blog.overview || '',
    diagramUrl: blog.diagramUrl || blog.contentImageUrl || blog.imageUrl || '',
    // JSON fields (stored as objects in DB, parsed for editing if needed)
    technicalSpecs: blog.technicalSpecs || { components: [], patterns: [] },
    costAnalysis: blog.costAnalysis || { estimatedMonthly: '$0', breakdown: [] },
    terraformCode: blog.terraformCode || '# Terraform HCL',
    deploymentSteps: blog.deploymentSteps || [],
    // Hotspots for interactive diagram. A hotspot is either shape-anchored
    // ({shapeId}) or hand-positioned ({x, y}); both render, and the diagram
    // source below is what makes the first kind resolvable.
    hotspots: blog.hotspots || [],
    diagramXml: blog.diagramXml || '',
  });

  // The preview resolves hotspots the same way the public page does. An admin
  // positioning a pin against different maths than the visitor sees is
  // authoring blind.
  const previewHotspots = useResolvedHotspots(formData.diagramXml, formData.hotspots);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleNestedChange = (parent, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [parent]: { ...prev[parent], [field]: value },
    }));
  };

  // Hotspot Management
  const addHotspot = () => {
    const newHotspot = {
      id: Date.now(),
      x: 50,
      y: 50,
      label: 'New Component',
      description: 'Description of this component',
      link: '',
    };
    setFormData((prev) => ({ ...prev, hotspots: [...prev.hotspots, newHotspot] }));
  };

  /**
   * Pin a hotspot to a draw.io shape.
   *
   * No x/y is stored: the position is derived from the diagram on every render,
   * so editing the diagram moves the pin instead of stranding it.
   */
  const addShapeHotspot = ({ shapeId, label }) => {
    setFormData((prev) =>
      prev.hotspots.some((h) => h.shapeId === shapeId)
        ? prev
        : {
            ...prev,
            hotspots: [
              ...prev.hotspots,
              { id: `shape-${shapeId}`, shapeId, label, description: '', link: '' },
            ],
          }
    );
  };

  const updateHotspot = (id, field, value) => {
    setFormData((prev) => ({
      ...prev,
      hotspots: prev.hotspots.map((h) => (h.id === id ? { ...h, [field]: value } : h)),
    }));
  };

  const removeHotspot = (id) => {
    setFormData((prev) => ({
      ...prev,
      hotspots: prev.hotspots.filter((h) => h.id !== id),
    }));
  };

  const aside = (
    <>
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Eye className="h-4 w-4" /> Blueprint Diagram
          </CardTitle>
        </CardHeader>
        <CardContent>
          {formData.diagramUrl ? (
            <div className="border border-dashed border-border rounded-lg overflow-hidden bg-muted/20">
              <InteractiveDiagram imageUrl={formData.diagramUrl} hotspots={previewHotspots} />
            </div>
          ) : (
            <div className="aspect-video bg-muted/20 rounded-lg flex items-center justify-center border border-dashed border-border">
              <p className="text-xs text-muted-foreground">No diagram URL</p>
            </div>
          )}

          <label htmlFor="arch-diagram-url" className="sr-only">
            Diagram URL
          </label>
          <Input
            id="arch-diagram-url"
            value={formData.diagramUrl}
            onChange={(e) => handleChange('diagramUrl', e.target.value)}
            className="mt-4 text-xs font-mono"
            placeholder="https://..."
          />
        </CardContent>
      </Card>

      <DiagramSourcePanel
        diagramXml={formData.diagramXml}
        hotspots={formData.hotspots}
        onDiagramXmlChange={(xml) => handleChange('diagramXml', xml)}
        onAddHotspot={addShapeHotspot}
      />

      {/* Hotspots Editor */}
      <Card className="bg-card/50 border-l-4 border-l-blue-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex justify-between items-center">
            <span className="flex items-center gap-2">
              <MousePointer className="h-4 w-4" /> Interactive Hotspots
            </span>
            <Button size="xs" variant="outline" onClick={addHotspot} className="h-6">
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {formData.hotspots.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No hotspots defined yet.</p>
          )}
          {formData.hotspots.map((spot, index) => (
            <div
              key={spot.id}
              className="p-3 bg-background/50 rounded border border-border space-y-2"
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold bg-blue-500/20 text-blue-500 px-1.5 rounded">
                  #{index + 1}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 text-destructive"
                  onClick={() => removeHotspot(spot.id)}
                  aria-label={`Remove hotspot ${index + 1}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <Input
                value={spot.label}
                onChange={(e) => updateHotspot(spot.id, 'label', e.target.value)}
                placeholder="Label"
                aria-label={`Hotspot ${index + 1} label`}
                className="h-7 text-xs"
              />
              {spot.shapeId ? (
                // Position is derived from the diagram, so there is nothing
                // to type. Showing the coordinates as editable fields would
                // invite an edit that the next render silently discards.
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  Pinned to shape {spot.shapeId}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label
                      htmlFor={`hotspot-${spot.id}-x`}
                      className="text-[10px] text-muted-foreground"
                    >
                      X %
                    </label>
                    <Input
                      type="number"
                      id={`hotspot-${spot.id}-x`}
                      value={spot.x}
                      onChange={(e) => updateHotspot(spot.id, 'x', Number(e.target.value))}
                      className="h-6 text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`hotspot-${spot.id}-y`}
                      className="text-[10px] text-muted-foreground"
                    >
                      Y %
                    </label>
                    <Input
                      type="number"
                      id={`hotspot-${spot.id}-y`}
                      value={spot.y}
                      onChange={(e) => updateHotspot(spot.id, 'y', Number(e.target.value))}
                      className="h-6 text-xs"
                    />
                  </div>
                </div>
              )}
              <Textarea
                value={spot.description}
                onChange={(e) => updateHotspot(spot.id, 'description', e.target.value)}
                placeholder="Description..."
                aria-label={`Hotspot ${index + 1} description`}
                className="text-xs min-h-15"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Audit / Metadata Card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-muted-foreground">Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="cloudProvider" className="text-xs font-medium text-muted-foreground">
              Cloud Provider
            </label>
            <select
              id="cloudProvider"
              value={formData.cloudProvider}
              onChange={(e) => handleChange('cloudProvider', e.target.value)}
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="AWS">AWS</option>
              <option value="Azure">Azure</option>
              <option value="GCP">GCP</option>
            </select>
          </div>
          <div>
            <label htmlFor="complexity" className="text-xs font-medium text-muted-foreground">
              Complexity
            </label>
            <select
              id="complexity"
              value={formData.complexity}
              onChange={(e) => handleChange('complexity', e.target.value)}
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
          <div>
            <label htmlFor="category" className="text-xs font-medium text-muted-foreground">
              Category
            </label>
            <Input
              id="category"
              value={formData.category}
              onChange={(e) => handleChange('category', e.target.value)}
              className="mt-1 h-8"
            />
          </div>
        </CardContent>
      </Card>
    </>
  );

  const tabs = [
    {
      value: 'overview',
      label: 'Overview',
      icon: FileText,
      className: 'mt-0 h-full',
      content: (
        <Card className="h-full">
          <CardContent className="h-full p-0">
            <label htmlFor="arch-overview" className="sr-only">
              HTML overview
            </label>
            <Textarea
              id="arch-overview"
              value={formData.overviewHtml}
              onChange={(e) => handleChange('overviewHtml', e.target.value)}
              className="w-full h-full min-h-100 border-none resize-none p-4 font-mono text-sm"
              placeholder="HTML Overview..."
            />
          </CardContent>
        </Card>
      ),
    },
    {
      value: 'techspecs',
      label: 'Tech Specs',
      icon: Layers,
      content: (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Key Components</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={(formData.technicalSpecs?.components || []).join('\n')}
                onChange={(e) =>
                  handleNestedChange('technicalSpecs', 'components', e.target.value.split('\n'))
                }
                aria-label="Key components, one per line"
                className="min-h-37.5 font-mono text-sm"
                placeholder="AWS Lambda&#10;Amazon SNS&#10;DynamoDB"
              />
              <p className="text-xs text-muted-foreground mt-2">One component per line</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Architecture Patterns</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={(formData.technicalSpecs?.patterns || []).join('\n')}
                onChange={(e) =>
                  handleNestedChange('technicalSpecs', 'patterns', e.target.value.split('\n'))
                }
                aria-label="Architecture patterns, one per line"
                className="min-h-25 font-mono text-sm"
                placeholder="Event-Driven&#10;Fan-Out"
              />
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      value: 'cost',
      label: 'Cost Analysis',
      icon: DollarSign,
      content: (
        <>
          <Card>
            <CardContent className="pt-6">
              <label htmlFor="estimatedCost" className="text-sm font-medium">
                Estimated Monthly Cost
              </label>
              <Input
                id="estimatedCost"
                value={formData.costAnalysis?.estimatedMonthly || ''}
                onChange={(e) =>
                  handleNestedChange('costAnalysis', 'estimatedMonthly', e.target.value)
                }
                className="mt-1"
                placeholder="$500 - $800"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cost Breakdown (JSON)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={JSON.stringify(formData.costAnalysis?.breakdown || [], null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    handleNestedChange('costAnalysis', 'breakdown', parsed);
                  } catch {
                    // Allow typing invalid JSON temporarily
                  }
                }}
                aria-label="Cost breakdown as JSON"
                className="min-h-50 font-mono text-xs"
              />
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      value: 'iac',
      label: 'Infrastructure',
      icon: Code,
      className: 'mt-0 h-full',
      content: (
        <Card className="h-full">
          <CardHeader className="flex flex-row items-center justify-between py-2">
            <CardTitle className="text-sm">Terraform / HCL</CardTitle>
            <Badge variant="outline">HCL</Badge>
          </CardHeader>
          <CardContent className="h-full p-0">
            <Textarea
              value={formData.terraformCode}
              onChange={(e) => handleChange('terraformCode', e.target.value)}
              aria-label="Terraform code"
              className="w-full h-full min-h-100 border-none resize-none p-4 font-mono text-sm bg-slate-950 text-slate-50"
              placeholder="# Resource definitions..."
              spellCheck={false}
            />
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <ReviewBoardShell
      title={formData.title}
      summary={formData.summary}
      onTitleChange={(value) => handleChange('title', value)}
      onSummaryChange={(value) => handleChange('summary', value)}
      titlePlaceholder="Blueprint Title"
      summaryPlaceholder="Executive Summary..."
      saving={saving}
      error={error}
      onSave={() => onSave(formData)}
      onPublish={() => onPublish(formData)}
      aside={aside}
      tabs={tabs}
    />
  );
}
