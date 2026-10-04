/**
 * Files and images on an application (ADR 0033 §4). The upload route accepts
 * images only (admin-uploads.js), so the "Files & images" upload takes
 * images and documents go in Links. Uploads land in the private
 * `speakerevents` container under `ambassador/{id}/`, so they are never
 * anonymously reachable; the application records name, URL, size and time.
 */
import { useState } from 'react';
import { postJSON } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';

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
    const result = await postJSON('cms/uploads/speakerevents', {
      path: uploadPath(application.id, file),
      contentType: file.type,
      dataBase64: await readAsBase64(file),
    });
    const entry = {
      name: file.name,
      url: result.url,
      bytes: file.size,
      uploadedAt: new Date().toISOString(),
    };
    await hub.writes.patchApplication(
      application.id,
      {
        files: [...(application.files || []), entry],
        images: [...(application.images || []), entry],
      },
      { quiet: true }
    );
    toast({ title: 'File stored privately', description: file.name });
  };

  const upload = async (file) => {
    if (!file || uploading) return;
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Images only',
        description: 'The upload route accepts images; add documents as links.',
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

  const removeFile = (url) =>
    hub.writes.patchApplication(
      application.id,
      {
        files: (application.files || []).filter((f) => f.url !== url),
        images: (application.images || []).filter((f) => f.url !== url),
      },
      { quiet: true }
    );

  return { uploading, upload, removeFile };
}
