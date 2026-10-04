/**
 * Adding images to the gallery (ADR 0033): upload files, import from a URL,
 * and manage the folder list — which is persisted in
 * admin_config/gallery_folders rather than lost on reload.
 *
 * Each section owns its own inputs and in-flight flag; the panel owns the
 * upload options they share and the one alert they report problems through.
 * The path and record logic lives in ./uploadPanelModel.
 */
import React, { useRef, useState } from 'react';
import { FolderPlus, Link2, Loader2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  COMMON_PROVIDERS,
  deleteFolderProblem,
  importGalleryImage,
  newFolderProblem,
  SLOT_OPTIONS,
} from '@/lib/imageGallery';
import { normalizeContentProvider } from '@/lib/contentModel';
import {
  DEFAULT_UPLOAD_OPTIONS,
  errorText,
  GALLERY_ACCEPT,
  importedMessage,
  importProblem,
  isHttpUrl,
  parseTagList,
  runUploadQueue,
  uploadedMessage,
} from './uploadPanelModel';

export { buildGalleryUploadData } from './uploadPanelModel';

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** What the three sections send to the server, from the shared options. */
function recordOptions(options) {
  return {
    provider: normalizeContentProvider(options.provider),
    slot: options.slot,
    tags: parseTagList(options.tags),
    rename: options.rename,
    pullTags: options.pullTags,
    folder: options.folder,
  };
}

function UploadAlerts({ error, warning }) {
  if (!error && !warning) return null;
  return (
    <div role="alert" className="space-y-1 text-sm text-destructive">
      {error && <p>{error}</p>}
      {warning && <p>{warning}</p>}
    </div>
  );
}

function QueuedFiles({ files, onRemove }) {
  return (
    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2">
      {files.map((file, idx) => (
        <Badge key={`${file.name}-${file.size}-${idx}`} variant="outline" className="gap-1">
          {file.name}
          <button
            type="button"
            onClick={() => onRemove(file)}
            className="text-destructive"
            aria-label={`Remove ${file.name} from queue`}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

function UploadFilesSection({ options, onError, onWarning, onMessage, onUploaded }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const upload = async () => {
    if (!files.length) {
      onError('No files selected');
      return;
    }
    setUploading(true);
    onError('');
    onWarning('');
    try {
      const { uploaded, rejected } = await runUploadQueue(files, recordOptions(options));
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      onMessage(uploadedMessage(uploaded.length, options.folder));
      if (rejected.length) onWarning(`Not uploaded — ${rejected.join('; ')}`);
      await onUploaded();
    } catch (err) {
      onError(`Upload failed: ${errorText(err)}`);
    } finally {
      setUploading(false);
    }
  };

  return (
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
        PNG, JPEG, WebP, GIF or AVIF, up to 15 MB each. Size and dimensions are recorded on upload.
      </p>
      {files.length > 0 && (
        <QueuedFiles
          files={files}
          onRemove={(file) => setFiles((prev) => prev.filter((f) => f !== file))}
        />
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
        {uploading ? 'Uploading…' : `Upload ${files.length || ''} to ${options.folder}`}
      </Button>
    </div>
  );
}

function ImportUrlSection({ options, onError, onMessage, onUploaded }) {
  const [importUrl, setImportUrl] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importing, setImporting] = useState(false);

  const importFromUrl = async () => {
    const url = importUrl.trim();
    if (!isHttpUrl(url)) {
      onError('Enter a full http(s) URL to import.');
      return;
    }
    setImporting(true);
    onError('');
    try {
      const { provider, slot, tags, folder } = recordOptions(options);
      const res = await importGalleryImage({
        url,
        title: importTitle.trim(),
        folder,
        tags,
        provider,
        slot,
      });
      setImportUrl('');
      setImportTitle('');
      onMessage(importedMessage(res, folder));
      await onUploaded();
    } catch (err) {
      onError(importProblem(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor="gallery-import-url" className="flex items-center gap-1 text-sm font-semibold">
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
  );
}

function FoldersSection({ folders, items, onFoldersChange, onFolderDeleted, onError, onMessage }) {
  const [newFolder, setNewFolder] = useState('');

  const createFolder = async () => {
    const name = newFolder.trim().toLowerCase();
    const problem = newFolderProblem(name, folders);
    if (problem) {
      onError(problem);
      return;
    }
    onError('');
    await onFoldersChange([...folders, name].sort());
    setNewFolder('');
    onMessage(`Folder "${name}" created.`);
  };

  const removeFolder = async (name) => {
    const problem = deleteFolderProblem(name, items);
    if (problem) {
      onError(problem);
      return;
    }
    onError('');
    await onFoldersChange(folders.filter((f) => f !== name));
    onFolderDeleted(name);
    onMessage(`Folder "${name}" deleted.`);
  };

  return (
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
        Folders are saved for everyone who opens the gallery. A folder with images in it cannot be
        deleted.
      </p>
    </div>
  );
}

/** The three tag selects, rendered from one table so there is one copy of the markup. */
const OPTION_SELECTS = Object.freeze([
  { key: 'folder', id: 'upload-folder', label: 'Destination folder' },
  { key: 'provider', id: 'upload-provider', label: 'Provider tag', options: COMMON_PROVIDERS },
  { key: 'slot', id: 'upload-slot', label: 'Slot tag', options: SLOT_OPTIONS },
]);

function selectOptionsFor(field, folders) {
  return field.options || folders.map((name) => ({ value: name, label: name }));
}

function UploadOptionsRow({ options, folders, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-5">
      {OPTION_SELECTS.map((field) => (
        <div key={field.key}>
          <label htmlFor={field.id} className="text-xs font-medium">
            {field.label}
          </label>
          <select
            id={field.id}
            value={options[field.key]}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={selectClass}
          >
            {selectOptionsFor(field, folders).map((o) => (
              <option key={o.value || 'none'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div>
        <label htmlFor="upload-tags" className="text-xs font-medium">
          Tags (comma-separated)
        </label>
        <Input
          id="upload-tags"
          value={options.tags}
          onChange={(e) => onChange('tags', e.target.value)}
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
          value={options.rename}
          onChange={(e) => onChange('rename', e.target.value)}
          placeholder="Overrides the generated name"
          className="text-sm"
        />
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={options.pullTags}
            onChange={(e) => onChange('pullTags', e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Pull tags from hyphenated filenames
        </label>
      </div>
    </div>
  );
}

export default function UploadPanel({ folders, items, onFoldersChange, onUploaded, onMessage }) {
  const [options, setOptions] = useState(DEFAULT_UPLOAD_OPTIONS);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const setOption = (key, value) => setOptions((prev) => ({ ...prev, [key]: value }));
  // A deleted folder cannot stay selected as the destination.
  const onFolderDeleted = (name) => {
    if (options.folder === name) setOption('folder', 'default');
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <UploadAlerts error={error} warning={warning} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <UploadFilesSection
          options={options}
          onError={setError}
          onWarning={setWarning}
          onMessage={onMessage}
          onUploaded={onUploaded}
        />
        <ImportUrlSection
          options={options}
          onError={setError}
          onMessage={onMessage}
          onUploaded={onUploaded}
        />
        <FoldersSection
          folders={folders}
          items={items}
          onFoldersChange={onFoldersChange}
          onFolderDeleted={onFolderDeleted}
          onError={setError}
          onMessage={onMessage}
        />
      </div>
      <UploadOptionsRow options={options} folders={folders} onChange={setOption} />
    </div>
  );
}
