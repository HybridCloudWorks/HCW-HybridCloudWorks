/**
 * Stage 2: source URLs, supporting documents, and the generate-draft button.
 *
 * The machinery behind every handler here is in draftStage.js (#636); this is
 * only the markup.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, Link2, X } from 'lucide-react';
import { isSupportedDocumentUrl } from './draftStage';

/**
 * One removable entry: a label, an optional subtitle, and an X.
 *
 * Stage 2 drew this three times — for files, document URLs and KB articles —
 * with only the remove handler differing between the last two.
 */
function RemovableRow({ label, subtitle, onRemove }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="truncate font-medium">{label}</p>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      <Button
        type="button"
        variant="destructive"
        size="icon"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** The bordered box those rows sit in, or nothing when the list is empty. */
function RemovableList({ title, items, children }) {
  if (items.length === 0) return null;
  const rows = <div className="space-y-2">{items.map(children)}</div>;
  if (!title) return rows;
  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3">
      <Label className="text-xs">{title}</Label>
      {rows}
    </div>
  );
}

/** The five extra fields a framework draft carries and no other type does. */
function FrameworkFields({
  frameworkSourceUrls,
  setFrameworkSourceUrls,
  frameworkKnowledgePrompt,
  setFrameworkKnowledgePrompt,
  frameworkDiagramPrompt,
  setFrameworkDiagramPrompt,
  frameworkImagePrompt,
  setFrameworkImagePrompt,
  frameworkConceptSeeds,
  setFrameworkConceptSeeds,
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="space-y-2 md:col-span-2">
        <Label className="text-xs">Official Framework Source URLs</Label>
        <Textarea
          value={frameworkSourceUrls}
          onChange={(e) => setFrameworkSourceUrls(e.target.value)}
          placeholder="https://learn.microsoft.com/...&#10;https://docs.aws.amazon.com/..."
          className="min-h-25 text-xs font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Firecrawl/AI ingestion metadata source list. One URL per line.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Knowledge Prompt</Label>
        <Textarea
          value={frameworkKnowledgePrompt}
          onChange={(e) => setFrameworkKnowledgePrompt(e.target.value)}
          placeholder="Extract principles, controls, implementation guidance, and measurable outcomes."
          className="min-h-22.5 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Diagram Prompt</Label>
        <Textarea
          value={frameworkDiagramPrompt}
          onChange={(e) => setFrameworkDiagramPrompt(e.target.value)}
          placeholder="Generate node relationships for an interactive framework map."
          className="min-h-22.5 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Image Prompt</Label>
        <Textarea
          value={frameworkImagePrompt}
          onChange={(e) => setFrameworkImagePrompt(e.target.value)}
          placeholder="Visual style prompt for framework hero/diagram imagery."
          className="min-h-20 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Concept Seeds</Label>
        <Textarea
          value={frameworkConceptSeeds}
          onChange={(e) => setFrameworkConceptSeeds(e.target.value)}
          placeholder="Security posture&#10;Reliability guardrails&#10;Cost governance"
          className="min-h-20 text-xs"
        />
      </div>
    </div>
  );
}

