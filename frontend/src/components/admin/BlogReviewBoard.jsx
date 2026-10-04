import React from 'react';
import { useNavigate } from 'react-router';
import {
  buildImageSlots,
  deriveBlogView,
  DEFAULT_IMAGE_PROMPT_HINT,
} from '@/components/admin/blog-review/blogReviewModel';
import {
  useBlogReviewState,
  useCoverPromptPlan,
} from '@/components/admin/blog-review/useBlogReviewState';
import {
  useBlogReviewActions,
  useReviewImageActions,
  useScheduleActions,
  useTopicActions,
} from '@/components/admin/blog-review/useBlogReviewActions';
import { ProviderHeader, ScheduleCard } from '@/components/admin/blog-review/BlogReviewHeader';
import {
  BlogReviewContent,
  ExpandedImageOverlay,
} from '@/components/admin/blog-review/BlogReviewContent';
import { BlogReviewSidebar } from '@/components/admin/blog-review/BlogReviewSidebar';

/**
 * BlogReviewBoard — full review UI for standard blog content items.
 *
 * The board is the composition: local state lives in useBlogReviewState,
 * the writes and Azure Function calls in useBlogReviewActions and its
 * siblings, the pure derivations in blogReviewModel, and the markup in the
 * header, content and sidebar sections next to them (ADR 0033, PR #841).
 *
 * The status moves (approve, reject, recall) go through the shared
 * useContentTransitions hook (ADR 0033 §2); `onChanged` lets the page
 * refetch the record after one lands.
 *
 * @param {{ blog: object, blogId: string, onChanged?: () => void }} props
 */
export default function BlogReviewBoard({ blog, blogId, onChanged }) {
  const navigate = useNavigate();
  const { state, patch, toggle, updateImages } = useBlogReviewState(blog);
  useCoverPromptPlan({ blogId, generatedAt: blog.altCoverImageGeneratedAt, patch });

  const view = deriveBlogView(blog);
  const actions = useBlogReviewActions({
    blog,
    blogId,
    status: view.status,
    state,
    patch,
    onChanged,
  });
  const schedule = useScheduleActions({ blog, blogId, state, patch });
  const topics = useTopicActions({ blogId, state, patch, guarded: actions.guarded });
  const images = useReviewImageActions({
    blogId,
    state,
    patch,
    updateImages,
    guarded: actions.guarded,
  });

  const isCoverGenerating = blog.altCoverImageTrigger === true || state.coverTriggerPending;
  const imagePromptPreview =
    state.imagePrompt.trim() || blog.altCoverImagePrompt || DEFAULT_IMAGE_PROMPT_HINT;
  const imageSlots = buildImageSlots(blog, { imagePromptPreview, isCoverGenerating });

  return (
    <div className="space-y-6">
      <ProviderHeader
        blog={blog}
        view={view}
        state={state}
        onTogglePicker={() => toggle('providerPickerOpen')}
        onSelectProvider={actions.handleSelectProvider}
      />

      <ScheduleCard
        state={state}
        hasProvider={view.hasProvider}
        patch={patch}
        onSave={schedule.handleSaveSchedule}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <BlogReviewContent
          blog={blog}
          view={view}
          state={state}
          patch={patch}
          toggle={toggle}
          imageSlots={imageSlots}
          isCoverGenerating={isCoverGenerating}
          topics={topics}
          images={images}
          onTriggerInspect={actions.handleTriggerInspect}
        />
        <BlogReviewSidebar
          blog={blog}
          blogId={blogId}
          view={view}
          state={state}
          patch={patch}
          actions={actions}
          isCoverGenerating={isCoverGenerating}
          navigate={navigate}
        />
      </div>

      <ExpandedImageOverlay
        url={state.expandedImage}
        onClose={() => patch({ expandedImage: '' })}
      />
    </div>
  );
}
