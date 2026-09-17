/**
 * Stage 1: the global options every later stage reads (#634).
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { CONTENT_TYPE_OPTIONS } from './contentBlocks';
import {
  PROVIDER_OPTIONS_WITH_AUTO as PROVIDER_OPTIONS,
  BLOG_LANDING_ZONE_OPTIONS,
} from '@/config/admin';
import { getPublishTargetLabel } from './pageMeta';

export default function StageOneCard({
  provider,
  setProvider,
  inferredProvider,
  hasProviderMismatch,
  contentType,
  setContentType,
  blogLandingProvider,
  setBlogLandingProvider,
  resolvedBlogLandingProvider,
  title,
  setTitle,
  publishedDate,
  setPublishedDate,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stage 1: Global Options</CardTitle>
        <CardDescription>Set content metadata and ingestion defaults.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Cloud Provider</Label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {inferredProvider && !provider && (
            <p className="text-xs text-muted-foreground mt-1">
              Auto-detected from URL: {inferredProvider}
            </p>
          )}
          {hasProviderMismatch && (
            <p className="text-xs text-destructive mt-1">
              Selected provider differs from URL signal ({inferredProvider}).
            </p>
          )}
        </div>

        <div>
          <Label className="text-xs">Content Type</Label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {CONTENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label className="text-xs">Publish Target</Label>
          <Input value={`${getPublishTargetLabel(contentType)} (locked)`} disabled />
        </div>

        <div>
          <Label className="text-xs">Blog Landing Zone</Label>
          <select
            value={blogLandingProvider}
            onChange={(e) => setBlogLandingProvider(e.target.value)}
            disabled={contentType !== 'blog'}
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            {BLOG_LANDING_ZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            {contentType === 'blog'
              ? `Subpage destination: /${(resolvedBlogLandingProvider || 'provider').toLowerCase()}/blog`
              : 'Landing zone applies to blog content only.'}
          </p>
        </div>

        <div>
          <Label className="text-xs">Title (optional prefill)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional title seed"
          />
        </div>

        <div>
          <Label className="text-xs">Published Date</Label>
          <Input
            value={publishedDate}
            onChange={(e) => setPublishedDate(e.target.value)}
            type="date"
          />
        </div>
      </CardContent>
    </Card>
  );
}
