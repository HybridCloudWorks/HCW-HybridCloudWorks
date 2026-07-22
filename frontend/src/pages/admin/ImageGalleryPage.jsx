import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { postJSON } from '@/lib/api';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Copy,
  Trash2,
  RefreshCw,
  ExternalLink,
  Wand2,
  Loader2,
  Upload,
  FolderPlus,
  FolderOpen,
  X,
  Pencil,
} from 'lucide-react';
import { loadGalleryItems, getSourceLabel } from '@/lib/imageGallery';
import { getStorage } from '@/lib/firebaseStorage';
import { normalizeContentProvider } from '@/lib/contentModel';

const COMMON_PROVIDERS = [
  { value: '', label: 'No provider tag' },
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'gcp', label: 'GCP' },
  { value: 'terraform', label: 'Terraform' },
  { value: 'finops', label: 'FinOps' },
  { value: 'github', label: 'GitHub' },
];

const SLOT_OPTIONS = [
  { value: '', label: 'No slot tag' },
  { value: 'rss', label: 'RSS' },
  { value: 'hero', label: 'Hero' },
  { value: 'secondary1', label: 'Secondary 1' },
  { value: 'secondary2', label: 'Secondary 2' },
  { value: 'secondary3', label: 'Secondary 3' },
];

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function slugifyFilename(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getGalleryFileExtension(file) {
  return file.name.includes('.') ? file.name.split('.').pop() || 'png' : 'png';
}

function getGalleryBaseName(file) {
  return file.name.replace(/\.[^.]+$/, '') || 'uploaded-image';
}

function getGalleryExtractedTags(baseName, pullTagsFromFilename) {
  if (!pullTagsFromFilename || !baseName.includes('-')) return [];
  return baseName
    .split('-')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function getGalleryFilenameBase({
  baseName,
  normalizedProvider,
  uploadSlot,
  customTagsArray,
  uploadRenameFilename,
}) {
  if (uploadRenameFilename.trim()) return uploadRenameFilename.trim();
  if (!customTagsArray.length && !normalizedProvider && !uploadSlot) return baseName;

  const parts = [];
  if (normalizedProvider) parts.push(normalizedProvider.toLowerCase());
  if (uploadSlot) parts.push(uploadSlot.toLowerCase());
  if (customTagsArray.length > 0) parts.push(...customTagsArray.slice(0, 2));
  return parts.length > 0 ? parts.join('-') : baseName;
}

function getGalleryUploadTitle({ uploadFilesLength, uploadTitle, baseName }) {
  if (uploadFilesLength === 1 && uploadTitle.trim()) return uploadTitle.trim();
  return baseName || uploadTitle.trim() || 'Uploaded image';
}

function getGalleryStoragePath(safeName, index) {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).slice(2, 10);
  const fileNumber = String(index + 1).padStart(3, '0');
  return `image-gallery/manual/${timestamp}-${randomId}-${safeName}-${fileNumber}`;
}

function matchesGalleryProvider(item, providerFilter) {
  const provider = String(item.provider || '').toUpperCase();
  return providerFilter === 'all' || provider === providerFilter;
}

function matchesGallerySlot(item, slotFilter) {
  const slot = String(item.slot || '').toLowerCase();
  return slotFilter === 'all' || slot === slotFilter;
}

function matchesGalleryCustomTag(item, customTagFilter) {
  const customTags = (item.customTags || []).map((tag) =>
    String(tag || '')
      .trim()
      .toLowerCase()
  );
  return customTagFilter === 'all' || customTags.includes(customTagFilter.toLowerCase());
}

function matchesGalleryFolder(item, folderFilter) {
  const itemFolder = item.folder ? String(item.folder).trim().toLowerCase() : '';
  return (
    folderFilter === 'all' ||
    (folderFilter === '--none--' && (itemFolder === '' || itemFolder === 'default')) ||
    (folderFilter !== '--none--' && itemFolder === folderFilter.toLowerCase())
  );
}

function matchesGalleryTerm(item, term) {
  if (!term) return true;
  const articleId = String(item.articleId || '').toLowerCase();
  const imageUrl = String(item.imageUrl || '').toLowerCase();
  const title = String(item.title || '').toLowerCase();
  const slot = String(item.slot || '').toLowerCase();
  const customTags = (item.customTags || []).map((tag) =>
    String(tag || '')
      .trim()
      .toLowerCase()
  );
  return (
    articleId.includes(term) ||
    imageUrl.includes(term) ||
    title.includes(term) ||
    slot.includes(term) ||
    customTags.some((tag) => tag.includes(term))
  );
}

function matchesGalleryItem(item, term, filters) {
  return (
    matchesGalleryProvider(item, filters.providerFilter) &&
    matchesGallerySlot(item, filters.slotFilter) &&
    matchesGalleryCustomTag(item, filters.customTagFilter) &&
    matchesGalleryFolder(item, filters.folderFilter) &&
    matchesGalleryTerm(item, term)
  );
}

function buildGalleryUploadData({
  file,
  index,
  normalizedProvider,
  uploadSlot,
  customTagsArray,
  uploadRenameFilename,
  pullTagsFromFilename,
  uploadTitle,
  uploadFolder,
  uploadFilesLength,
}) {
  if (!file || !file.name) throw new Error(`Invalid file at index ${index}`);
  if (!String(file.type || '').startsWith('image/'))
    throw new Error(`"${file.name}" is not an image file.`);

  const extension = getGalleryFileExtension(file);
  const baseName = getGalleryBaseName(file);
  const extractedTags = getGalleryExtractedTags(baseName, pullTagsFromFilename);
  const filenameBase = getGalleryFilenameBase({
    baseName,
    normalizedProvider,
    uploadSlot,
    customTagsArray,
    uploadRenameFilename,
  });
  const safeName = (slugifyFilename(filenameBase) || 'uploaded-image').toLowerCase();
  const storagePath = `${getGalleryStoragePath(safeName, index)}.${extension}`;
  const allTags = [...new Set([...extractedTags, ...customTagsArray])];
  const title = getGalleryUploadTitle({ uploadFilesLength, uploadTitle, baseName });

  return {
    extension,
    baseName,
    filenameBase,
    safeName,
    storagePath,
    allTags,
    title,
    folder: (uploadFolder || 'default').toLowerCase(),
  };
}

async function uploadGalleryFile({
  file,
  index,
  normalizedProvider,
  uploadSlot,
  customTagsArray,
  uploadRenameFilename,
  pullTagsFromFilename,
  uploadTitle,
  uploadFolder,
  uploadFilesLength,
}) {
  const uploadData = buildGalleryUploadData({
    file,
    index,
    normalizedProvider,
    uploadSlot,
    customTagsArray,
    uploadRenameFilename,
    pullTagsFromFilename,
    uploadTitle,
    uploadFolder,
    uploadFilesLength,
  });

  const storageRef = ref(getStorage(), uploadData.storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' });
  const imageUrl = await getDownloadURL(storageRef);

  await postJSON('createManualGalleryImageRecord', {
    articleId: 'manual-upload',
    imageUrl,
    provider: normalizedProvider,
    title: uploadData.title,
    slot: uploadSlot,
    storagePath: uploadData.storagePath,
    customTags: uploadData.allTags,
    folder: uploadData.folder,
  });

  return file.name;
}

export default function ImageGalleryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [slotFilter, setSlotFilter] = useState('all');
  const [customTagFilter, setCustomTagFilter] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadProvider, setUploadProvider] = useState('');
  const [uploadSlot, setUploadSlot] = useState('');
  const [uploadCustomTags, setUploadCustomTags] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [manualFolders, setManualFolders] = useState([]);
  const [uploadFolder, setUploadFolder] = useState('default');
  const [folderFilter, setFolderFilter] = useState('all');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [uploadRenameFilename, setUploadRenameFilename] = useState('');
  const [pullTagsFromFilename, setPullTagsFromFilename] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [selectedTagsForUpdate, setSelectedTagsForUpdate] = useState(new Set());
  const uploadInputRef = useRef(null);

  const fetchGallery = useCallback(async () => {
    try {
      setLoading(true);
      setDeleteError('');
      setItems(await loadGalleryItems());
    } catch (error) {
      console.error('Failed to fetch generated images:', error);
      setDeleteError(`Load failed: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGallery();
  }, [fetchGallery]);

  const providerOptions = useMemo(() => {
    const values = new Set(
      (items || [])
        .map((item) =>
          String(item.provider || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    );
    return ['all', ...Array.from(values).sort()];
  }, [items]);

  const slotOptions = useMemo(() => {
    const values = new Set(
      (items || [])
        .map((item) =>
          String(item.slot || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    );
    return ['all', ...Array.from(values).sort()];
  }, [items]);

  const customTagOptions = useMemo(() => {
    const values = new Set();
    (items || []).forEach((item) => {
      const tags = item.customTags || [];
      if (Array.isArray(tags)) {
        tags.forEach((tag) => {
          const trimmed = String(tag || '')
            .trim()
            .toLowerCase();
          if (trimmed) values.add(trimmed);
        });
      }
    });
    return ['all', ...Array.from(values).sort()];
  }, [items]);

  // Dynamically extract folders from database items + manual folders
  const folders = useMemo(() => {
    const folderSet = new Set(['default', 'aws', 'azure', 'gcp', 'finops', 'architecture']);
    // Add folders from database items
    items.forEach((item) => {
      const folder = String(item.folder || 'default')
        .trim()
        .toLowerCase();
      if (folder) folderSet.add(folder);
    });
    // Add manually created folders
    manualFolders.forEach((f) => folderSet.add(f.toLowerCase()));
    return Array.from(folderSet).sort();
  }, [items, manualFolders]);

  // Get all unique tags from gallery items for tag toggle subsection
  const allUniqueTags = useMemo(() => {
    const tagSet = new Set();
    items.forEach((item) => {
      if (item.customTags && Array.isArray(item.customTags)) {
        item.customTags.forEach((tag) => {
          if (tag && tag.trim()) tagSet.add(tag.toLowerCase());
        });
      }
    });
    return Array.from(tagSet).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return (items || []).filter((item) =>
      matchesGalleryItem(item, term, {
        providerFilter,
        slotFilter,
        customTagFilter,
        folderFilter,
      })
    );
  }, [items, providerFilter, slotFilter, customTagFilter, folderFilter, searchTerm]);

  const updateSlot = async (item, newSlot) => {
    setBusyId(item.id);
    try {
      await postJSON('updateGalleryImageMetadata', {
        imageId: item.id,
        galleryCollection: item.galleryCollection,
        slot: newSlot,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, slot: newSlot } : i)));
    } catch (error) {
      setDeleteError(`Slot update failed: ${error.message || error}`);
    } finally {
      setBusyId('');
    }
  };

  const copyText = async (text, itemId) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(itemId);
      setTimeout(() => setCopiedId(''), 2000);
    } catch (error) {
      console.error('Clipboard write failed:', error);
    }
  };

  const handleReuse = (item) => {
    if (!item?.imageUrl) return;
    navigate(`/admin/submit?reuseImage=${encodeURIComponent(item.imageUrl)}`);
  };

  const handleManualUpload = async () => {
    if (!uploadFiles || uploadFiles.length === 0) {
      const errorMsg = 'No files selected';
      setDeleteError(errorMsg);
      return;
    }

    setUploading(true);
    setDeleteError('');
    setUploadMessage('');

    try {
      const normalizedProvider = normalizeContentProvider(uploadProvider);
      const customTagsArray = uploadCustomTags
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);

      const uploadedCount = [];

      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        if (!file || !file.name) {
          console.warn(`Skipping invalid file at index ${i}`);
          continue;
        }

        uploadedCount.push(
          await uploadGalleryFile({
            file,
            index: i,
            normalizedProvider,
            uploadSlot,
            customTagsArray,
            uploadRenameFilename,
            pullTagsFromFilename,
            uploadTitle,
            uploadFolder,
            uploadFilesLength: uploadFiles.length,
          })
        );
      }

      setUploadFiles([]);
      setUploadTitle('');
      setUploadProvider('');
      setUploadSlot('');
      setUploadCustomTags('');
      if (uploadInputRef.current) {
        uploadInputRef.current.value = '';
      }
      setUploadMessage(
        `${uploadedCount.length} image${uploadedCount.length === 1 ? '' : 's'} uploaded to ${uploadFolder || 'Default'} folder.`
      );
      await fetchGallery();
    } catch (error) {
      setDeleteError(`Upload failed: ${error.message || error}`);
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const doDelete = async (item) => {
    setDeleteError('');
    setBusyId(item.id);
    try {
      if (item.galleryCollection === 'generated_content_images') {
        await postJSON('deleteContentGeneratedImage', { imageId: item.id });
      } else {
        await postJSON('deleteCuratedGeneratedImage', { articleId: item.articleId });
      }
      await fetchGallery();
    } catch (error) {
      setDeleteError(`Delete failed: ${error.message || error}`);
    } finally {
      setBusyId('');
    }
  };

  const handleAddFiles = (event) => {
    const newFiles = Array.from(event.target.files || []);
    setUploadFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveQueuedFile = (fileToRemove) => {
    setUploadFiles((prev) =>
      prev.filter((file) => file.name !== fileToRemove.name || file.size !== fileToRemove.size)
    );
  };

  const handleToggleSelect = (itemId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleCreateFolder = () => {
    const folderName = newFolderName.trim().toLowerCase();
    if (!folderName) {
      setDeleteError('Folder name cannot be empty');
      return;
    }
    if (folders.includes(folderName)) {
      setDeleteError('Folder already exists');
      return;
    }
    setManualFolders([...manualFolders, folderName].sort());
    setNewFolderName('');
    setShowNewFolderInput(false);
    setUploadMessage(`Folder "${folderName}" created successfully.`);
  };

  const handleDeleteFolder = async (folderName) => {
    const lowerFolderName = folderName.toLowerCase();
    if (lowerFolderName === 'default') {
      setDeleteError('Cannot delete Default folder');
      return;
    }

    const imagesInFolder = items.filter(
      (item) => (item.folder || 'default').toLowerCase() === lowerFolderName
    );
    if (imagesInFolder.length > 0) {
      setDeleteError(
        `Cannot delete folder "${folderName}" - it contains ${imagesInFolder.length} image(s). Move or delete images first.`
      );
      return;
    }

    setManualFolders(manualFolders.filter((f) => f.toLowerCase() !== lowerFolderName));
    if (folderFilter.toLowerCase() === lowerFolderName) setFolderFilter('all');
    if (uploadFolder.toLowerCase() === lowerFolderName) setUploadFolder('default');
    setUploadMessage(`Folder "${folderName}" deleted successfully.`);
  };

  const handleRemoveCustomTag = (tagToRemove) => {
    const tagsArray = uploadCustomTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && t !== tagToRemove);
    setUploadCustomTags(tagsArray.join(', '));
  };

  const handleUpdateImage = async (itemId) => {
    setBusyId(itemId);
    try {
      const item = items.find((it) => it.id === itemId);
      if (!item) throw new Error('Item not found');

      // Get tags from custom tags input (new permanent tags)
      const newCustomTags = uploadCustomTags
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);

      // Merge with selected tags from toggles
      const allTags = new Set([...selectedTagsForUpdate, ...newCustomTags]);
      const finalTags = Array.from(allTags);

      const updateData = {
        id: itemId,
        galleryCollection: item.galleryCollection,
      };

      // Update provider if a value is set
      if (uploadProvider) {
        updateData.provider = uploadProvider.toLowerCase();
      }

      // Update slot if a value is set
      if (uploadSlot) {
        updateData.slot = uploadSlot.toLowerCase();
      }

      // Update custom tags
      if (finalTags.length > 0) {
        updateData.customTags = finalTags;
      }

      await postJSON('updateGalleryImageMetadata', updateData);

      setUploadMessage(`✓ Image updated`);
      await fetchGallery();
      setUploadProvider('');
      setUploadSlot('');
      setUploadCustomTags('');
      setSelectedTagsForUpdate(new Set());
    } catch (error) {
      console.error('Update error:', error);
      setDeleteError(`Update failed: ${error.message || error}`);
    } finally {
      setBusyId('');
    }
  };

  const handleRenameImage = async (itemId, newTitle) => {
    if (!newTitle.trim()) {
      setDeleteError('Title cannot be empty');
      return;
    }

    setBusyId(itemId);
    try {
      const item = items.find((it) => it.id === itemId);
      if (!item) throw new Error('Item not found');

      await postJSON('updateGalleryImageMetadata', {
        id: itemId,
        galleryCollection: item.galleryCollection,
        title: newTitle.trim(),
      });

      setEditingItemId(null);
      setEditingTitle('');
      await fetchGallery();
    } catch (error) {
      console.error('Rename error:', error);
      setDeleteError(`Rename failed: ${error.message || error}`);
    } finally {
      setBusyId('');
    }
  };

  const handleMoveToFolder = async (itemId, newFolder) => {
    setBusyId(itemId);
    try {
      const item = items.find((it) => it.id === itemId);
      if (!item) throw new Error('Item not found');

      await postJSON('updateGalleryImageMetadata', {
        id: itemId,
        galleryCollection: item.galleryCollection,
        folder: newFolder.toLowerCase(),
      });

      await fetchGallery();
    } catch (error) {
      console.error('Move error:', error);
      setDeleteError(`Move failed: ${error.message || error}`);
    } finally {
      setBusyId('');
    }
  };

  let galleryContent = null;
  if (loading) {
    galleryContent = (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading gallery...</CardContent>
      </Card>
    );
  } else if (filtered.length === 0) {
    galleryContent = (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No generated images found for the current filters.
        </CardContent>
      </Card>
    );
  } else {
    galleryContent = (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item) => {
          const provider = String(item.provider || 'UNKNOWN').toUpperCase();
          const imageUrl = item.imageUrl || '';
          const isBusy = busyId === item.id;
          const sourceLabel = getSourceLabel(item.sourceCollection);
          const isSelected = selectedIds.has(item.id);
          const customTags = item.customTags || [];

          return (
            <Card key={item.id} className="overflow-hidden">
              <div className="aspect-video bg-muted/40 relative">
                {imageUrl ? (
                  <img src={imageUrl} alt={item.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    No image URL
                  </div>
                )}
                <div className="absolute top-2 left-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelect(item.id)}
                    className="h-5 w-5 cursor-pointer"
                  />
                </div>
              </div>

              <CardHeader className="pb-2">
                <div className="flex items-start gap-2">
                  <CardTitle className="truncate text-sm flex-1" title={item.title}>
                    {editingItemId === item.id ? (
                      <div className="flex gap-2">
                        <Input
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className="h-7 text-sm"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') handleRenameImage(item.id, editingTitle);
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleRenameImage(item.id, editingTitle)}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => {
                            setEditingItemId(null);
                            setEditingTitle('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      item.title
                    )}
                  </CardTitle>
                  {editingItemId !== item.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItemId(item.id);
                        setEditingTitle(item.title || '');
                      }}
                      className="text-muted-foreground hover:text-primary"
                      title="Rename image"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{provider}</Badge>
                  <Badge variant="outline">{sourceLabel}</Badge>
                  {customTags.map((tag, idx) => (
                    <Badge key={idx} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                  <select
                    value={item.slot || ''}
                    disabled={isBusy}
                    onChange={(e) => updateSlot(item, e.target.value)}
                    className="rounded border border-input bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary focus:outline-none disabled:opacity-50"
                    title="Change slot tag"
                  >
                    {SLOT_OPTIONS.map((opt) => (
                      <option key={opt.value || 'none'} value={opt.value}>
                        {opt.value ? opt.label : '— slot —'}
                      </option>
                    ))}
                  </select>
                  <select
                    value={(item.folder || 'default').toLowerCase()}
                    disabled={isBusy}
                    onChange={(e) => handleMoveToFolder(item.id, e.target.value)}
                    className="rounded border border-input bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary focus:outline-none disabled:opacity-50"
                    title="Move to folder"
                  >
                    {folders.map((folder) => (
                      <option key={folder} value={folder}>
                        📁 {folder}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                <p className="truncate text-xs text-muted-foreground" title={item.articleId}>
                  {item.articleId}
                </p>
              </CardHeader>

              <CardContent className="space-y-2">
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all text-xs text-blue-600 hover:underline"
                >
                  Open image <ExternalLink className="h-3 w-3" />
                </a>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleReuse(item)}
                    disabled={!imageUrl || isBusy}
                    className="gap-1"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Reuse
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyText(imageUrl, `url-${item.id}`)}
                    disabled={!imageUrl || isBusy}
                    className="gap-1"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedId === `url-${item.id}` ? 'Copied!' : 'Copy URL'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyText(`![${item.title}](${imageUrl})`, `md-${item.id}`)}
                    disabled={!imageUrl || isBusy}
                    className="gap-1"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedId === `md-${item.id}` ? 'Copied!' : 'Copy Markdown'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteTarget(item)}
                    disabled={isBusy}
                    className="gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-3xl font-bold text-slate-900 dark:text-white">AI Image Gallery</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Organize and manage AI-generated images with folder management, custom tagging, and
          advanced filtering.
        </p>
        {deleteError && <p className="mt-1 text-sm text-destructive">{deleteError}</p>}
      </div>

      {/* SECTION 1: Upload Images */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Section 1: Upload Images
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* File Upload */}
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold mb-2">Select Files</p>
                <Input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleAddFiles}
                  className="cursor-pointer"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Select multiple files at once or add files incrementally
                </p>
              </div>

              {uploadFiles.length > 0 && (
                <div className="rounded-md border border-border p-3 bg-muted/30">
                  <p className="mb-2 text-sm font-medium">Queued Files ({uploadFiles.length})</p>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {uploadFiles.map((file, idx) => (
                      <Badge
                        key={`${file.name}-${file.size}-${idx}`}
                        variant="outline"
                        className="gap-1"
                      >
                        {file.name}
                        <button
                          type="button"
                          onClick={() => handleRemoveQueuedFile(file)}
                          className="ml-1 text-destructive hover:text-destructive/80"
                          title="Remove from queue"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Folder Management */}
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Upload Destination Folder
                </p>
                <select
                  value={uploadFolder}
                  onChange={(e) => setUploadFolder(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-2"
                >
                  {folders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Images will be organized into this folder
                </p>
              </div>

              <div className="rounded-md border border-border p-3 bg-muted/30">
                <p className="text-sm font-medium mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FolderPlus className="h-4 w-4" />
                    Manage Folders
                  </span>
                  {!showNewFolderInput && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowNewFolderInput(true)}
                      className="h-6 gap-1 text-xs"
                    >
                      <FolderPlus className="h-3 w-3" /> New
                    </Button>
                  )}
                </p>

                {showNewFolderInput && (
                  <div className="flex gap-2 mb-3">
                    <Input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="New folder name"
                      className="h-8 text-sm"
                      onKeyPress={(e) => e.key === 'Enter' && handleCreateFolder()}
                    />
                    <Button type="button" size="sm" onClick={handleCreateFolder} className="h-8">
                      Create
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowNewFolderInput(false);
                        setNewFolderName('');
                      }}
                      className="h-8"
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {folders.map((folder) => (
                    <Badge key={folder} variant="secondary" className="gap-2">
                      {folder}
                      {folder !== 'Default' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteFolder(folder)}
                          className="text-destructive hover:text-destructive/80"
                          title="Delete folder"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Rename Section */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-semibold">Rename Files</p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <Input
                  value={uploadRenameFilename}
                  onChange={(e) => setUploadRenameFilename(e.target.value)}
                  placeholder="Custom filename (optional)"
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Override auto-generated filenames with a custom name
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pullTagsCheckbox"
                  checked={pullTagsFromFilename}
                  onChange={(e) => setPullTagsFromFilename(e.target.checked)}
                  className="h-4 w-4 cursor-pointer"
                />
                <label htmlFor="pullTagsCheckbox" className="text-sm cursor-pointer">
                  Pull Tags from Filename (split by hyphen)
                </label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              When &quot;Pull Tags&quot; is checked, tags will be extracted from hyphenated
              filenames (e.g., &quot;aws-lambda-migration&quot; → [&quot;aws&quot;,
              &quot;lambda&quot;, &quot;migration&quot;])
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t">
            <div className="text-xs text-muted-foreground">
              {uploadMessage || `Upload images to the ${uploadFolder} folder with custom metadata`}
            </div>
            <Button
              type="button"
              onClick={handleManualUpload}
              disabled={uploading || uploadFiles.length === 0}
              className="gap-2"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? 'Uploading...' : `Upload ${uploadFiles.length || ''} to ${uploadFolder}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: Tags & Metadata Management */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Section 2: Tags & Metadata Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold">Provider Tag</p>
              <select
                value={uploadProvider}
                onChange={(event) => setUploadProvider(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {COMMON_PROVIDERS.map((option) => (
                  <option key={option.value || 'none'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Cloud platform or category</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Slot Tag</p>
              <select
                value={uploadSlot}
                onChange={(event) => setUploadSlot(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {SLOT_OPTIONS.map((option) => (
                  <option key={option.value || 'none'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Image placement type</p>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <p className="text-sm font-semibold">Add New Custom Tags</p>
              <Input
                value={uploadCustomTags}
                onChange={(event) => setUploadCustomTags(event.target.value)}
                placeholder="migration, serverless, kubernetes"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Add comma-separated tags that will become permanent
              </p>
              {uploadCustomTags.trim() && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {uploadCustomTags
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                    .map((tag, idx) => (
                      <Badge key={idx} variant="secondary" className="gap-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomTag(tag)}
                          className="text-destructive hover:text-destructive/80"
                          title="Remove tag"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Tag Toggle Subsection */}
          {allUniqueTags.length > 0 && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-semibold">Toggle Existing Tags</p>
              <p className="text-xs text-muted-foreground">
                Select/deselect tags to attach or remove from the selected image
              </p>
              <div className="flex flex-wrap gap-2">
                {allUniqueTags.map((tag) => {
                  const isSelected = selectedTagsForUpdate.has(tag);
                  return (
                    <Badge
                      key={tag}
                      variant={isSelected ? 'default' : 'outline'}
                      className="cursor-pointer gap-2"
                      onClick={() => {
                        const newSet = new Set(selectedTagsForUpdate);
                        if (isSelected) {
                          newSet.delete(tag);
                        } else {
                          newSet.add(tag);
                        }
                        setSelectedTagsForUpdate(newSet);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="h-3 w-3 cursor-pointer pointer-events-none"
                      />
                      {tag}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t">
            <Button
              type="button"
              variant="default"
              onClick={() =>
                selectedIds.size >= 1 ? handleUpdateImage([...selectedIds][0]) : null
              }
              disabled={selectedIds.size === 0}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Update Selected Image{selectedIds.size > 1 ? 's' : ''} ({selectedIds.size})
            </Button>
          </div>

          <div className="text-xs text-muted-foreground border-t pt-3">
            <p>
              <strong>How to Update:</strong> Select images from the gallery below using checkboxes.
              Set Provider Tag, Slot Tag, add new custom tags, or toggle existing tags, then click
              &quot;Update Selected Image(s)&quot; to apply changes.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 3: Search & Filter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            🔍 Section 3: Search & Filter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by title, tags, or URL"
              className="sm:col-span-2"
            />

            <select
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter by Folder"
            >
              <option value="all">All Folders</option>
              <option value="--none--">--none--</option>
              {folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>

            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter by Provider"
            >
              <option value="all">All Providers</option>
              {COMMON_PROVIDERS.filter((p) => p.value).map((option) => (
                <option key={option.value} value={option.value.toUpperCase()}>
                  {option.label}
                </option>
              ))}
              {providerOptions
                .filter(
                  (value) =>
                    value !== 'all' &&
                    !COMMON_PROVIDERS.some((p) => p.value.toUpperCase() === value)
                )
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
            </select>

            <select
              value={slotFilter}
              onChange={(e) => setSlotFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter by Slot"
            >
              {slotOptions.map((value) => (
                <option key={value} value={value}>
                  {value === 'all' ? 'All Slots' : value}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              value={customTagFilter}
              onChange={(e) => setCustomTagFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter by Custom Tag"
            >
              {customTagOptions.map((value) => (
                <option key={value} value={value}>
                  {value === 'all' ? 'All Custom Tags' : value}
                </option>
              ))}
            </select>

            <Button type="button" variant="outline" onClick={fetchGallery} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh Gallery
            </Button>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm font-medium text-muted-foreground">
              {loading
                ? 'Loading images...'
                : `Showing ${filtered.length} of ${items.length} images${
                    selectedIds.size > 0 ? ` • ${selectedIds.size} selected` : ''
                  }${folderFilter !== 'all' ? ` • Folder: ${folderFilter}` : ''}`}
            </span>
          </div>
        </CardContent>
      </Card>

      {galleryContent}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete this image?"
        description={
          deleteTarget
            ? `Delete generated image for ${deleteTarget.title}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={() => {
          const item = deleteTarget;
          setDeleteTarget(null);
          doDelete(item);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
