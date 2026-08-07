/**
 * Certifications Admin — CRUD for the `certifications` container (via the
 * cms/certifications API) that powers the About page. Lets me curate the showcase: stats, search, filters,
 * featured highlight, bulk display toggle, expiring-soon view, and edit/delete.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import PublishSnapshotButton from '@/components/admin/PublishSnapshotButton';
import {
  Award,
  Search,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ExternalLink,
  CheckSquare,
  Star,
  StarOff,
  CalendarClock,
  Loader2,
  AlertTriangle,
  UploadCloud,
  X,
  GraduationCap,
  Wand2,
  ChevronDown,
} from 'lucide-react';
import {
  VENDOR_LABELS,
  detectIssuer,
  getVendorForIssuer,
  getLearnUrl,
  getIssuerColor,
} from '@/lib/certIssuers';

const COLLECTION = 'certifications';

/** Convert legacy storage.googleapis.com GCS URLs to firebasestorage REST format so
 *  storage rules apply and the browser can fetch without auth. */
const normalizeUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return raw;
  const m = raw.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
  if (!m) return raw;
  const [, bucket, path] = m;
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
};

/** Build an ordered list of candidate image URLs from a cert doc. CertImage walks
 *  the list on each load error so a flaky Credly URL falls back to the Storage copy. */
const resolveImages = (cert) => {
  const out = [];
  if (cert?.imageUrl) out.push(normalizeUrl(cert.imageUrl));
  if (Array.isArray(cert?.image)) {
    for (const a of cert.image) {
      if (a?.downloadURL) {
        const u = normalizeUrl(a.downloadURL);
        if (!out.includes(u)) out.push(u);
      }
    }
  }
  return out;
};

const resolveImage = (cert) => resolveImages(cert)[0] || '';

/** Img with fallback chain. Renders Award placeholder when all URLs fail. */
function CertImage({ urls, alt, className, placeholderClassName }) {
  const [idx, setIdx] = useState(0);
  if (!urls.length || idx >= urls.length) {
    return (
      <div
        className={`${className} flex items-center justify-center bg-slate-100 dark:bg-slate-800 ${placeholderClassName || ''}`}
      >
        <Award className="h-6 w-6 text-slate-400" />
      </div>
    );
  }
  return (
    <img
      src={urls[idx]}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

const toIso = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val?.toDate) return val.toDate().toISOString().slice(0, 10);
  if (val?.seconds) return new Date(val.seconds * 1000).toISOString().slice(0, 10);
  return '';
};

const fromIso = (s) => (s ? new Date(`${s}T00:00:00Z`).toISOString() : null);

const issuerOf = (cert) => {
  const i = cert.issuer;
  if (Array.isArray(i)) return i[0] || 'Unknown';
  return i || 'Unknown';
};

const emptyForm = {
  name: '',
  code: '',
  issuer: '',
  issueDate: '',
  expDate: '',
  verifyUrl: '',
  learnUrl: '',
  imageUrl: '',
  description: '',
  display: true,
  certState: true,
  featured: false,
  display_order: 999,
};

