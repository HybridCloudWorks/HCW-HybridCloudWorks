/**
 * Compose — pick a published page, choose Publer accounts, write a caption and
 * schedule or publish it (#575: the composer only, nothing else).
 *
 * It reads its own two lists. The account read and the live-pages read are
 * separate hooks with separate error states, so a Publer key that is missing
 * still leaves the page picker usable and a content read that fails still
 * leaves the accounts visible.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { AlertCircle, CheckCircle, Loader2, Sparkles } from 'lucide-react';
import { postJSON } from '@/lib/api';
import {
  describePublerEnvelope,
  publerPollJob,
  publerReady,
  publerScheduleBulk,
  saveSocialPost,
} from './publerApi';
import {
  buildScheduledPosts,
  getScheduleValidationDescription,
  getScheduleValidationError,
  getSelectedContentUrl,
} from './socialView';
import { AccountToggle, PublerAccountsNotice, ScheduleButtonContent } from './shared';
import usePublerAccounts from './usePublerAccounts';
import useRecentContent from './useRecentContent';

/** The caption Publer is sent: the operator's text, then the page's URL. */
function composePostText(caption, selectedContent) {
  const url = getSelectedContentUrl(selectedContent);
  return { url, text: url ? `${caption.trim()}\n\n${url}` : caption.trim() };
}

/**
 * Ask the model for a caption, and paint it.
 *
 * Module-level over one state bag, with a single exit — the shape
 * `useCertifications` documents and the reason ComposeTab stays inside Qlty's
 * function-complexity budget. Qlty counts a closure's branches into the
 * function that holds it, so a handler defined inside the component is the
 * component's complexity; defined here it is its own.
 */
async function runCaption(state, selectedContent, selectedAccountIds) {
  if (!selectedContent) return;
  state.setGeneratingCaption(true);
  try {
    const result = await postJSON('generateSocialCaption', {
      contentId: selectedContent.id,
      platforms: selectedAccountIds,
      title: selectedContent.Title || selectedContent.title || '',
      summary: selectedContent.Summary || selectedContent.summary || '',
      sourceUrl: selectedContent.sourceUrl || '',
    });
    state.setCaption(result.caption || '');
  } catch (err) {
    state.toast({
      title: 'Caption generation failed',
      description: err.message,
      variant: 'destructive',
    });
  } finally {
    state.setGeneratingCaption(false);
  }
}

/**
 * Send the post to Publer, then record it.
 *
 * Unchanged from the one-page version in every respect that reaches Publer:
 * `scheduled` either way, because publishing now is the other ENDPOINT rather
 * than another state (#463 item 3), and a refused schedule RESOLVES, so the
 * `ok === false` test below is what keeps a social-post record from being
 * written for a job that never was.
 */
async function sendToPubler(form) {
  const { caption, scheduledAt, selectedAccountIds, accounts, selectedContent } = form;
  const { url, text } = composePostText(caption, selectedContent);
  const scheduledTime = scheduledAt ? new Date(scheduledAt).toISOString() : null;
  const bulk = {
    state: 'scheduled',
    posts: buildScheduledPosts({ selectedAccountIds, accounts, text, scheduledTime }),
  };

  const scheduleRes = await publerScheduleBulk(bulk, { immediate: !scheduledTime });
  if (scheduleRes?.ok === false) throw new Error(describePublerEnvelope(scheduleRes));
  return { scheduleRes, scheduledTime, url };
}

/**
 * The hub's own record of a post Publer accepted.
 *
 * `status` is what the operator asked for, not what Publer has done yet: a post
 * with a time is `scheduled` until the timer sweeps it, and one without is
 * already `published` because the immediate endpoint sent it.
 */
async function recordPost(form, scheduleRes, scheduledTime, url) {
  const platformOf = (id) => form.accounts.find((a) => a.id === id)?.provider || id;
  return saveSocialPost({
    contentId: form.selectedContent?.id || null,
    caption: form.caption.trim(),
    url: url || null,
    accountIds: form.selectedAccountIds,
    platforms: form.selectedAccountIds.map(platformOf),
    scheduledAt: scheduledTime || null,
    publerJobId: scheduleRes?.data?.job_id || null,
    status: scheduledTime ? 'scheduled' : 'published',
  });
}

/** Validate, send, record and report. One exit. */
async function runSchedule(state, form) {
  const validationError = getScheduleValidationError({
    ready: publerReady(),
    caption: form.caption,
    selectedAccountIds: form.selectedAccountIds,
  });
  if (validationError) {
    state.toast({
      title: validationError,
      description: getScheduleValidationDescription(validationError) || undefined,
      variant: 'destructive',
    });
    return;
  }

  state.setSubmitting(true);
  state.setJobStatus(null);
  try {
    const { scheduleRes, scheduledTime, url } = await sendToPubler(form);
    if (scheduleRes?.data?.job_id) {
      state.setJobStatus('polling');
      await publerPollJob(scheduleRes.data.job_id);
    }
    await recordPost(form, scheduleRes, scheduledTime, url);
    state.setJobStatus('done');
    state.toast({
      title: scheduledTime ? 'Scheduled via Publer!' : 'Published via Publer!',
      description: `Sent to ${form.selectedAccountIds.length} account(s).`,
    });
    state.reset();
  } catch (err) {
    state.setJobStatus('error');
    state.toast({ title: 'Failed to schedule', description: err.message, variant: 'destructive' });
  } finally {
    state.setSubmitting(false);
  }
}

