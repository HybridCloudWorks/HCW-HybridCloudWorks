/**
 * The Add-a-Post image row (#501): upload from the computer, or pick from the
 * site's image gallery, then a preview with a remove button.
 *
 * Whatever is chosen is sent as the post's `thumbnail_url`
 * (LINKIE_POST_IMAGE_FIELD in lib/linkie.js).
 *
 * The image is uploaded as soon as it is chosen, not on Add Post, so the
 * preview shows the URL that will actually be sent — and a refused upload is
 * reported against the file rather than against the post.
 */
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Upload, Images, X } from 'lucide-react';
import ImageGalleryPicker from '@/components/admin/ImageGalleryPicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  PUBLIC_IMAGE_EXTENSIONS,
  publicImageFileProblem,
  uploadImageFile,
} from '@/lib/imageUpload';
import { LINKIE_IMAGE_CONTAINER, linkieImagePath } from '@/lib/linkie';
import { publicImageUrl } from './linkieView';

export default function PostImageField({ imageUrl, onImageChange, uploading, onUploadingChange }) {
  const { toast } = useToast();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    // Cleared so choosing the same file again after a remove still fires.
    input.value = '';
    if (!file) return;
    const problem = publicImageFileProblem(file);
    if (problem) {
      toast({ title: problem, variant: 'destructive' });
      return;
    }
    onUploadingChange(true);
    try {
      const uploaded = await uploadImageFile({
        container: LINKIE_IMAGE_CONTAINER,
        path: linkieImagePath(PUBLIC_IMAGE_EXTENSIONS[file.type.toLowerCase()]),
        file,
      });
      const publicUrl = publicImageUrl(uploaded?.url);
      if (!publicUrl) throw new Error('The upload returned no public https URL');
      onImageChange(publicUrl);
    } catch (err) {
      toast({ title: 'Image upload failed', description: err.message, variant: 'destructive' });
    } finally {
      onUploadingChange(false);
    }
  };

  const handleGallerySelect = (item) => {
    const publicUrl = publicImageUrl(item?.imageUrl);
    if (!publicUrl) {
      // A gallery row uploaded to the private `content` container has no
      // public URL at all, and Linkie cannot fetch what the browser cannot.
      toast({ title: 'That gallery image has no public URL', variant: 'destructive' });
      return;
    }
    onImageChange(publicUrl);
    setGalleryOpen(false);
  };

  return (
    <div>
      <Label className="text-xs" id="linkie-post-image-label">
        Image (optional)
      </Label>
      <div
        className="flex flex-wrap items-center gap-2 mt-1"
        role="group"
        aria-labelledby="linkie-post-image-label"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="linkie-post-image-file"
          onChange={handleFile}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Upload from computer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={uploading}
          onClick={() => setGalleryOpen(true)}
        >
          <Images className="h-3.5 w-3.5" />
          Choose from gallery
        </Button>
      </div>
      {imageUrl && (
        <div className="relative mt-2 inline-block">
          <img
            src={imageUrl}
            alt="Attached to this post"
            className="h-20 w-32 rounded-md border object-cover"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
            aria-label="Remove image"
            title="Remove image"
            onClick={() => onImageChange('')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose from gallery</DialogTitle>
            <DialogDescription className="text-xs">
              Only images with a public URL can be attached — Linkie fetches them itself.
            </DialogDescription>
          </DialogHeader>
          {galleryOpen && (
            <ImageGalleryPicker title="Image Gallery" onSelect={handleGallerySelect} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
