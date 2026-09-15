/**
 * Add or edit one certification: a modal over whichever tab opened it. Saving
 * POSTs a new cert or PATCHes an existing one through `cms/certifications`
 * and hands the saved row back with `onSaved`; the badge image uploads
 * through `cms/uploads/certifications`.
 *
 * Save and upload each have an in-flight guard held in a ref, so a double
 * click sends one request, not two — the disabled button only takes effect
 * after the re-render the first click causes.
 */
import React, { useRef, useState } from 'react';
import { postJSON, sendJSON } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { Award, Loader2, GraduationCap, Wand2 } from 'lucide-react';
import { detectIssuer, getVendorForIssuer, getLearnUrl } from '@/lib/certIssuers';
import { COLLECTION, emptyForm, fromIso, issuerOf, resolveImage, toIso } from './certView';
import {
  BadgeImageField,
  DisplayOrderField,
  IMAGE_RULES,
  IssuerField,
  VisibilityFlags,
} from './editorFields';

export function initialForm(cert) {
  return {
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
  };
}

/** The document a save writes. */
export function buildPayload(form) {
  const s = (v) => String(v ?? '').trim();
  const canonicalIssuer = detectIssuer(form.issuer)?.name || s(form.issuer) || 'Unknown';
  return {
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
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function imageProblem(file) {
  if (!file.type.startsWith('image/')) return { title: 'Not an image', description: file.type };
  if (file.size > IMAGE_RULES.maxBytes) {
    return { title: 'Image too large', description: `Max ${IMAGE_RULES.maxLabel}` };
  }
  return null;
}

function useImageUpload(cert, set, toast) {
  const [uploading, setUploading] = useState(false);
  const inFlight = useRef(false);

  const upload = async (file) => {
    if (!file || inFlight.current) return;
    const problem = imageProblem(file);
    if (problem) {
      toast({ ...problem, variant: 'destructive' });
      return;
    }
    inFlight.current = true;
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const id = cert._docId || `new-${Date.now()}`;
      const uploaded = await postJSON('cms/uploads/certifications', {
        path: `${id}/images/badge-${Date.now()}.${ext}`,
        contentType: file.type || 'image/png',
        dataBase64: await readAsBase64(file),
      });
      set('imageUrl', uploaded.url);
      toast({ title: 'Image uploaded' });
    } catch (err) {
      console.error('[Certifications] upload failed', err);
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      inFlight.current = false;
      setUploading(false);
    }
  };
  return { uploading, upload };
}

function useSave({ cert, form, onSaved, onClose, toast }) {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const isNew = !cert._docId;

  const save = async () => {
    if (inFlight.current) return;
    if (!String(form.name ?? '').trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const payload = buildPayload(form);
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
      inFlight.current = false;
      setSaving(false);
    }
  };
  return { saving, save, isNew };
}

function TextField({ label, value, onChange, placeholder, className = 'col-span-2', type }) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function LearnUrlField({ form, set, toast }) {
  const autoSuggest = () => {
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
  return (
    <div className="col-span-2">
      <Label className="text-xs flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5" />
          Provider Learn page
        </span>
        <button
          type="button"
          onClick={autoSuggest}
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
  );
}

export default function CertEditor({ cert, allCerts, onClose, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(() => initialForm(cert));
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const { uploading, upload } = useImageUpload(cert, set, toast);
  const { saving, save, isNew } = useSave({ cert, form, onSaved, onClose, toast });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-500" />
            {isNew ? 'Add Certification' : 'Edit Certification'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Name *"
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder="Google Cloud Professional Cloud Architect"
            />
            <TextField
              label="Code"
              className=""
              value={form.code}
              onChange={(v) => set('code', v)}
              placeholder="PCA"
            />
            <IssuerField form={form} set={set} allCerts={allCerts} />
            <TextField
              label="Issue date"
              className=""
              type="date"
              value={form.issueDate}
              onChange={(v) => set('issueDate', v)}
            />
            <TextField
              label="Expiration date"
              className=""
              type="date"
              value={form.expDate}
              onChange={(v) => set('expDate', v)}
            />
            <TextField
              label="Verify URL"
              value={form.verifyUrl}
              onChange={(v) => set('verifyUrl', v)}
              placeholder="https://www.credly.com/badges/…"
            />
            <LearnUrlField form={form} set={set} toast={toast} />
            <BadgeImageField
              imageUrl={form.imageUrl}
              uploading={uploading}
              onFile={upload}
              onClear={() => set('imageUrl', '')}
            />
            <TextField
              label="Image URL"
              value={form.imageUrl}
              onChange={(v) => set('imageUrl', v)}
              placeholder="https://images.credly.com/size/340x340/…"
            />
            <div className="col-span-2">
              <Label className="text-xs">Description / story (optional)</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Why this matters, what I learned, where I used it…"
              />
            </div>
            <DisplayOrderField form={form} set={set} allCerts={allCerts} docId={cert._docId} />
            <VisibilityFlags form={form} set={set} />
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