function getCertCardClassName(cert) {
  return [
    'overflow-hidden transition-all',
    cert.display ? '' : 'opacity-60',
    cert.featured ? 'ring-2 ring-amber-400' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function getCertDateText(cert, isExpired) {
  const issueDate = toIso(cert.issueDate) || '—';
  const expDate = toIso(cert.expDate);
  let dateLabel = 'Valid since';
  if (expDate) {
    dateLabel = isExpired ? 'Expired on' : 'Valid until';
  }
  const dateValue = expDate || issueDate;
  return { dateLabel, dateValue };
}

function CertStatusBadges({ cert, isExpired, isExpiringSoon }) {
  return (
    <>
      {cert.featured && (
        <Badge variant="outline" className="border-amber-400 text-amber-600 text-[10px]">
          Featured
        </Badge>
      )}
      {!cert.display && (
        <Badge variant="outline" className="text-[10px]">
          Hidden
        </Badge>
      )}
      {isExpired && (
        <Badge variant="destructive" className="text-[10px]">
          Expired
        </Badge>
      )}
      {isExpiringSoon && (
        <Badge variant="outline" className="border-amber-400 text-amber-600 text-[10px]">
          Expiring
        </Badge>
      )}
    </>
  );
}

function CertActionButtons({ cert, issuer, onEdit, onToggleDisplay, onToggleFeatured, onDelete }) {
  return (
    <div className="flex gap-1 mt-2">
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onEdit(cert)}>
        <Pencil className="h-3 w-3 mr-1" />
        Edit
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        onClick={() => onToggleDisplay(cert)}
        title={cert.display ? 'Hide from About page' : 'Show on About page'}
      >
        {cert.display ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        onClick={() => onToggleFeatured(cert)}
        title={cert.featured ? 'Unfeature' : 'Feature'}
      >
        {cert.featured ? <StarOff className="h-3 w-3" /> : <Star className="h-3 w-3" />}
      </Button>
      {cert.verifyUrl ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => window.open(cert.verifyUrl, '_blank', 'noopener')}
          title="Verify"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      ) : (
        <span
          className="inline-flex h-7 items-center justify-center rounded border border-slate-200 px-2 text-slate-400 dark:border-slate-700 dark:text-slate-400"
          title="Verification unavailable"
          aria-label="Verification unavailable"
        >
          <CheckSquare className="h-3 w-3" />
        </span>
      )}
      {(cert.learnUrl || getLearnUrl(issuer, cert.code)) && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() =>
            window.open(cert.learnUrl || getLearnUrl(issuer, cert.code), '_blank', 'noopener')
          }
          title="Open provider Learn page"
        >
          <GraduationCap className="h-3 w-3" />
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-rose-600 hover:bg-rose-50"
        onClick={() => onDelete(cert)}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function CertCard({ cert, nowMs, onEdit, onToggleDisplay, onToggleFeatured, onDelete }) {
  const issuer = issuerOf(cert);
  const expDate = toIso(cert.expDate);
  const expMs = expDate ? new Date(expDate).getTime() : 0;
  const isExpired = expMs > 0 && expMs < nowMs;
  const isExpiringSoon = expMs > 0 && !isExpired && expMs < nowMs + 90 * 24 * 60 * 60 * 1000;
  const { dateValue } = getCertDateText(cert, isExpired);

  return (
    <Card className={getCertCardClassName(cert)}>
      <CardContent className="p-4 flex gap-3">
        <CertImage
          key={cert._docId || cert.id}
          urls={resolveImages(cert)}
          alt={cert.name}
          className="h-16 w-16 rounded object-contain bg-slate-50 dark:bg-slate-800 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{cert.name || '(untitled)'}</p>
              <p className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${getIssuerColor(issuer)}`}
                >
                  {issuer}
                </span>
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <CertStatusBadges cert={cert} isExpired={isExpired} isExpiringSoon={isExpiringSoon} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {dateValue}
            {cert.display_order !== null && cert.display_order !== undefined && (
              <> · order {cert.display_order}</>
            )}
          </p>
          <CertActionButtons
            cert={cert}
            issuer={issuer}
            onEdit={onEdit}
            onToggleDisplay={onToggleDisplay}
            onToggleFeatured={onToggleFeatured}
            onDelete={onDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CertEditor({ cert, allCerts, onClose, onSaved }) {
  const isNew = !cert._docId;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [issuerOpen, setIssuerOpen] = useState(false);
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    ...cert,
    name: cert.name || '',
    code: cert.code || '',
    verifyUrl: cert.verifyUrl || '',
    issuer: issuerOf(cert) === 'Unknown' && !cert._docId ? '' : issuerOf(cert),
    issueDate: toIso(cert.issueDate),
    expDate: toIso(cert.expDate),
    description: cert.description || '',
    imageUrl: cert.imageUrl || resolveImage(cert) || '',
    learnUrl: cert.learnUrl || '',
  }));

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Siblings sharing this issuer — used to scope display_order and visualize the
  // vendor ladder for this cert.
  const siblings = useMemo(() => {
    const matchIssuer = (form.issuer || '').trim().toLowerCase();
    if (!matchIssuer) return [];
    return (allCerts || [])
      .filter((c) => c._docId !== cert._docId)
      .filter((c) => issuerOf(c).toLowerCase() === matchIssuer)
      .map((c) => ({
        _docId: c._docId,
        name: c.name,
        code: c.code,
        order: Number(c.display_order ?? 999),
      }))
      .sort((a, b) => a.order - b.order);
  }, [allCerts, cert._docId, form.issuer]);

  const issuerMatch = detectIssuer(form.issuer);
  const vendor = getVendorForIssuer(form.issuer);
  const vendorMeta = VENDOR_LABELS[vendor] || VENDOR_LABELS.other;

  // Build the picker list from real values in the certifications collection,
  // case-insensitive deduped, sorted alphabetically. This is the source of truth
  // — admins should never see a curated list that doesn't match what's actually
  // on disk.
  const issuerOptions = useMemo(() => {
    const map = new Map();
    (allCerts || []).forEach((c) => {
      const v = issuerOf(c);
      if (!v || v === 'Unknown') return;
      const key = v.toLowerCase();
      if (!map.has(key)) map.set(key, v);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [allCerts]);

  const suggestNextOrder = () => {
    const used = new Set(siblings.map((s) => s.order));
    let n = 1;
    while (used.has(n)) n += 1;
    set('display_order', n);
  };

  const autoSuggestLearn = () => {
    const url = getLearnUrl(form.issuer, form.code);
    if (!url) {
      toast({
        title: 'No mapping yet',
        description: `Pick a known issuer or add ${form.issuer || 'this issuer'} to certIssuers.js.`,
        variant: 'destructive',
      });
      return;
    }
    set('learnUrl', url);
    toast({ title: 'Learn URL filled', description: url });
  };

  const uploadImage = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Not an image', description: file.type, variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Max 5\u202fMB', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const id = cert._docId || `new-${Date.now()}`;
      const path = `${id}/images/badge-${Date.now()}.${ext}`;
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      const uploaded = await postJSON('cms/uploads/certifications', {
        path,
        contentType: file.type || 'image/png',
        dataBase64,
      });
      set('imageUrl', uploaded.url);
      toast({ title: 'Image uploaded' });
    } catch (err) {
      console.error('[Certifications] upload failed', err);
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const s = (v) => String(v ?? '').trim();
    if (!s(form.name)) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const canonicalIssuer = issuerMatch?.name || s(form.issuer) || 'Unknown';
      const payload = {
        name: s(form.name),
        code: s(form.code) || null,
        issuer: canonicalIssuer,
        vendor: getVendorForIssuer(canonicalIssuer),
        issueDate: fromIso(form.issueDate),
        expDate: fromIso(form.expDate),
        verifyUrl: s(form.verifyUrl) || null,
        learnUrl: s(form.learnUrl) || null,
        imageUrl: s(form.imageUrl) || null,
        description: s(form.description) || null,
        display: Boolean(form.display),
        certState: Boolean(form.certState),
        featured: Boolean(form.featured),
        display_order: Number(form.display_order) || 999,
      };
      // The server stamps _createdAt/_updatedAt.
      if (isNew) {
        const created = await postJSON(`cms/${COLLECTION}`, payload);
        onSaved({ _docId: created.id, ...payload });
      } else {
        await sendJSON(`cms/${COLLECTION}/${cert._docId}`, 'PATCH', payload);
        onSaved({ ...cert, ...payload });
      }
      toast({ title: isNew ? 'Certification added' : 'Saved' });
      onClose();
    } catch (err) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-500" />
            {isNew ? 'Add Certification' : 'Edit Certification'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Google Cloud Professional Cloud Architect"
              />
            </div>
            <div>
              <Label className="text-xs">Code</Label>
              <Input
                value={form.code}
                onChange={(e) => set('code', e.target.value)}
                placeholder="PCA"
              />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-2">
                Issuer
                {issuerMatch && (
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${getIssuerColor(form.issuer)}`}
                  >
                    {issuerMatch.name}
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  value={form.issuer}
                  onChange={(e) => set('issuer', e.target.value)}
                  onFocus={() => setIssuerOpen(true)}
                  onBlur={() => setTimeout(() => setIssuerOpen(false), 150)}
                  placeholder="Pick or type…"
                  className="pr-8"
                />
                <button
                  type="button"
                  onClick={() => setIssuerOpen((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Show all issuers"
                  tabIndex={-1}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                {issuerOpen && (
                  <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg text-sm">
                    {issuerOptions.length === 0 && (
                      <li className="px-3 py-1.5 text-slate-500 italic">
                        No issuers yet — type to add one.
                      </li>
                    )}
                    {issuerOptions.map((n) => (
                      <li key={n}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            set('issuer', n);
                            setIssuerOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                            form.issuer === n
                              ? 'bg-indigo-50 dark:bg-indigo-900/30 font-semibold'
                              : ''
                          }`}
                        >
                          {n}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {vendorMeta.path && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Will appear on <span className="font-mono">{vendorMeta.path}</span>
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Issue date</Label>
              <Input
                type="date"
                value={form.issueDate}
                onChange={(e) => set('issueDate', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Expiration date</Label>
              <Input
                type="date"
                value={form.expDate}
                onChange={(e) => set('expDate', e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Verify URL</Label>
              <Input
                value={form.verifyUrl}
                onChange={(e) => set('verifyUrl', e.target.value)}
                placeholder="https://www.credly.com/badges/…"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <GraduationCap className="h-3.5 w-3.5" />
                  Provider Learn page
                </span>
                <button
                  type="button"
                  onClick={autoSuggestLearn}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  <Wand2 className="h-3 w-3" /> Auto-suggest
                </button>
              </Label>
              <Input
                value={form.learnUrl}
                onChange={(e) => set('learnUrl', e.target.value)}
                placeholder="https://learn.microsoft.com/en-us/credentials/certifications/…"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Used to link this cert to the official learning path on the provider site.
              </p>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Badge image</Label>
              <div
                role="button"
                tabIndex={0}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) uploadImage(f);
                }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`mt-1 flex items-center gap-3 rounded-md border-2 border-dashed p-3 cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-slate-300 dark:border-slate-700 hover:border-amber-300'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadImage(f);
                    e.target.value = '';
                  }}
                />
                {form.imageUrl ? (
                  <img
                    src={form.imageUrl}
                    alt="Preview"
                    referrerPolicy="no-referrer"
                    className="h-16 w-16 rounded object-contain bg-white"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <div
                  className={`h-16 w-16 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center ${
                    form.imageUrl ? 'hidden' : ''
                  }`}
                >
                  <Award className="h-6 w-6 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    {uploading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Uploading…
                      </>
                    ) : (
                      <>
                        <UploadCloud className="h-3.5 w-3.5" />
                        Drag & drop or click to upload
                      </>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    PNG / JPG / SVG · max 5\u202fMB. Uploaded to Firebase Storage and saved as the
                    Image URL on save.
                  </p>
                </div>
                {form.imageUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      set('imageUrl', '');
                    }}
                    title="Clear image"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Image URL</Label>
              <Input
                value={form.imageUrl}
                onChange={(e) => set('imageUrl', e.target.value)}
                placeholder="https://images.credly.com/size/340x340/…"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Description / story (optional)</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Why this matters, what I learned, where I used it…"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs flex items-center justify-between">
                <span>
                  Display order
                  {form.issuer ? (
                    <span className="text-slate-500"> within {form.issuer}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={suggestNextOrder}
                  disabled={!form.issuer}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-slate-400"
                >
                  Suggest next
                </button>
              </Label>
              <Input
                type="number"
                value={form.display_order}
                onChange={(e) => set('display_order', e.target.value)}
              />
              {siblings.length > 0 && (
                <div className="mt-2 p-2 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                    Other certs from {form.issuer}
                  </p>
                  <ul className="space-y-0.5 text-[11px]">
                    {siblings.map((s) => {
                      const conflict = s.order === Number(form.display_order);
                      return (
                        <li
                          key={s._docId}
                          className={`flex items-center justify-between gap-2 ${
                            conflict
                              ? 'text-rose-600 font-semibold'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <span className="truncate">
                            <span className="font-mono text-[10px] mr-1">#{s.order}</span>
                            {s.name}
                            {s.code ? ` (${s.code})` : ''}
                          </span>
                          {conflict && <span className="text-[9px]">conflict</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 justify-end pb-1">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.display}
                  onChange={(e) => set('display', e.target.checked)}
                />
                Show on About page
              </label>
              <p className="text-[10px] text-slate-500 -mt-1">
                New certifications default to visible; hide only when you want them excluded from
                About.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) => set('featured', e.target.checked)}
                />
                Feature in Spotlight
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.certState}
                  onChange={(e) => set('certState', e.target.checked)}
                />
                Currently active
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isNew ? 'Add' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CertificationsPage() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [issuerFilter, setIssuerFilter] = useState('');
  const [view, setView] = useState('all'); // all | featured | hidden | expiring
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getJSON(`cms/${COLLECTION}`);
      const rows = (res.items || []).map((item) => ({ _docId: item.id, ...item }));
      rows.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
      setItems(rows);
    } catch (err) {
      console.error('[Certifications] load failed', err);
      setLoadError(err.message || String(err));
      toast({ title: 'Failed to load', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!authReady) return;
    queueMicrotask(() => {
      load();
    });
  }, [authReady, load]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const issuers = useMemo(() => {
    const set = new Set(items.map(issuerOf));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((c) => {
      if (q && !`${c.name} ${c.code || ''} ${issuerOf(c)}`.toLowerCase().includes(q)) return false;
      if (issuerFilter && issuerOf(c) !== issuerFilter) return false;
      if (view === 'featured' && !c.featured) return false;
      if (view === 'hidden' && c.display === true) return false;
      if (view === 'expiring') {
        const exp = toIso(c.expDate);
        if (!exp) return false;
        const t = new Date(exp).getTime();
        if (t < nowMs || t > nowMs + 180 * 24 * 60 * 60 * 1000) return false;
      }
      return true;
    });
  }, [items, search, issuerFilter, view, nowMs]);

  const stats = useMemo(() => {
    const total = items.length;
    const shown = items.filter((c) => c.display === true).length;
    const featured = items.filter((c) => c.featured).length;
    const expiringSoon = items.filter((c) => {
      const exp = toIso(c.expDate);
      if (!exp) return false;
      const t = new Date(exp).getTime();
      return t > nowMs && t < nowMs + 90 * 24 * 60 * 60 * 1000;
    }).length;
    const issuerCounts = items.reduce((acc, c) => {
      const k = issuerOf(c);
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    const [topIssuer] = Object.entries(issuerCounts).sort((a, b) => b[1] - a[1]);
    return { total, shown, featured, expiringSoon, topIssuer };
  }, [items, nowMs]);

  const handleEdit = (cert) => setEditing(cert);
  const handleNew = () =>
    setEditing({ ...emptyForm, display_order: (items.at(-1)?.display_order || 0) + 1 });

  const handleSaved = (saved) => {
    setItems((p) => {
      const idx = p.findIndex((x) => x._docId === saved._docId);
      if (idx === -1) return [...p, saved];
      const copy = [...p];
      copy[idx] = saved;
      return copy;
    });
  };

  const patchCert = async (cert, patch) => {
    try {
      await sendJSON(`cms/${COLLECTION}/${cert._docId}`, 'PATCH', patch);
      setItems((p) => p.map((c) => (c._docId === cert._docId ? { ...c, ...patch } : c)));
    } catch (err) {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (cert) => {
    try {
      await sendJSON(`cms/${COLLECTION}/${cert._docId}`, 'DELETE');
      setItems((p) => p.filter((c) => c._docId !== cert._docId));
      toast({ title: 'Deleted' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <ServicePageHeader
            icon={Award}
            title="Certifications"
            service="Firestore"
            connected={loading ? 'checking' : !loadError}
            description="Curate the certification showcase on the About page — feature the wins, hide the noise, and stay ahead of renewals."
            poweredBy="Firestore"
            accent="amber"
          />
        </div>
        <PublishSnapshotButton />
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 p-3 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Failed to read Firestore</p>
            <p className="font-mono text-[11px] mt-0.5 break-all">{loadError}</p>
          </div>
          <Button size="sm" variant="outline" className="h-7" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Total</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Showing</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.shown}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Featured</p>
            <p className="text-2xl font-bold text-amber-500">{stats.featured}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Expiring 90d</p>
            <p className="text-2xl font-bold text-rose-500">{stats.expiringSoon}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Top issuer</p>
            <p className="text-sm font-bold truncate">
              {stats.topIssuer ? `${stats.topIssuer[0]} (${stats.topIssuer[1]})` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-48">
          <Label className="text-xs">Search</Label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <Input
              className="pl-8 h-8 text-xs"
              placeholder="Name, code, issuer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Issuer</Label>
          <select
            className="block h-8 w-44 text-xs mt-1 rounded-md border border-input bg-background px-2"
            value={issuerFilter}
            onChange={(e) => setIssuerFilter(e.target.value)}
          >
            <option value="">All issuers</option>
            {issuers.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-1 flex-wrap">
          {['all', 'featured', 'expiring', 'hidden'].map((v) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? 'default' : 'outline'}
              className="h-8 capitalize"
              onClick={() => setView(v)}
            >
              {v === 'expiring' && <CalendarClock className="h-3 w-3 mr-1" />}
              {v === 'featured' && <Star className="h-3 w-3 mr-1" />}
              {v}
            </Button>
          ))}
        </div>
        <Button size="sm" className="h-8 ml-auto" onClick={handleNew}>
          <Plus className="h-4 w-4 mr-1" />
          Add cert
        </Button>
      </div>

      {/* Grid */}
      {(() => {
        if (loading) {
          return (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          );
        }
        if (filtered.length === 0) {
          return (
            <div className="text-center py-12 text-sm text-slate-400">
              No certifications match these filters.
            </div>
          );
        }
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((cert) => (
              <CertCard
                key={cert._docId || cert.id}
                cert={cert}
                nowMs={nowMs}
                onEdit={handleEdit}
                onToggleDisplay={(c) => patchCert(c, { display: c.display !== true })}
                onToggleFeatured={(c) => patchCert(c, { featured: !c.featured })}
                onDelete={(c) => setConfirmDelete(c)}
              />
            ))}
          </div>
        );
      })()}

      {editing && (
        <CertEditor
          cert={editing}
          allCerts={items}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-500" />
                <p className="font-semibold">Delete this certification?</p>
              </div>
              <p className="text-xs text-slate-500">
                <strong>{confirmDelete.name}</strong> will be permanently removed. The About page
                snapshot updates on next build.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
