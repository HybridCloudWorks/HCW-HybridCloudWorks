/* eslint-disable complexity, no-nested-ternary */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { getCoverImageUrl, formatPostDate } from '@/lib/blogUtils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ExternalLink,
  Newspaper,
  PenSquare,
  XCircle,
  Loader2,
  Eye,
  Wand2,
  Image as ImageIcon,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  Calendar,
  Save,
} from 'lucide-react';
import { postJSON } from '@/lib/api';
import { PROVIDER_OPTIONS } from '@/config/admin';
import { logAdminAction } from '@/lib/auditLog';
import { toDate } from '@/lib/dateUtils';
import { getContentPublicPath, getPublishTargetForItem } from '@/lib/contentModel';
import {
  unpublishToInspected,
  requestContentInspection,
  saveContentSchedule,
  resetContentReviewState,
} from '@/lib/contentWorkflow';
import { ImageOrderManager } from '@/components/admin/ImageOrderManager';
import { ImageGalleryPicker } from '@/components/admin/ImageGalleryPicker';
import { getOrderedContentImages } from '@/lib/contentImages';
import { resolveMediaUrl } from '../../lib/functionsBase';

const getStatusLabel = (status, isLive = false) => {
  if (!status) return 'reviewed';
  if (status === 'ingested') return 'reviewed';
  if (status.startsWith('published_')) return isLive ? 'published' : 'ready to publish';
  if (status === 'ready_to_publish') return 'ready to publish';
  return status.replace(/_/g, ' ');
};

const toLocalDateInputValue = (value) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * BlogReviewBoard — full review UI for standard blog content items.
 * Handles all state, Firestore writes, and Cloud Function calls internally.
 *
 * @param {{ blog: object, blogId: string }} props
 */
