/**
 * Adding images to the gallery (ADR 0033): upload files, import from a URL,
 * and manage the folder list — which is persisted in
 * admin_config/gallery_folders rather than lost on reload.
 *
 * Uploads record what the browser can measure (pixel size, bytes, type,
 * sha256) so the gallery can show dimensions and flag duplicates. The
 * container is `covers` (#602): the only one the media route serves, so the
 * record has a URL something can display.
 */
import React, { useRef, useState } from 'react';
import { FolderPlus, Link2, Loader2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { postJSON } from '@/lib/api';
import {
  COMMON_PROVIDERS,
  deleteFolderProblem,
  importGalleryImage,
  newFolderProblem,
  SLOT_OPTIONS,
} from '@/lib/imageGallery';
import {
  imageExtensionFor,
  publicImageFileProblem,
  PUBLIC_IMAGE_EXTENSIONS,
  readImageDimensions,
  sha256HexOf,
  uploadImageFile,
} from '@/lib/imageUpload';
import { normalizeContentProvider } from '@/lib/contentModel';

const GALLERY_CONTAINER = 'covers';
const GALLERY_ACCEPT = Object.keys(PUBLIC_IMAGE_EXTENSIONS).join(',');
const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function slugifyFilename(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The blob path and record fields for one queued file. */
export function buildGalleryUploadData({
  file,
  index,
  provider,
  slot,
  tags,
  rename,
  pullTags,
  folder,
}) {
  if (!file || !file.name) throw new Error(`Invalid file at index ${index}`);
  // From the DECLARED TYPE, not the filename (#631): the route requires the
  // path's extension to agree with the content type.
  const extension = imageExtensionFor(file);
  if (!extension) throw new Error(`"${file.name}" is not a type this gallery can store.`);
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'uploaded-image';
  const extractedTags =
    pullTags && baseName.includes('-')
      ? baseName
          .split('-')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];
  const parts = [provider, slot, ...tags.slice(0, 2)].filter(Boolean).map((p) => p.toLowerCase());
  const filenameBase = rename.trim() || (parts.length ? parts.join('-') : baseName);
  const safeName = (slugifyFilename(filenameBase) || 'uploaded-image').toLowerCase();
  const stamp = Date.now();
  const randomId = Math.random().toString(36).slice(2, 10);
  const fileNumber = String(index + 1).padStart(3, '0');
  return {
    extension,
    storagePath: `image-gallery/manual/${stamp}-${randomId}-${safeName}-${fileNumber}.${extension}`,
    allTags: [...new Set([...extractedTags, ...tags])],
    title: baseName,
    folder: (folder || 'default').toLowerCase(),
  };
}

async function uploadOne(file, index, options) {
  const data = buildGalleryUploadData({ file, index, ...options });
  const [dimensions, sha256] = await Promise.all([readImageDimensions(file), sha256HexOf(file)]);
  const uploaded = await uploadImageFile({
    container: GALLERY_CONTAINER,
    path: data.storagePath,
    file,
  });
  const imageUrl = uploaded.url;
  // Refuse to record an image nothing can display (#602): a private container
  // answers 200 with url:'' and the row would look fine while resolving to
  // nothing everywhere it was used.
  if (!imageUrl) {
    throw new Error(
      `Upload succeeded but returned no public URL (container '${GALLERY_CONTAINER}'). The gallery record was not created.`
    );
  }
  await postJSON('createManualGalleryImageRecord', {
    articleId: 'manual-upload',
    imageUrl,
    provider: options.provider,
    title: data.title,
    altText: data.title,
    slot: options.slot,
    storagePath: `${GALLERY_CONTAINER}/${data.storagePath}`,
    customTags: data.allTags,
    folder: data.folder,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    bytes: file.size,
    format: data.extension,
    sha256,
    license: 'owned',
  });
  return file.name;
}

export default function UploadPanel({ folders, items, onFoldersChange, onUploaded, onMessage }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState('default');
  const [provider, setProvider] = useState('');
  const [slot, setSlot] = useState('');
  const [tags, setTags] = useState('');
  const [rename, setRename] = useState('');
  const [pullTags, setPullTags] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importing, setImporting] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const tagList = tags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const upload = async () => {
    if (!files.length) {
      setError('No files selected');
      return;
    }
    setUploading(true);
    setError('');
    setWarning('');
    try {
      const uploaded = [];
      const rejected = [];
      const options = {
        provider: normalizeContentProvider(provider),
        slot,
        tags: tagList,
        rename,
        pullTags,
        folder,
      };
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const problem = publicImageFileProblem(file);
        if (problem) {
          rejected.push(`${file.name}: ${problem}`);
          continue;
        }
        // Sequential on purpose: each upload is a full base64 body capped at
        // 15 MB; a queue fired at once is a memory spike on the Function host.
        uploaded.push(await uploadOne(file, index, options));
      }
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      onMessage(
        `${uploaded.length} image${uploaded.length === 1 ? '' : 's'} uploaded to the ${folder} folder.`
      );
      if (rejected.length) setWarning(`Not uploaded — ${rejected.join('; ')}`);
      await onUploaded();
    } catch (err) {
      setError(`Upload failed: ${err?.message || err}`);
    } finally {
      setUploading(false);
    }
  };

  const importFromUrl = async () => {
    const url = importUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('Enter a full http(s) URL to import.');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const res = await importGalleryImage({
        url,
        title: importTitle.trim(),
        folder,
        tags: tagList,
        provider: normalizeContentProvider(provider),
        slot,
      });
      setImportUrl('');
      setImportTitle('');
      onMessage(
        `Imported ${res.width && res.height ? `${res.width} × ${res.height} ` : ''}${String(res.format || '').toUpperCase()} into the ${folder} folder.`
      );
      await onUploaded();
    } catch (err) {
      // 409 is the server saying the bytes or URL are already here (the
      // message names the record); anything else is a failed import.
      setError(
        err?.status === 409
          ? `${err.message}. Search the gallery for it instead of importing twice.`
          : `Import failed: ${err?.message || err}`
      );
    } finally {
      setImporting(false);
    }
  };

  const createFolder = async () => {
    const name = newFolder.trim().toLowerCase();
    const problem = newFolderProblem(name, folders);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    await onFoldersChange([...folders, name].sort());
    setNewFolder('');
    onMessage(`Folder "${name}" created.`);
  };

  const removeFolder = async (name) => {
    const problem = deleteFolderProblem(name, items);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    await onFoldersChange(folders.filter((f) => f !== name));
    if (folder === name) setFolder('default');
    onMessage(`Folder "${name}" deleted.`);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      {(error || warning) && (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          {error && <p>{error}</p>}
          {warning && <p>{warning}</p>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <label htmlFor="gallery-files" className="flex items-center gap-1 text-sm font-semibold">
            <Upload className="h-4 w-4" aria-hidden="true" /> Upload files
          </label>
          {/* Not `image/*`: the public container refuses SVG and anything outside the five raster types. */}
          <Input
            ref={inputRef}
            id="gallery-files"
            type="file"
            accept={GALLERY_ACCEPT}
            multiple
            onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
            className="cursor-pointer"
          />
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP, GIF or AVIF, up to 15 MB each. Size and dimensions are recorded on
            upload.
          </p>
          {files.length > 0 && (
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2">
              {files.map((file, idx) => (
                <Badge key={`${file.name}-${file.size}-${idx}`} variant="outline" className="gap-1">
                  {file.name}
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((f) => f !== file))}
                    className="text-destructive"
                    aria-label={`Remove ${file.name} from queue`}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Button
            type="button"
            onClick={upload}
            disabled={uploading || files.length === 0}
            className="gap-2"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            {uploading ? 'Uploading…' : `Upload ${files.length || ''} to ${folder}`}
          </Button>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="gallery-import-url"
            className="flex items-center gap-1 text-sm font-semibold"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" /> Import from URL
          </label>
          <Input
            id="gallery-import-url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://example.com/diagram.png"
            inputMode="url"
          />
          <Input
            value={importTitle}
            onChange={(e) => setImportTitle(e.target.value)}
            placeholder="Title (optional; the filename otherwise)"
            aria-label="Title for the imported image"
          />
          <p className="text-xs text-muted-foreground">
            The file is fetched once (12 MB cap, images only), stored in this site’s own storage and
            credited to its host. An image already in the gallery is not imported twice.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={importFromUrl}
            disabled={importing || !importUrl.trim()}
            className="gap-2"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="h-4 w-4" aria-hidden="true" />
            )}
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </div>

        <div className="space-y-2">
          <p className="flex items-center gap-1 text-sm font-semibold">
            <FolderPlus className="h-4 w-4" aria-hidden="true" /> Folders
          </p>
          <div className="flex gap-1">
            <Input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createFolder()}
              placeholder="New folder name"
              aria-label="New folder name"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={createFolder}
              disabled={!newFolder.trim()}
            >
              Create
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {folders.map((name) => (
              <Badge key={name} variant="secondary" className="gap-1">
                {name}
                {name !== 'default' && (
                  <button
                    type="button"
                    onClick={() => removeFolder(name)}
                    className="text-destructive"
                    aria-label={`Delete folder ${name}`}
                    title="Delete folder (must be empty)"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Folders are saved for everyone who opens the gallery. A folder with images in it cannot
            be deleted.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-5">
        <div>
          <label htmlFor="upload-folder" className="text-xs font-medium">
            Destination folder
          </label>
          <select
            id="upload-folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className={selectClass}
          >
            {folders.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="upload-provider" className="text-xs font-medium">
            Provider tag
          </label>
          <select
            id="upload-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className={selectClass}
          >
            {COMMON_PROVIDERS.map((o) => (
              <option key={o.value || 'none'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="upload-slot" className="text-xs font-medium">
            Slot tag
          </label>
          <select
            id="upload-slot"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            className={selectClass}
          >
            {SLOT_OPTIONS.map((o) => (
              <option key={o.value || 'none'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="upload-tags" className="text-xs font-medium">
            Tags (comma-separated)
          </label>
          <Input
            id="upload-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="migration, serverless"
            className="font-mono text-sm"
          />
        </div>
        <div>
          <label htmlFor="upload-rename" className="text-xs font-medium">
            Custom filename (optional)
          </label>
          <Input
            id="upload-rename"
            value={rename}
            onChange={(e) => setRename(e.target.value)}
            placeholder="Overrides the generated name"
            className="text-sm"
          />
          <label className="mt-1 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={pullTags}
              onChange={(e) => setPullTags(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Pull tags from hyphenated filenames
          </label>
        </div>
      </div>
    </div>
  );
}