export default function StageTwoCard({
  contentType,
  draftInstructionPrompt,
  setDraftInstructionPrompt,
  supportingDocuments,
  handleSupportingDocumentUpload,
  removeSupportingDocument,
  kbDocumentUrl,
  setKbDocumentUrl,
  kbDocumentUrls,
  addKbDocumentUrl,
  removeKbDocumentUrl,
  sourceUrl,
  setSourceUrl,
  kbArticleUrls,
  addKbArticleUrl,
  removeKbArticleUrl,
  handleSubmitDraft,
  submittingDraft,
  draftReady,
  frameworkSourceUrls,
  setFrameworkSourceUrls,
  frameworkKnowledgePrompt,
  setFrameworkKnowledgePrompt,
  frameworkDiagramPrompt,
  setFrameworkDiagramPrompt,
  frameworkImagePrompt,
  setFrameworkImagePrompt,
  frameworkConceptSeeds,
  setFrameworkConceptSeeds,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stage 2: URL Submission</CardTitle>
        <CardDescription>
          Combine a source URL, optional supporting files, and an editable instruction prompt to
          generate a more tailored in-memory draft.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border p-3 space-y-3">
          {contentType === 'framework' && (
            <FrameworkFields
              frameworkSourceUrls={frameworkSourceUrls}
              setFrameworkSourceUrls={setFrameworkSourceUrls}
              frameworkKnowledgePrompt={frameworkKnowledgePrompt}
              setFrameworkKnowledgePrompt={setFrameworkKnowledgePrompt}
              frameworkDiagramPrompt={frameworkDiagramPrompt}
              setFrameworkDiagramPrompt={setFrameworkDiagramPrompt}
              frameworkImagePrompt={frameworkImagePrompt}
              setFrameworkImagePrompt={setFrameworkImagePrompt}
              frameworkConceptSeeds={frameworkConceptSeeds}
              setFrameworkConceptSeeds={setFrameworkConceptSeeds}
            />
          )}

          <div
            className={contentType === 'framework' ? 'pt-2 border-t border-border space-y-3' : ''}
          >
            <div className="space-y-2">
              <Label className="text-xs">Optional Tailoring Prompt</Label>
              <Textarea
                value={draftInstructionPrompt}
                onChange={(e) => setDraftInstructionPrompt(e.target.value)}
                placeholder="Adjust how the AI should generate the draft."
                className="min-h-30 text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Prefilled with the current Stage 2 draft-generation prompt. Edit it to steer the
                generated title, summary, content, and image prompts.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">
                Supporting Documents Upload (PDF or TXT, combined total up to 5)
              </Label>
              <Input
                type="file"
                accept=".pdf,.txt,text/plain,application/pdf"
                multiple
                onChange={handleSupportingDocumentUpload}
              />
              <p className="text-xs text-muted-foreground">
                Local files stay in memory for this builder session and are sent with the URL on
                submit. Use this as the backup path for private or non-hosted files.
              </p>
            </div>

            <RemovableList title="Files in Memory" items={supportingDocuments}>
              {(doc) => (
                <RemovableRow
                  key={doc.id}
                  label={doc.name}
                  subtitle={`${doc.kind.toUpperCase()} · ${Math.max(1, Math.round(doc.size / 1024))} KB`}
                  onRemove={() => removeSupportingDocument(doc.id)}
                />
              )}
            </RemovableList>

            <div className="space-y-2 rounded-md border border-border/70 p-3">
              <Label className="text-xs">KB Document URLs</Label>
              <div className="flex flex-col lg:flex-row gap-2">
                <Input
                  value={kbDocumentUrl}
                  onChange={(e) => setKbDocumentUrl(e.target.value)}
                  placeholder="https://.../reference.pdf"
                  type="url"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addKbDocumentUrl}
                  disabled={!isSupportedDocumentUrl(kbDocumentUrl)}
                  className="gap-1"
                >
                  <Link2 className="h-4 w-4" />
                  Add Document URL
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Public PDF/TXT URLs are fetched server-side at submit time. Use this for hosted
                documents larger than the local upload limit.
              </p>
              <RemovableList items={kbDocumentUrls}>
                {(url) => (
                  <RemovableRow key={url} label={url} onRemove={() => removeKbDocumentUrl(url)} />
                )}
              </RemovableList>
            </div>
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <Label className="text-xs">Article URL</Label>
            <div className="flex flex-col lg:flex-row gap-2">
              <Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                type="url"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addKbArticleUrl}
                disabled={!sourceUrl.trim().startsWith('http')}
                className="gap-1"
              >
                <Link2 className="h-4 w-4" />
                Add URL
              </Button>
              <Button
                type="button"
                onClick={handleSubmitDraft}
                disabled={
                  submittingDraft ||
                  (kbArticleUrls.length === 0 && !sourceUrl.trim().startsWith('http'))
                }
                className="gap-1"
              >
                {submittingDraft ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {draftReady ? 'Regenerate' : 'Submit'}
              </Button>
            </div>
            <RemovableList title="KB Articles" items={kbArticleUrls}>
              {(url) => (
                <RemovableRow key={url} label={url} onRemove={() => removeKbArticleUrl(url)} />
              )}
            </RemovableList>
            <p className="text-xs text-muted-foreground">
              Submit generates AI title, summary, content draft (~3000 words target), and both
              prompts in memory using the added KB articles and optional supporting documents. Use
              it again any time to regenerate with updated URLs, KB articles, files, or prompt.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
