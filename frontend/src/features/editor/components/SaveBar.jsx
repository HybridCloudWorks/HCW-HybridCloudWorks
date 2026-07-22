import { ArrowLeft, Save, Loader2, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEditor } from '../context/EditorContext';

function formatLastSaved(date) {
  if (!date) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderSaveStatus({ saving, saveError, lastSaved }) {
  if (saving) {
    return (
      <>
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </>
    );
  }
  if (saveError) {
    return <span className="text-destructive">{saveError}</span>;
  }
  if (lastSaved) {
    return (
      <>
        <CheckCircle className="h-3 w-3 text-emerald-400" />
        Saved {formatLastSaved(lastSaved)}
      </>
    );
  }
  return null;
}

export function SaveBar({ navigate }) {
  const {
    blog,
    saving,
    publishing,
    lastSaved,
    saveError,
    publishError,
    externallyModified,
    setExternallyModified,
    setSaveError,
    handleSave,
    handlePublish,
    handleReloadRemote,
    isLiveOrPublished,
    currentTarget,
  } = useEditor();

  const status = blog?.contentStatus || '';
  const statusLabel = status.replace(/_/g, ' ') || 'unknown';

  return (
    <div className="flex flex-col border-b border-border bg-background z-10">
      {/* Conflict banner */}
      {externallyModified && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-200 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="flex-1">
            This document was modified remotely. Reload to get the latest version, or force-save to
            overwrite.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-amber-300 hover:text-amber-100"
            onClick={handleReloadRemote}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Reload
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-amber-300 hover:text-amber-100"
            onClick={() => {
              setExternallyModified(false);
              setSaveError(null);
              handleSave({ force: true });
            }}
          >
            Force Save
          </Button>
        </div>
      )}

      {/* Main toolbar */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Left: back + status */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize text-xs">
            {statusLabel}
          </Badge>
          {currentTarget && (
            <Badge variant="secondary" className="capitalize text-xs">
              {currentTarget}
            </Badge>
          )}
        </div>

        {/* Status message */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {renderSaveStatus({ saving, saveError, lastSaved })}
          {publishError && <span className="text-destructive ml-2">{publishError}</span>}
        </div>

        {/* Right: actions */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => handleSave()}
            disabled={saving || publishing}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}
            Save Draft
          </Button>

          {!isLiveOrPublished && (
            <Button
              size="sm"
              className="h-8"
              onClick={() => handlePublish('approved_blog')}
              disabled={saving || publishing}
            >
              {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {publishing ? 'Staging…' : 'Send to Publish'}
            </Button>
          )}

          {isLiveOrPublished && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => handlePublish()}
              disabled={saving || publishing}
            >
              {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {publishing ? 'Saving…' : 'Save Live'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
