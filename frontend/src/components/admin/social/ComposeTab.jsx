/**
 * Compose — pick a published page, choose Publer accounts, write a caption and
 * schedule or publish it (#575: the composer only, nothing else).
 *
 * It reads its own two lists. The account read and the live-pages read are
 * separate hooks with separate error states, so a Publer key that is missing
 * still leaves the page picker usable and a content read that fails still
 * leaves the accounts visible.
 */
import React, { useEffect, useState } from 'react';
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

  const handleGenerateCaption = async () => {
    if (!selectedContent) return;
    setGeneratingCaption(true);
    try {
      const result = await postJSON('generateSocialCaption', {
        contentId: selectedContent.id,
        platforms: selectedAccountIds,
        title: selectedContent.Title || selectedContent.title || '',
        summary: selectedContent.Summary || selectedContent.summary || '',
        sourceUrl: selectedContent.sourceUrl || '',
      });
      setCaption(result.caption || '');
    } catch (err) {
      toast({
        title: 'Caption generation failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setGeneratingCaption(false);
    }
  };

  const handleSchedule = async () => {
    const validationError = getScheduleValidationError({
      ready: publerConfigured,
      caption,
      selectedAccountIds,
    });
    if (validationError) {
      toast({
        title: validationError,
        description: getScheduleValidationDescription(validationError) || undefined,
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    setJobStatus(null);
    try {
      const { url, text } = composePostText(caption, selectedContent);
      const scheduledTime = scheduledAt ? new Date(scheduledAt).toISOString() : null;
      // `scheduled` either way. Publishing now is the other ENDPOINT, not
      // another state (#463 item 3).
      const bulk = {
        state: 'scheduled',
        posts: buildScheduledPosts({ selectedAccountIds, accounts, text, scheduledTime }),
      };

      const scheduleRes = await publerScheduleBulk(bulk, { immediate: !scheduledTime });
      // A refused schedule resolves rather than throwing, so without this the
      // next lines would save a social post for a Publer job that never was.
      if (scheduleRes?.ok === false) throw new Error(describePublerEnvelope(scheduleRes));

      if (scheduleRes?.data?.job_id) {
        setJobStatus('polling');
        await publerPollJob(scheduleRes.data.job_id);
      }

      // Save to the social_posts content container
      await saveSocialPost({
        contentId: selectedContent?.id || null,
        caption: caption.trim(),
        url: url || null,
        accountIds: selectedAccountIds,
        platforms: selectedAccountIds.map(
          (id) => accounts.find((a) => a.id === id)?.provider || id
        ),
        scheduledAt: scheduledTime || null,
        publerJobId: scheduleRes?.data?.job_id || null,
        status: scheduledTime ? 'scheduled' : 'published',
      });

      setJobStatus('done');
      toast({
        title: scheduledTime ? 'Scheduled via Publer!' : 'Published via Publer!',
        description: `Sent to ${selectedAccountIds.length} account(s).`,
      });
      setCaption('');
      setScheduledAt('');
      setSelectedAccountIds([]);
    } catch (err) {
      setJobStatus('error');
      toast({ title: 'Failed to schedule', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Content Picker */}
      <div className="space-y-4">
        <Label className="text-sm font-semibold block">1. Pick published content</Label>

        {!publerConfigured && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>Publer not fully configured.</strong> Check the Settings tab.
            </span>
          </div>
        )}

        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {loadingContent && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loadingContent && contentError && (
            <p className="text-sm text-destructive py-4 text-center" role="status">
              {contentError} The list is empty because the read failed, not because nothing is
              published.
            </p>
          )}
          {!loadingContent && !contentError && recentContent.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No published content found.
            </p>
          )}
          {recentContent.map((item) => {
            const title = item.Title || item.title || 'Untitled';
            const provider = item['Cloud Provider'] || item.cloudProvider || '';
            const isSelected = selectedContent?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectContent(item)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                  isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  {provider && <p className="text-xs text-muted-foreground">{provider}</p>}
                </div>
                {isSelected && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

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