export default function BlogReviewBoard({ blog, blogId }) {
  const navigate = useNavigate();

  const [notes, setNotes] = useState('');
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const [transitioning, setTransitioning] = useState(null);
  const [transitionError, setTransitionError] = useState(null);

  // UI expand/collapse state
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [originalExpanded, setOriginalExpanded] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [expandedImage, setExpandedImage] = useState('');
  const [coverTriggerPending, setCoverTriggerPending] = useState(false);
  const [coverTriggerMessage, setCoverTriggerMessage] = useState(null);
  const [reviewImages, setReviewImages] = useState([]);
  const [savingImages, setSavingImages] = useState(false);

  // Scheduling state
  const [instantPublish, setInstantPublish] = useState(true);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState(null);

  // Provider picker
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);

  // Key topics
  const [newTopic, setNewTopic] = useState('');
  const [keyTopics, setKeyTopics] = useState([]);

  // Sync state from blog data
  useEffect(() => {
    const timer = setTimeout(() => {
      if (blog?.altCoverImagePrompt) setImagePrompt(blog.altCoverImagePrompt);
    }, 0);
    return () => clearTimeout(timer);
  }, [blog]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setReviewImages(getOrderedContentImages(blog));
    }, 0);
    return () => clearTimeout(timer);
  }, [blog]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyTopics(Array.isArray(blog?.keyTopics) ? blog.keyTopics : []);
    }, 0);
    return () => clearTimeout(timer);
  }, [blog]);

  useEffect(() => {
    if (blog?.altCoverImageTrigger === true) return undefined;
    const timer = setTimeout(() => {
      if (blog?.altCoverImageGeneratedAt || blog?.altCoverImageError) {
        setCoverTriggerPending(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [blog?.altCoverImageError, blog?.altCoverImageGeneratedAt, blog?.altCoverImageTrigger]);

  useEffect(() => {
    if (!blog) return undefined;
    const timer = setTimeout(() => {
      // `toDate`, not `.toDate()`. `scheduledPublishDate` is an ISO string
      // since the migration, and calling the Firestore Timestamp method on it
      // threw — inside a setTimeout, so outside the error boundary, blanking
      // the review page for any scheduled item (TODO.md T-303). A null here
      // now falls through to the same default as an unscheduled item rather
      // than taking the page down.
      const date = toDate(blog.scheduledPublishDate);
      if (date) {
        setInstantPublish(false);
        setScheduledDate(toLocalDateInputValue(date));
        setScheduledTime(date.toTimeString().split(' ')[0].substring(0, 5));
      } else {
        setInstantPublish(true);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        setScheduledDate(toLocalDateInputValue(tomorrow));
        setScheduledTime('09:00');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [blog]);

  const handleSaveSchedule = async () => {
    setScheduleMessage(null);
    setSavingSchedule(true);
    try {
      if (instantPublish) {
        await saveContentSchedule({
          contentId: blogId,
          instantPublish: true,
          publishTarget: getPublishTargetForItem(blog),
        });
      } else {
        if (!scheduledDate || !scheduledTime) {
          setScheduleMessage({ type: 'error', text: 'Please enter both a date and time.' });
          return;
        }
        const [year, month, day] = scheduledDate.split('-').map(Number);
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        const scheduleDateTime = new Date(year, month - 1, day, hours, minutes);

        if (isNaN(scheduleDateTime.getTime())) {
          setScheduleMessage({ type: 'error', text: 'Invalid date or time format.' });
          return;
        }
        if (scheduleDateTime <= new Date()) {
          setScheduleMessage({ type: 'error', text: 'Scheduled date must be in the future.' });
          return;
        }

        await saveContentSchedule({
          contentId: blogId,
          instantPublish: false,
          scheduledPublishDate: scheduleDateTime.toISOString(),
          publishTarget: getPublishTargetForItem(blog),
        });
      }

      await logAdminAction('schedule_saved', {
        contentId: blogId,
        instantPublish,
        scheduledDate: instantPublish ? null : scheduledDate,
      });
      setScheduleMessage({ type: 'success', text: 'Schedule saved successfully.' });
      setTimeout(() => setScheduleMessage(null), 4000);
    } catch (err) {
      console.error('Failed to save schedule:', err);
      setScheduleMessage({ type: 'error', text: `Failed to save schedule: ${err.message}` });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleTransition = useCallback(
    async (newStatus) => {
      setTransitioning(newStatus);
      setTransitionError(null);
      try {
        await postJSON('transitionContentStatus', {
          contentId: blogId,
          newStatus,
          publishTarget: getPublishTargetForItem(blog),
          reviewNotes: notesRef.current,
        });
        await logAdminAction('status_transition', { contentId: blogId, newStatus });
        // The parent's data hook refetches on demand — state updates on reload
      } catch (err) {
        setTransitionError(err.message);
      } finally {
        setTransitioning(null);
      }
    },
    [blog, blogId]
  );

  const handleTriggerInspect = async () => {
    try {
      await requestContentInspection(blogId);
    } catch (err) {
      setTransitionError(err.message);
    }
  };

  const handleTriggerCover = async () => {
    setTransitionError(null);
    setCoverTriggerMessage(null);
    setCoverTriggerPending(true);
    try {
      await postJSON('triggerAiImageGeneration', {
        contentIds: [blogId],
        aiImageTargets: ['hero'],
        imagePromptSeed: imagePrompt.trim(),
      });
      setCoverTriggerMessage(
        'AI cover regeneration queued. The Images panel will update when the new file is ready.'
      );
    } catch (err) {
      setCoverTriggerPending(false);
      setTransitionError(err.message);
    }
  };

  const handleResetStatus = async () => {
    try {
      await resetContentReviewState(blogId);
    } catch (err) {
      setTransitionError(err.message);
    }
  };

  const handleSelectProvider = async (providerValue) => {
    setProviderSaving(true);
    try {
      await postJSON('updateContentItem', {
        contentId: blogId,
        updates: {
          cloudProvider: providerValue,
          'Cloud Provider': providerValue,
        },
      });
      setProviderPickerOpen(false);
    } catch (err) {
      setTransitionError(err.message);
    } finally {
      setProviderSaving(false);
    }
  };

  const persistTopics = async (nextTopics) => {
    try {
      setKeyTopics(nextTopics);
      await postJSON('updateContentItem', {
        contentId: blogId,
        updates: { keyTopics: nextTopics },
      });
    } catch (err) {
      setTransitionError(err.message);
    }
  };

  const handleRemoveTopic = async (topicToRemove) => {
    await persistTopics(keyTopics.filter((t) => t !== topicToRemove));
  };

  const handleAddTopic = async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const topic = newTopic.trim();
    if (!topic || keyTopics.includes(topic)) {
      setNewTopic('');
      return;
    }
    setNewTopic('');
    await persistTopics([...keyTopics, topic]);
  };

  const handleReviewImageReorder = (nextImages) => {
    setReviewImages(nextImages);
  };

  const handleRemoveReviewImage = (index) => {
    setReviewImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleAttachReviewImage = (item) => {
    const imageUrl = String(item?.imageUrl || '').trim();
    if (!imageUrl) return;
    setReviewImages((prev) =>
      prev.some((entry) => entry.url === imageUrl)
        ? prev
        : [
            ...prev,
            {
              id: `${blogId}-${Date.now()}-${imageUrl}`,
              url: imageUrl,
              label: `Secondary ${prev.length}`,
              sourceLabel: 'Gallery',
            },
          ].slice(0, 4)
    );
  };

  const handleSaveReviewImages = async () => {
    setSavingImages(true);
    try {
      await postJSON('saveContentImageOrder', {
        contentId: blogId,
        imageUrls: reviewImages.map((image) => image.url),
      });
      await logAdminAction('review_images_saved', {
        contentId: blogId,
        imageCount: reviewImages.length,
      });
    } catch (err) {
      setTransitionError(err.message);
    } finally {
      setSavingImages(false);
    }
  };

  // Derived display values
  const status = blog.contentStatus || 'ingested';
  const title = blog.Title || blog.title || 'Untitled';
  const coverUrl = getCoverImageUrl(blog);
  const content = blog.content || blog.Content || '';
  const sourceUrl = blog.sourceUrl || blog['CD Url'] || blog.url || '';
  const selectedProvider = blog['Cloud Provider'] || blog.cloudProvider || '';
  const hasProvider = Boolean(selectedProvider && selectedProvider !== 'Unknown');
  const showProviderOptions = providerPickerOpen || !hasProvider;
  const isPublishedLive = blog.Live === true;
  const statusLabel = getStatusLabel(status, isPublishedLive);
  const explicitPublishedUrl =
    blog.slugPageUrl || blog.publishedUrl || blog.blogUrl || blog.publicUrl || '';
  const computedPublishedUrl = getContentPublicPath(blog);
  const displayUrl = isPublishedLive ? explicitPublishedUrl || computedPublishedUrl || '' : '';
  const isCoverGenerating = blog.altCoverImageTrigger === true || coverTriggerPending;
  const imagePromptPreview =
    imagePrompt.trim() ||
    blog.altCoverImagePrompt ||
    'AI prompt will be generated from this content.';
  const secondaryImageUrls = Array.isArray(blog.secondaryImageUrls) ? blog.secondaryImageUrls : [];
  const heroHistory = Array.isArray(blog.aiImageHistory?.hero)
    ? [...blog.aiImageHistory.hero].filter(Boolean).reverse()
    : [];
  const imageSlots = [
    {
      key: 'hero',
      label: 'Hero Cover',
      url: blog.aiImageUrls?.hero || blog.altCoverImage || blog.heroImageUrl || '',
      prompt: imagePromptPreview,
      isGenerating: isCoverGenerating,
      error: blog.altCoverImageError || '',
    },
    {
      key: 'content',
      label: 'Content Image',
      url: blog.aiImageUrls?.content || blog.contentImageUrl || '',
      prompt: 'Content image not yet generated.',
      isGenerating: false,
      error: '',
    },
    {
      key: 'secondary-1',
      label: 'Secondary Image 1',
      url: blog.aiImageUrls?.secondary1 || secondaryImageUrls[0] || '',
      prompt: 'Secondary image not yet generated.',
      isGenerating: false,
      error: '',
    },
    {
      key: 'secondary-2',
      label: 'Secondary Image 2',
      url: blog.aiImageUrls?.secondary2 || secondaryImageUrls[1] || '',
      prompt: 'Secondary image not yet generated.',
      isGenerating: false,
      error: '',
    },
    ...heroHistory
      .filter(
        (url) => url !== (blog.aiImageUrls?.hero || blog.altCoverImage || blog.heroImageUrl || '')
      )
      .slice(0, 2)
      .map((url, index) => ({
        key: `hero-history-${index}`,
        label: `Previous Hero ${index + 1}`,
        url,
        prompt: 'Previously generated hero image.',
        isGenerating: false,
        error: '',
      })),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-bold truncate">{title}</h1>
          <div className="flex items-center gap-2 mt-1">
            {!hasProvider ? (
              <Badge className="animate-pulse bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border border-red-300 dark:border-red-700">
                Unknown Provider - Select One
              </Badge>
            ) : (
              <button
                type="button"
                onClick={() => setProviderPickerOpen((current) => !current)}
                className="rounded"
                aria-haspopup="listbox"
                aria-expanded={providerPickerOpen}
                aria-label={`Select cloud provider, current provider is ${selectedProvider}`}
              >
                <Badge variant="outline">{selectedProvider}</Badge>
              </button>
            )}
            <Badge>{statusLabel}</Badge>
          </div>
          {showProviderOptions && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {PROVIDER_OPTIONS.map((provider) => (
                <Button
                  key={provider.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-red-300 hover:border-red-500"
                  disabled={providerSaving}
                  onClick={() => handleSelectProvider(provider.value)}
                >
                  {provider.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scheduling Card */}
      <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Publish Queue Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <input
              id="instantPublish"
              type="checkbox"
              checked={instantPublish}
              onChange={(e) => setInstantPublish(e.target.checked)}
              disabled={!hasProvider}
              className="h-4 w-4 rounded border border-input bg-background"
            />
            <Label
              htmlFor="instantPublish"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Ready for Immediate Publish (when executed from Publish pane)
            </Label>
          </div>

          {!instantPublish && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="scheduledDate" className="text-xs text-muted-foreground">
                  Date
                </Label>
                <input
                  id="scheduledDate"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  disabled={!hasProvider}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduledTime" className="text-xs text-muted-foreground">
                  Time
                </Label>
                <input
                  id="scheduledTime"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  disabled={!hasProvider}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                />
              </div>
            </div>
          )}

          <Button
            size="sm"
            onClick={handleSaveSchedule}
            disabled={
              !hasProvider ||
              savingSchedule ||
              (!instantPublish && (!scheduledDate || !scheduledTime))
            }
            className="w-full"
          >
            {savingSchedule ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Schedule
              </>
            )}
          </Button>

          {scheduleMessage && (
            <p
              className={`text-xs ${scheduleMessage.type === 'success' ? 'text-green-600' : 'text-destructive'}`}
            >
              {scheduleMessage.text}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {!hasProvider
              ? 'Select a Cloud Provider to enable schedule actions.'
              : instantPublish
                ? 'This content is ready to be published immediately from the Publish pane.'
                : scheduledDate && scheduledTime
                  ? `Scheduled to publish on ${new Date(`${scheduledDate}T${scheduledTime}`).toLocaleString()}`
                  : 'Select a date and time for scheduled publishing.'}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Content Preview (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {coverUrl && (
            <img
              src={coverUrl}
              alt=""
              className="w-full rounded-lg max-h-80 object-cover shadow-sm"
            />
          )}

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Source URL</p>
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 break-all"
                >
                  {sourceUrl.length > 80 ? `${sourceUrl.substring(0, 80)}...` : sourceUrl}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">No source URL available.</span>
              )}
            </CardContent>
          </Card>

          {(blog.Summary || blog.summary) && (
            <Card>
              <CardHeader
                className="py-3 cursor-pointer hover:bg-muted/50 transition-colors flex flex-row items-center justify-between"
                onClick={() => setSummaryExpanded(!summaryExpanded)}
              >
                <CardTitle className="text-base flex items-center gap-2">
                  <Newspaper className="h-4 w-4" /> Summary
                </CardTitle>
                {summaryExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </CardHeader>
              {summaryExpanded && (
                <CardContent className="pt-0 pb-4">
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {blog.Summary || blog.summary}
                  </p>
                </CardContent>
              )}
            </Card>
          )}

          {/* AI Metadata: Topics + Images */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Key Topics</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {keyTopics.map((topic) => (
                    <Badge
                      key={topic}
                      variant="secondary"
                      className="text-xs cursor-pointer"
                      onClick={() => handleRemoveTopic(topic)}
                    >
                      {topic}
                    </Badge>
                  ))}
                </div>
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  onKeyDown={handleAddTopic}
                  placeholder="Add topic and press Enter"
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Images</p>
                <div className="grid grid-cols-2 gap-2">
                  {imageSlots.map((slot, index) => {
                    const imageUrl = slot.url;
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        onClick={() => imageUrl && setExpandedImage(imageUrl)}
                        className="aspect-video rounded-md border bg-muted/30 overflow-hidden relative"
                        disabled={!imageUrl}
                        aria-label={
                          imageUrl
                            ? `View ${slot.label} full screen`
                            : `${slot.label} not yet generated`
                        }
                      >
                        {imageUrl ? (
                          <img
                            src={resolveMediaUrl(imageUrl)}
                            alt={`${slot.label} thumbnail`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-2 text-center">
                            <span className="text-[11px] font-medium text-foreground/80">
                              {slot.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground line-clamp-4">
                              {slot.isGenerating
                                ? `Generating now. Prompt: ${slot.prompt}`
                                : slot.error
                                  ? `Generation failed: ${slot.error}`
                                  : slot.prompt}
                            </span>
                          </div>
                        )}
                        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {index + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 space-y-1">
                  {isCoverGenerating && (
                    <p className="text-[11px] text-blue-600 dark:text-blue-300">
                      Hero cover regeneration is running. The new image will replace the Hero Cover
                      slot when ready.
                    </p>
                  )}
                  {blog.altCoverImageGeneratedAt && !isCoverGenerating && (
                    <p className="text-[11px] text-green-600 dark:text-green-300">
                      Latest AI cover is available in the Hero Cover slot.
                    </p>
                  )}
                  {blog.altCoverImageError && !isCoverGenerating && (
                    <p className="text-[11px] text-destructive">
                      AI cover generation failed: {blog.altCoverImageError}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Publish Image Manager</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ImageOrderManager
                images={reviewImages}
                onChange={handleReviewImageReorder}
                onRemove={handleRemoveReviewImage}
                description="Drag to set the final image order before sending to Editor or Publish."
                emptyMessage="No images are attached to this content yet."
              />
              <ImageGalleryPicker
                provider={selectedProvider}
                title="Add From Image Gallery"
                onSelect={handleAttachReviewImage}
              />
              <Button
                onClick={handleSaveReviewImages}
                variant="outline"
                size="sm"
                className="w-full"
                disabled={savingImages}
              >
                {savingImages ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving Image Order...
                  </>
                ) : (
                  'Save Image Order'
                )}
              </Button>
            </CardContent>
          </Card>

          {/* AI Generated Content */}
          <Card>
            <CardHeader
              className="py-3 cursor-pointer hover:bg-muted/50 transition-colors flex flex-row items-center justify-between"
              onClick={() => setAiExpanded(!aiExpanded)}
            >
              <CardTitle className="text-sm flex items-center gap-2">
                <Wand2 className="h-4 w-4" /> AI Generated Content
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-normal">
                  {blog.postContent ? `${blog.postContent.length} chars` : 'Empty'}
                </Badge>
                {aiExpanded ? (
                  <Minimize2 className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Maximize2 className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            {aiExpanded && (
              <CardContent className="prose prose-sm dark:prose-invert max-w-none border-t pt-4">
                {blog.postContent ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{blog.postContent}</ReactMarkdown>
                ) : (
                  <div className="flex flex-col gap-2 items-center justify-center p-8 text-center bg-muted/20 rounded-lg">
                    <p className="text-muted-foreground italic text-sm">
                      No AI generated content yet.
                    </p>
                    <Button variant="outline" size="sm" onClick={handleTriggerInspect}>
                      <Wand2 className="h-3 w-3 mr-2" /> Generate Now
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Original Content */}
          <Card>
            <CardHeader
              className="py-3 cursor-pointer hover:bg-muted/50 transition-colors flex flex-row items-center justify-between"
              onClick={() => setOriginalExpanded(!originalExpanded)}
            >
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="h-4 w-4" /> Original Content
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-normal">
                  {content ? `${content.length} chars` : 'Empty'}
                </Badge>
                {originalExpanded ? (
                  <Minimize2 className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Maximize2 className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            {originalExpanded && (
              <CardContent className="prose prose-sm dark:prose-invert max-w-none border-t pt-4 max-h-[600px] overflow-y-auto">
                {content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">No content available.</p>
                )}
              </CardContent>
            )}
          </Card>
        </div>

        {/* RIGHT: Actions Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Published URL:{' '}
                {displayUrl ? (
                  <a
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 break-all"
                  >
                    {displayUrl.length > 60 ? `${displayUrl.substring(0, 60)}...` : displayUrl}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">Not yet generated.</span>
                )}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pipeline Triggers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleTriggerInspect}
                variant="outline"
                size="sm"
                className="w-full gap-2"
              >
                <Wand2 className="h-4 w-4" />
                {blog.inspectTrigger ? 'Inspecting (Click to Retry)...' : 'Re-Inspect with AI'}
              </Button>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  AI Image Prompt Override
                </p>
                <Textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Enter custom prompt or leave empty for auto-generation..."
                  className="text-xs min-h-[80px]"
                />
                <Button
                  onClick={handleTriggerCover}
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  disabled={isCoverGenerating}
                >
                  <ImageIcon className="h-4 w-4" />
                  {isCoverGenerating ? 'Generating...' : 'Generate AI Cover'}
                </Button>
                {coverTriggerMessage && (
                  <p className="text-[11px] text-muted-foreground">{coverTriggerMessage}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Review Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this content..."
                rows={3}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Workflow Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {transitionError && (
                <p className="text-xs text-destructive mb-2">{transitionError}</p>
              )}

              {(['ingested', 'inspected', 'in_review'].includes(status) ||
                status.startsWith('published_')) && (
                <>
                  {status.startsWith('published_') ? (
                    <Button
                      onClick={async () => {
                        setTransitioning('inspected');
                        setTransitionError(null);
                        try {
                          await unpublishToInspected(
                            blogId,
                            status,
                            notesRef.current || 'Returned to review queue from review board'
                          );
                          await logAdminAction('content_recalled_to_review', {
                            contentId: blogId,
                            fromStatus: status,
                          });
                        } catch (err) {
                          setTransitionError(err.message);
                        } finally {
                          setTransitioning(null);
                        }
                      }}
                      variant="outline"
                      className="w-full gap-2"
                      disabled={Boolean(transitioning)}
                    >
                      {transitioning === 'inspected' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Newspaper className="h-4 w-4" />
                      )}
                      Recall to Review Queue
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleTransition('approved_blog')}
                      className="w-full gap-2"
                      disabled={Boolean(transitioning) || !hasProvider}
                    >
                      {transitioning === 'approved_blog' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Newspaper className="h-4 w-4" />
                      )}
                      Send to Publish Queue
                    </Button>
                  )}
                  <Button
                    onClick={() => handleTransition('rejected')}
                    variant="destructive"
                    className="w-full gap-2"
                    disabled={Boolean(transitioning)}
                  >
                    {transitioning === 'rejected' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Reject
                  </Button>
                </>
              )}

              {status === 'approved_blog' && !isPublishedLive && (
                <Button onClick={() => navigate('/admin/published')} className="w-full gap-2">
                  Go to Publish Pane
                </Button>
              )}

              {['approved_blog', 'editing'].includes(status) && (
                <Button
                  onClick={() => navigate(`/admin/editor/${blogId}`)}
                  className="w-full gap-2"
                >
                  <PenSquare className="h-4 w-4" />
                  Open in Editor
                </Button>
              )}

              {!['approved_blog', 'editing'].includes(status) && (
                <Button
                  variant="outline"
                  onClick={() => navigate(`/admin/editor/${blogId}`)}
                  className="w-full gap-2"
                >
                  <PenSquare className="h-4 w-4" />
                  Open in Editor (Fallback)
                </Button>
              )}

              {status.startsWith('published_') && !isPublishedLive && (
                <>
                  <Button onClick={() => navigate('/admin/published')} className="w-full gap-2">
                    Go to Publish Pane
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate('/admin/calendar')}
                    className="w-full gap-2"
                  >
                    Schedule on Calendar
                  </Button>
                </>
              )}

              {!hasProvider && (
                <p className="text-xs text-red-600 dark:text-red-300 mt-2">
                  Select a Cloud Provider to enable publish actions.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Document Info</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1 text-muted-foreground">
              <p>
                <strong>ID:</strong> {blog.id}
              </p>
              <p>
                <strong>Created:</strong> {formatPostDate(blog['Created At'])}
              </p>
              <p>
                <strong>Scraped:</strong> {blog.scrapedMethod || 'N/A'}
              </p>
              <p>
                <strong>Word Count:</strong> {blog.wordCount || 'N/A'}
              </p>
              <p>
                <strong>AI Model:</strong> {blog.analysisModel || 'N/A'}
              </p>
              {blog.inspectError && (
                <p className="text-destructive">
                  <strong>Error:</strong> {blog.inspectError}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-red-200 dark:border-red-900/30">
            <CardHeader>
              <CardTitle className="text-xs text-red-500 uppercase tracking-wider font-bold">
                Debug Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleResetStatus}
                  className="text-xs h-7"
                >
                  Force Reset Status
                </Button>
              </div>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  View Raw Firestore Data
                </summary>
                <pre className="mt-2 p-2 bg-muted rounded overflow-auto max-h-60">
                  {JSON.stringify(blog, null, 2)}
                </pre>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>

      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpandedImage('')}
          aria-hidden="true"
        >
          <img src={expandedImage} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg" />
        </div>
      )}
    </div>
  );
}
