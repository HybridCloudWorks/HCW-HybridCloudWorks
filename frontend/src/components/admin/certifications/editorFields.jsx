/**
 * The larger fields of the certification editor, each with its own small
 * state: the issuer picker, the badge image drop zone, the display order with
 * its vendor ladder, and the visibility checkboxes. CertEditor owns the form;
 * these read `form` and call `set(key, value)`.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Award, Loader2, UploadCloud, X, ChevronDown } from 'lucide-react';
import { detectIssuer, getVendorForIssuer, VENDOR_LABELS, getIssuerColor } from '@/lib/certIssuers';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { issuerOf } from './certView';

/** Image upload limits; the Settings tab shows the same numbers. */
export const IMAGE_RULES = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxLabel: '5 MB',
  accept: 'image/*',
  formats: 'PNG / JPG / SVG',
});

/**
 * The issuer picker list, built from real values in the certifications
 * collection, case-insensitive deduped, sorted alphabetically. This is the
 * source of truth — admins should never see a curated list that doesn't match
 * what's actually on disk.
 */
export function issuerOptionsFrom(allCerts) {
  const map = new Map();
  (allCerts || []).forEach((c) => {
    const v = issuerOf(c);
    if (!v || v === 'Unknown') return;
    const key = v.toLowerCase();
    if (!map.has(key)) map.set(key, v);
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function IssuerOptions({ options, current, onPick }) {
  return (
    <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg text-sm">
      {options.length === 0 && (
        <li className="px-3 py-1.5 text-slate-500 italic">No issuers yet — type to add one.</li>
      )}
      {options.map((n) => (
        <li key={n}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(n);
            }}
            className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${
              current === n ? 'bg-indigo-50 dark:bg-indigo-900/30 font-semibold' : ''
            }`}
          >
            {n}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function IssuerField({ form, set, allCerts }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => issuerOptionsFrom(allCerts), [allCerts]);
  const issuerMatch = detectIssuer(form.issuer);
  const vendorMeta = VENDOR_LABELS[getVendorForIssuer(form.issuer)] || VENDOR_LABELS.other;

  return (
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
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Pick or type…"
          className="pr-8"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="Show all issuers"
          tabIndex={-1}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        {open && (
          <IssuerOptions
            options={options}
            current={form.issuer}
            onPick={(n) => {
              set('issuer', n);
              setOpen(false);
            }}
          />
        )}
      </div>
      {vendorMeta.path && (
        <p className="text-[10px] text-slate-500 mt-1">
          Will appear on <span className="font-mono">{vendorMeta.path}</span>
        </p>
      )}
    </div>
  );
}

function ImagePreview({ imageUrl }) {
  return (
    <>
      {imageUrl ? (
        <img
          src={resolveMediaUrl(imageUrl)}
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
          imageUrl ? 'hidden' : ''
        }`}
      >
        <Award className="h-6 w-6 text-slate-400" />
      </div>
    </>
  );
}

function UploadStatus({ uploading }) {
  return (
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
        {IMAGE_RULES.formats} · max {IMAGE_RULES.maxLabel}. Uploaded through the Azure API to Blob
        Storage and saved as the Image URL on save.
      </p>
    </div>
  );
}

export function BadgeImageField({ imageUrl, uploading, onFile, onClear }) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const openPicker = () => fileInputRef.current?.click();

  return (
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
          if (f) onFile(f);
        }}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
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
          accept={IMAGE_RULES.accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        <ImagePreview imageUrl={imageUrl} />
        <UploadStatus uploading={uploading} />
        {imageUrl && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            title="Clear image"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Siblings sharing this issuer — used to scope display_order and visualize the vendor ladder. */
export function siblingsOf(allCerts, docId, issuer) {
  const matchIssuer = (issuer || '').trim().toLowerCase();
  if (!matchIssuer) return [];
  return (allCerts || [])
    .filter((c) => c._docId !== docId)
    .filter((c) => issuerOf(c).toLowerCase() === matchIssuer)
    .map((c) => ({
      _docId: c._docId,
      name: c.name,
      code: c.code,
      order: Number(c.display_order ?? 999),
    }))
    .sort((a, b) => a.order - b.order);
}

/** The lowest order number no sibling uses. */
export function nextFreeOrder(siblings) {
  const used = new Set(siblings.map((s) => s.order));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

function SiblingLadder({ siblings, issuer, order }) {
  if (siblings.length === 0) return null;
  return (
    <div className="mt-2 p-2 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
        Other certs from {issuer}
      </p>
      <ul className="space-y-0.5 text-[11px]">
        {siblings.map((s) => {
          const conflict = s.order === Number(order);
          return (
            <li
              key={s._docId}
              className={`flex items-center justify-between gap-2 ${
                conflict ? 'text-rose-600 font-semibold' : 'text-slate-600 dark:text-slate-400'
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
  );
}

export function DisplayOrderField({ form, set, allCerts, docId }) {
  const siblings = useMemo(
    () => siblingsOf(allCerts, docId, form.issuer),
    [allCerts, docId, form.issuer]
  );
  return (
    <div className="col-span-2">
      <Label className="text-xs flex items-center justify-between">
        <span>
          Display order
          {form.issuer ? <span className="text-slate-500"> within {form.issuer}</span> : null}
        </span>
        <button
          type="button"
          onClick={() => set('display_order', nextFreeOrder(siblings))}
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
      <SiblingLadder siblings={siblings} issuer={form.issuer} order={form.display_order} />
    </div>
  );
}

function Flag({ checked, onChange, children }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function VisibilityFlags({ form, set }) {
  return (
    <div className="flex flex-col gap-2 justify-end pb-1">
      <Flag checked={form.display} onChange={(v) => set('display', v)}>
        Show on About page
      </Flag>
      <p className="text-[10px] text-slate-500 -mt-1">
        New certifications default to visible; hide only when you want them excluded from About.
      </p>
      <Flag checked={form.featured} onChange={(v) => set('featured', v)}>
        Feature in Spotlight
      </Flag>
      <Flag checked={form.certState} onChange={(v) => set('certState', v)}>
        Currently active
      </Flag>
    </div>
  );
}