/** One published page in the picker. */
function ContentRow({ item, selected, onSelect }) {
  const provider = item['Cloud Provider'] || item.cloudProvider || '';
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
        selected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50'
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.Title || item.title || 'Untitled'}</p>
        {provider && <p className="text-xs text-muted-foreground">{provider}</p>}
      </div>
      {selected && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
    </button>
  );
}

/**
 * Step 1 — the published pages this post can be about, with its own loading and
 * error states. Its own component because the composer beside it is a separate
 * duty: together they put ComposeTab over Qlty's function-complexity budget,
 * and "pick a thing" and "write about the thing" are the natural seam.
 */
function ContentPicker({ items, loading, error, configured, selectedId, onSelect }) {
  return (
    <div className="space-y-4">
      <Label className="text-sm font-semibold block">1. Pick published content</Label>

      {!configured && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>Publer not fully configured.</strong> Check the Settings tab.
          </span>
        </div>
      )}

      <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-destructive py-4 text-center" role="status">
            {error} The list is empty because the read failed, not because nothing is published.
          </p>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No published content found.
          </p>
        )}
        {items.map((item) => (
          <ContentRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

export default function ComposeTab({ ready = true, contentId = '' }) {
  const { toast } = useToast();
  const publerConfigured = publerReady();
  const { accounts, status: accountsStatus, error: accountsError, reason } = usePublerAccounts();
  const {
    items: recentContent,
    loading: loadingContent,
    error: contentError,
  } = useRecentContent(ready);

  const [selectedContent, setSelectedContent] = useState(null);
  const [caption, setCaption] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobStatus, setJobStatus] = useState(null); // null | 'polling' | 'done' | 'error'

  // The setters the two module-level handlers write through. A bag rather than
  // arguments so adding a field to the form does not re-thread every call.
  const state = useMemo(
    () => ({
      setCaption,
      setGeneratingCaption,
      setSubmitting,
      setJobStatus,
      toast,
      reset: () => {
        setCaption('');
        setScheduledAt('');
        setSelectedAccountIds([]);
      },
    }),
    [toast]
  );

  // Preselect content when deep-linked from the publish flow
  // (?tab=compose&contentId=...).
  useEffect(() => {
    if (!contentId) return;
    const match = recentContent.find((item) => item.id === contentId);
    if (match) {
      queueMicrotask(() => {
        setSelectedContent(match);
      });
    }
  }, [contentId, recentContent]);

  const toggleAccount = (id) =>
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleSelectContent = (item) => {
    setSelectedContent(item);
    setCaption('');
    setJobStatus(null);
  };

  const handleGenerateCaption = () => runCaption(state, selectedContent, selectedAccountIds);

  const handleSchedule = () =>
    runSchedule(state, { caption, scheduledAt, selectedAccountIds, accounts, selectedContent });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ContentPicker
        items={recentContent}
        loading={loadingContent}
        error={contentError}
        configured={publerConfigured}
        selectedId={selectedContent?.id}
        onSelect={handleSelectContent}
      />

      {/* Right: Composer */}
      <div className="space-y-4">
        {/* Step 2 — Account picker */}
        <div>
          <Label className="text-sm font-semibold block mb-2">2. Choose Publer accounts</Label>
          {accounts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => (
                <AccountToggle
                  key={a.id}
                  account={a}
                  selected={selectedAccountIds}
                  onToggle={toggleAccount}
                />
              ))}
            </div>
          ) : (
            <PublerAccountsNotice status={accountsStatus} error={accountsError} reason={reason} />
          )}
        </div>

        {/* Step 3 — Caption */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">3. Write your caption</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleGenerateCaption}
              disabled={!selectedContent || generatingCaption}
              className="text-xs h-7 gap-1.5"
            >
              {generatingCaption ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              AI Caption
            </Button>
          </div>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write your post caption here…"
            className="min-h-32 resize-none"
          />
          <p className="text-xs text-muted-foreground mt-1 text-right">{caption.length} chars</p>
        </div>

        {/* Step 4 — Schedule time */}
        <div>
          <Label className="text-sm font-semibold block mb-2">4. Schedule (optional)</Label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">Leave blank to post immediately.</p>
        </div>

        {/* Job status feedback */}
        {jobStatus === 'polling' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Waiting for Publer to process…
          </div>
        )}
        {jobStatus === 'done' && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle className="h-4 w-4" /> Done! Post queued in Publer.
          </div>
        )}

        <Button
          onClick={handleSchedule}
          disabled={submitting || !caption.trim() || selectedAccountIds.length === 0}
          className="w-full gap-2"
        >
          <ScheduleButtonContent
            submitting={submitting}
            jobStatus={jobStatus}
            scheduledAt={scheduledAt}
          />
        </Button>
      </div>
    </div>
  );
}
