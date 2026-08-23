import React, { useState } from 'react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { useParams, useNavigate } from 'react-router';
import { usePublicData } from '@/hooks/usePublicData';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import ArchitectureReviewBoard from '@/components/admin/ArchitectureReviewBoard';
import FrameworkReviewBoard from '@/components/admin/FrameworkReviewBoard';
import BlogReviewBoard from '@/components/admin/BlogReviewBoard';
import { postJSON, getJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';
import { getPublishTargetForType } from '@/lib/contentModel';
import PipelineStepper from '@/components/admin/PipelineStepper';

export default function ReviewPage() {
  const { blogId } = useParams();
  const navigate = useNavigate();
  const {
    data: blog,
    error,
    loading,
  } = usePublicData(
    () =>
      getJSON(`cms/content/item?contentId=${encodeURIComponent(blogId)}`).then((res) => res.item),
    blogId ? `review:${blogId}` : ''
  );
  const [frameworkDeleteOpen, setFrameworkDeleteOpen] = useState(false);

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Loading content...</p>
      </div>
    );
  }

  if (error || !blog) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Content not found or error loading.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/admin/queue')}>
          Back to Queue
        </Button>
      </div>
    );
  }

  // ── ARCHITECTURE REVIEW BOARD ─────────────────────────────────────────────
  const handleArchitectureSave = async (formData) => {
    try {
      await postJSON('updateContentItem', {
        contentId: blogId,
        updates: formData,
      });
      // Optional toast here
    } catch (err) {
      console.error('Error saving blueprint:', err);
      // Optional toast error
    }
  };

  const handleArchitecturePublish = async (formData) => {
    try {
      // Save first
      await handleArchitectureSave(formData);
      await postJSON('transitionContentStatus', {
        contentId: blogId,
        newStatus: 'approved_blog',
        publishTarget: getPublishTargetForType('architecture'),
        markLive: false,
        reviewNotes: 'Architecture review complete and sent to publish stage',
      });
      await logAdminAction('architecture_approved_for_publish', { contentId: blogId });
      navigate('/admin/queue?contentType=architecture');
    } catch (err) {
      console.error('Error publishing blueprint:', err);
    }
  };

  const handleFrameworkSave = async (formData) => {
    try {
      await postJSON('updateContentItem', {
        contentId: blogId,
        updates: formData,
      });
    } catch (err) {
      console.error('Error saving framework:', err);
    }
  };

  const handleFrameworkPublish = async (formData) => {
    try {
      await handleFrameworkSave(formData);
      await postJSON('transitionContentStatus', {
        contentId: blogId,
        newStatus: 'approved_blog',
        publishTarget: getPublishTargetForType('framework'),
        markLive: false,
        reviewNotes: 'Framework review complete and sent to publish stage',
      });
      await logAdminAction('framework_approved_for_publish', { contentId: blogId });
      navigate('/admin/queue?contentType=framework');
    } catch (err) {
      console.error('Error publishing framework:', err);
    }
  };

  const handleFrameworkDelete = () => {
    setFrameworkDeleteOpen(true);
  };

  const doFrameworkDelete = async () => {
    setFrameworkDeleteOpen(false);
    try {
      await postJSON('deleteContentItem', { contentId: blogId });
      await logAdminAction('framework_deleted', { contentId: blogId });
      navigate('/admin/queue?contentType=framework');
    } catch (err) {
      console.error('Error deleting framework:', err);
    }
  };

  if (blog.type === 'architecture') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/queue')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Queue
          </Button>
          <Badge variant="outline" className="border-purple-200 text-purple-700">
            Architecture Studio
          </Badge>
        </div>
        <PipelineStepper item={blog} />
        <ArchitectureReviewBoard
          blog={blog}
          onSave={handleArchitectureSave}
          onPublish={handleArchitecturePublish}
          saving={false}
        />
      </div>
    );
  }

  if (blog.type === 'framework') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/queue')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Queue
          </Button>
          <Badge variant="outline" className="border-blue-200 text-blue-700">
            Framework Studio
          </Badge>
        </div>
        <PipelineStepper item={blog} />
        <FrameworkReviewBoard
          blog={blog}
          onSave={handleFrameworkSave}
          onPublish={handleFrameworkPublish}
          onDelete={handleFrameworkDelete}
          saving={false}
        />
        <ConfirmModal
          open={frameworkDeleteOpen}
          title="Delete this framework?"
          description="This content item will be permanently deleted. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={doFrameworkDelete}
          onCancel={() => setFrameworkDeleteOpen(false)}
        />
      </div>
    );
  }

  // ── STANDARD BLOG REVIEW ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/queue')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Queue
        </Button>
      </div>
      <PipelineStepper item={blog} />
      <BlogReviewBoard blog={blog} blogId={blogId} />
    </div>
  );
}
