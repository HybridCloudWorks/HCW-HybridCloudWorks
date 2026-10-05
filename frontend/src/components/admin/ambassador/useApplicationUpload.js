/**
 * Files and images on an application (ADR 0033 §4). Uploads land in the
 * private `speakerevents` container under `ambassador/{id}/`, so they are
 * never anonymously reachable; the application records name, URL, size and
 * time. Images and documents (PDF, Word, Excel, PowerPoint, CSV, text) are
 * accepted — the route allows documents into private containers only
 * (admin-uploads.js, owner request 2026-10-05: a program's agreement, role
 * description or export is archived beside the application). Images also
 * join `images[]`, the gallery the packet prints; documents are files only.
 */
export const DOCUMENT_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'text/markdown',
]);
export const UPLOAD_ACCEPT = 'image/*,.pdf,.docx,.xlsx,.pptx,.csv,.txt,.md';
export const isUploadable = (file) =>
  Boolean(file?.type) && (file.type.startsWith('image/') || DOCUMENT_TYPES.includes(file.type));
import { useState } from 'react';
import { authedFetch, postJSON } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';

const PRIVATE_CONTAINER = 'speakerevents';

/** What identifies a stored file: its private path, else its URL. */
export const fileKey = (file) => file?.path || file?.url || '';

/** The download route for a private reference, path encoded segment by segment. */
export function downloadPath(file) {
  const encoded = String(file.path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `cms/ambassador/files/${encodeURIComponent(file.container || PRIVATE_CONTAINER)}/${encoded}`;
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/** The blob path for an upload: under the application, stamped, with a safe name. */
function uploadPath(applicationId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `ambassador/${applicationId}/${Date.now()}-${safeName.replace(/\.[^.]+$/, '')}.${ext}`;
}

export default function useApplicationUpload(application, hub) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const store = async (file) => {
    const result = await postJSON(`cms/uploads/${PRIVATE_CONTAINER}`, {
      path: uploadPath(application.id, file),
      contentType: file.type,
      dataBase64: await readAsBase64(file),
    });
    // A private container answers no URL; the reference is what is kept,
    // and the editor-guarded download route serves it (review on #873).
    const entry = {
      name: file.name,
      url: result.url || null,
      container: result.container || PRIVATE_CONTAINER,
      path: result.path,
      bytes: file.size,
      uploadedAt: new Date().toISOString(),
    };
    const isImage = file.type.startsWith('image/');
    await hub.writes.patchApplication(
      application.id,
      {
        files: [...(application.files || []), entry],
        ...(isImage ? { images: [...(application.images || []), entry] } : {}),
      },
      { quiet: true }
    );
    toast({ title: 'File stored privately', description: file.name });
  };

  const upload = async (file) => {
    if (!file || uploading) return;
    if (!isUploadable(file)) {
      toast({
        title: 'Not an accepted file type',
        description:
          'Images, PDF, Word, Excel, PowerPoint, CSV and text files; anything else as a link.',
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      await store(file);
    } catch (err) {
      toast({ title: 'Upload failed', description: err?.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (key) =>
    hub.writes.patchApplication(
      application.id,
      {
        files: (application.files || []).filter((f) => fileKey(f) !== key),
        images: (application.images || []).filter((f) => fileKey(f) !== key),
      },
      { quiet: true }
    );

  /** Fetch a private file with the admin token and hand it to the browser as a download. */
  const download = async (file) => {
    try {
      const res = await authedFetch(downloadPath(file), { method: 'GET' });
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = file.name || 'file';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      toast({ title: 'Download failed', description: err?.message, variant: 'destructive' });
    }
  };

  return { uploading, upload, removeFile, download };
}
