/**
 * The application workspace (ADR 0033 §4): one pursuit of one program, with
 * everything a credible application needs in one place — the status and its
 * history, the dates, the requirement checklist with the evidence attached
 * to each, the written responses with character counts, files and images,
 * links, notes, reviewer feedback, a print-friendly packet and a JSON export.
 *
 * Every save is a PATCH of the fields on screen; a status change is a PATCH
 * with `status` and a note, which the API checks against its transition
 * table and appends to `history[]`. The record is private by default and is
 * never published anywhere.
 *
 * Files: the upload route accepts images only (admin-uploads.js), so the
 * "Files & images" upload takes images; documents go in Links. Uploads land
 * in the private `speakerevents` container under `ambassador/{id}/`, so they
 * are never anonymously reachable; the list shows names, not public URLs.
 */
import React, { useMemo, useRef, useState } from 'react';
import { postJSON } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Download, FileText, Loader2, Printer, Save, Trash2, Upload } from 'lucide-react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { TabLoading } from '@/components/admin/integrations/TabNotice';
import {
  allowedTransitions,
  ambassadorStatusInfo,
  applicationExport,
  downloadJson,
  evidenceRelevant,
  sourceLabel,
  todayIso,
} from './ambassadorModel';
import {
  Field,
  INPUT,
  LinkList,
  ReadinessPanel,
  SelectField,
  TextAreaField,
  TextField,
  whenText,
} from './Parts';
import useReadiness from './useReadiness';

const DATE_FIELDS = [
  ['applicationDate', 'Application date'],
  ['submissionDeadline', 'Submission deadline'],
  ['decisionDate', 'Decision date'],
  ['startDate', 'Award start'],
  ['expirationDate', 'Award expires'],
  ['renewalDate', 'Renewal date'],
];

const RESPONSE_MAX = 4000;

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/** The editable fields of an application, as the form holds them. */
export function workspaceForm(application) {
  const a = application || {};
  return {
    title: a.title || '',
    qualificationPeriod: {
      start: a.qualificationPeriod?.start || '',
      end: a.qualificationPeriod?.end || '',
    },
    applicationDate: a.applicationDate || '',
    submissionDeadline: a.submissionDeadline || '',
    decisionDate: a.decisionDate || '',
    startDate: a.startDate || '',
    expirationDate: a.expirationDate || '',
    renewalDate: a.renewalDate || '',
    notes: a.notes || '',
    reviewerFeedback: a.reviewerFeedback || '',
    responses: (a.responses || []).map((r) => ({
      questionId: r.questionId || '',
      text: r.text || '',
    })),
    links: (a.links || []).map((l) => ({ label: l.label || '', url: l.url || '' })),
    badgeImageUrl: a.badgeImageUrl || '',
    private: a.private !== false,
  };
}

/** What a save sends: dates as plain days or null, empties as null, lists cleaned. */
export function workspacePayload(form) {
  const day = (v) => (v ? v : null);
  return {
    title: form.title.trim(),
    qualificationPeriod:
      form.qualificationPeriod.start || form.qualificationPeriod.end
        ? { start: day(form.qualificationPeriod.start), end: day(form.qualificationPeriod.end) }
        : null,
    applicationDate: day(form.applicationDate),
    submissionDeadline: day(form.submissionDeadline),
    decisionDate: day(form.decisionDate),
    startDate: day(form.startDate),
    expirationDate: day(form.expirationDate),
    renewalDate: day(form.renewalDate),
    notes: form.notes,
    reviewerFeedback: form.reviewerFeedback,
    responses: form.responses
      .filter((r) => r.questionId.trim())
      .map((r) => ({ questionId: r.questionId.trim(), text: r.text })),
    links: form.links
      .filter((l) => /^https?:\/\//i.test(l.url.trim()))
      .map((l) => ({ label: l.label.trim() || l.url.trim(), url: l.url.trim() })),
    badgeImageUrl: form.badgeImageUrl.trim() || null,
    private: form.private,
  };
}

function StatusChange({ application, onChange, busy }) {
  const [next, setNext] = useState('');
  const [note, setNote] = useState('');
  const options = allowedTransitions(application.status);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label="Change status"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!next) return;
        const ok = await onChange({ status: next, statusNote: note.trim() });
        if (ok) {
          setNext('');
          setNote('');
        }
      }}
    >
      <SelectField
        id="application-next-status"
        label="Move to"
        value={next}
        onChange={setNext}
        options={[
          { value: '', label: 'Choose…' },
          ...options.map((s) => ({ value: s, label: ambassadorStatusInfo(s).label })),
        ]}
      />
      <TextField
        id="application-status-note"
        label="Note for the history"
        value={note}
        onChange={setNote}
        placeholder="What happened"
        className="min-w-56 flex-1"
      />
      <Button type="submit" size="sm" disabled={!next || busy}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        Apply
      </Button>
    </form>
  );
}

function RequirementChecklist({ program, application, evidence, readiness, onToggle, busy }) {
  const attached = new Set(application.evidenceIds || []);
  const relevant = evidence.filter((e) => evidenceRelevant(e, program.id));
  return (
    <div className="space-y-4">
      {(program.requirements || []).map((req) => {
        const row = readiness?.requirements?.find((r) => r.id === req.id);
        const candidates = relevant.filter(
          (e) => req.evidenceTypes.length === 0 || req.evidenceTypes.includes(e.sourceModule)
        );
        return (
          <div key={req.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {req.label}{' '}
                <span className="text-xs text-muted-foreground">
                  · at least {req.minCount} from{' '}
                  {req.evidenceTypes.map(sourceLabel).join(', ') || 'any source'}
                </span>
              </p>
              {row && (
                <StatusBadge
                  size="xs"
                  status={{
                    id: row.met ? 'met' : 'open',
                    label: row.met
                      ? `Met · ${row.count}/${row.minCount}`
                      : `Open · ${row.count}/${row.minCount}`,
                    tone: row.met ? 'ok' : 'warn',
                    help: req.description,
                  }}
                />
              )}
            </div>
            {req.description && (
              <p className="mt-1 text-xs text-muted-foreground">{req.description}</p>
            )}
            {candidates.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No evidence of these types yet. Import or add some on the Evidence tab.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {candidates.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <input
                      id={`attach-${req.id}-${item.id}`}
                      type="checkbox"
                      checked={attached.has(item.id)}
                      disabled={busy}
                      onChange={() => onToggle(item.id)}
                    />
                    <label htmlFor={`attach-${req.id}-${item.id}`}>
                      {item.title}{' '}
                      <span className="text-xs text-muted-foreground">
                        · {item.date || 'undated'} · {sourceLabel(item.sourceModule)}
                        {item.verificationStatus === 'verified' ? ' · verified' : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {(program.requirements || []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          This program has no requirements yet; add them on Settings to get a checklist.
        </p>
      )}
    </div>
  );
}

function Packet({ application, program, evidence, onClose }) {
  const attached = evidence.filter((e) => (application.evidenceIds || []).includes(e.id));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl print:max-h-none print:shadow-none">
        <DialogHeader>
          <DialogTitle>{program?.name || 'Application'} — application packet</DialogTitle>
        </DialogHeader>
        <article className="space-y-4 text-sm" aria-label="Application packet">
          <p className="text-muted-foreground">
            Status {ambassadorStatusInfo(application.status).label}
            {application.qualificationPeriod?.start || application.qualificationPeriod?.end
              ? ` · qualification period ${application.qualificationPeriod.start || '…'} to ${application.qualificationPeriod.end || '…'}`
              : ''}
          </p>
          <section>
            <h3 className="font-semibold">Responses</h3>
            {(application.responses || []).length === 0 && (
              <p className="text-muted-foreground">None written yet.</p>
            )}
            {(application.responses || []).map((r) => (
              <div key={r.questionId} className="mt-2">
                <p className="font-medium">{r.questionId}</p>
                <p className="whitespace-pre-wrap">{r.text}</p>
              </div>
            ))}
          </section>
          <section>
            <h3 className="font-semibold">Evidence ({attached.length})</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {attached.map((e) => (
                <li key={e.id}>
                  {e.title} — {e.date || 'undated'} · {sourceLabel(e.sourceModule)}
                  {e.url ? ` · ${e.url}` : ''}
                </li>
              ))}
            </ul>
          </section>
          {(application.links || []).length > 0 && (
            <section>
              <h3 className="font-semibold">Links</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {application.links.map((l) => (
                  <li key={l.url}>
                    {l.label} — {l.url}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {application.notes && (
            <section>
              <h3 className="font-semibold">Notes</h3>
              <p className="whitespace-pre-wrap">{application.notes}</p>
            </section>
          )}
        </article>
        <div className="flex justify-end gap-2 print:hidden">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ApplicationWorkspace({ application, program, evidence, hub, onClose }) {
  const { toast } = useToast();
  const [form, setForm] = useState(() => workspaceForm(application));
  const [formFor, setFormFor] = useState(application.id);
  const [packet, setPacket] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef(null);
  const readiness = useReadiness(program?.id, '', { enabled: Boolean(program) });
  const busy = hub.busyIds.has(application.id);
  const today = todayIso();

  // A different application selected: the form follows it (adjusted during render, React's rule for prop-driven state).
  if (formFor !== application.id) {
    setFormFor(application.id);
    setForm(workspaceForm(application));
  }

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = useMemo(
    () =>
      JSON.stringify(workspacePayload(form)) !==
      JSON.stringify(workspacePayload(workspaceForm(application))),
    [form, application]
  );

  const save = async (event) => {
    event?.preventDefault?.();
    const saved = await hub.writes.patchApplication(application.id, workspacePayload(form));
    return Boolean(saved);
  };

  const changeStatus = async (body) =>
    Boolean(await hub.writes.patchApplication(application.id, body));

  const toggleEvidence = async (evidenceId) => {
    const current = application.evidenceIds || [];
    const next = current.includes(evidenceId)
      ? current.filter((id) => id !== evidenceId)
      : [...current, evidenceId];
    await hub.writes.patchApplication(application.id, { evidenceIds: next }, { quiet: true });
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
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '-');
      const result = await postJSON('cms/uploads/speakerevents', {
        path: `ambassador/${application.id}/${Date.now()}-${safeName.replace(/\.[^.]+$/, '')}.${ext}`,
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

  const exportJson = () => {
    const ok = downloadJson(
      `${(program?.name || 'application').replace(/\s+/g, '-').toLowerCase()}-${application.id}.json`,
      applicationExport(application, program, evidence)
    );
    toast(
      ok
        ? { title: 'Export downloaded' }
        : { title: 'Export is not available in this browser', variant: 'destructive' }
    );
  };

  return (
    <Card className="border-2 border-primary/30" data-testid="application-workspace">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              {program?.name || application.title}
              <StatusBadge status={ambassadorStatusInfo(application.status)} />
              {application.private !== false && (
                <StatusBadge
                  size="xs"
                  status={{
                    id: 'private',
                    label: 'Private',
                    tone: 'muted',
                    help: 'Never published; export is a file you keep.',
                  }}
                />
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {program?.provider} · started {application.createdAt?.slice(0, 10)}
              {application.submissionDeadline
                ? ` · deadline ${whenText(application.submissionDeadline, today)}`
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setPacket(true)}>
              <FileText className="mr-1 h-3.5 w-3.5" /> Packet
            </Button>
            <Button size="sm" variant="outline" onClick={exportJson}>
              <Download className="mr-1 h-3.5 w-3.5" /> Export JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <StatusChange application={application} onChange={changeStatus} busy={busy} />
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="workspace-checklist">
          <h3 id="workspace-checklist" className="mb-2 text-sm font-semibold">
            Requirement checklist
          </h3>
          {readiness.loading && <TabLoading>Computing readiness…</TabLoading>}
          {readiness.loaded && <ReadinessPanel readiness={readiness.data} compact />}
          <div className="mt-3">
            {program ? (
              <RequirementChecklist
                program={program}
                application={application}
                evidence={evidence}
                readiness={readiness.data}
                onToggle={toggleEvidence}
                busy={busy}
              />
            ) : (
              <p className="text-sm text-destructive">
                This application names a program that no longer exists.
              </p>
            )}
          </div>
        </section>

        <form className="space-y-6" onSubmit={save} aria-label="Application details">
          <section aria-labelledby="workspace-dates">
            <h3 id="workspace-dates" className="mb-2 text-sm font-semibold">
              Dates and decision
            </h3>
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                id="application-title"
                label="Title"
                value={form.title}
                onChange={set('title')}
                className="md:col-span-3"
              />
              <TextField
                id="application-period-start"
                label="Qualification period start"
                type="date"
                value={form.qualificationPeriod.start}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    qualificationPeriod: { ...f.qualificationPeriod, start: v },
                  }))
                }
              />
              <TextField
                id="application-period-end"
                label="Qualification period end"
                type="date"
                value={form.qualificationPeriod.end}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    qualificationPeriod: { ...f.qualificationPeriod, end: v },
                  }))
                }
              />
              <div />
              {DATE_FIELDS.map(([key, label]) => (
                <TextField
                  key={key}
                  id={`application-${key}`}
                  label={label}
                  type="date"
                  value={form[key]}
                  onChange={set(key)}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="workspace-responses" className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 id="workspace-responses" className="text-sm font-semibold">
                Responses
              </h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set('responses')([...form.responses, { questionId: '', text: '' }])}
              >
                Add response
              </Button>
            </div>
            {form.responses.length === 0 && (
              <p className="text-sm text-muted-foreground">
                One entry per question the program asks; the character count keeps each inside its
                limit.
              </p>
            )}
            {form.responses.map((r, index) => (
              <div key={index} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-end gap-2">
                  <TextField
                    id={`response-${index}-question`}
                    label="Question"
                    value={r.questionId}
                    onChange={(v) =>
                      set('responses')(
                        form.responses.map((x, i) => (i === index ? { ...x, questionId: v } : x))
                      )
                    }
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Remove response ${index + 1}`}
                    onClick={() => set('responses')(form.responses.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <TextAreaField
                  id={`response-${index}-text`}
                  label="Answer"
                  rows={5}
                  maxLength={RESPONSE_MAX}
                  value={r.text}
                  onChange={(v) =>
                    set('responses')(
                      form.responses.map((x, i) => (i === index ? { ...x, text: v } : x))
                    )
                  }
                />
              </div>
            ))}
          </section>

          <section aria-labelledby="workspace-files" className="space-y-3">
            <h3 id="workspace-files" className="text-sm font-semibold">
              Files, images and links
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Upload an image"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => uploadRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3.5 w-3.5" />
                )}
                Upload image
              </Button>
              <span className="text-xs text-muted-foreground">
                Stored privately under this application; images only, documents as links below.
              </span>
            </div>
            {(application.files || []).length > 0 && (
              <ul className="space-y-1 text-sm">
                {application.files.map((f) => (
                  <li key={f.url} className="flex items-center justify-between gap-2">
                    <span>
                      {f.name}{' '}
                      <span className="text-xs text-muted-foreground">
                        {f.bytes ? `· ${Math.round(f.bytes / 1024)} KB` : ''}{' '}
                        {f.uploadedAt ? `· ${f.uploadedAt.slice(0, 10)}` : ''}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={`Remove file ${f.name}`}
                      onClick={() => removeFile(f.url)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <LinkList
              idPrefix="application-link"
              title="Links"
              hint="Documents, portfolios, the submitted form."
              rows={form.links}
              onChange={set('links')}
            />
            <TextField
              id="application-badge"
              label="Badge image URL"
              type="url"
              placeholder="https://..."
              value={form.badgeImageUrl}
              onChange={set('badgeImageUrl')}
              hint="Once awarded."
            />
          </section>

          <section aria-labelledby="workspace-notes" className="grid gap-3 md:grid-cols-2">
            <h3 id="workspace-notes" className="sr-only">
              Notes
            </h3>
            <TextAreaField
              id="application-notes"
              label="Notes"
              rows={5}
              value={form.notes}
              onChange={set('notes')}
            />
            <TextAreaField
              id="application-feedback"
              label="Reviewer feedback"
              rows={5}
              value={form.reviewerFeedback}
              onChange={set('reviewerFeedback')}
              hint="What the program said back."
            />
            <Field id="application-private" label="Visibility" className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  id="application-private"
                  type="checkbox"
                  checked={form.private}
                  onChange={(e) => set('private')(e.target.checked)}
                />
                Private (never published; the only output is the packet and the export)
              </label>
            </Field>
          </section>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={busy || !dirty}>
              {busy ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Save details
            </Button>
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          </div>
        </form>

        <section aria-labelledby="workspace-history">
          <h3 id="workspace-history" className="mb-2 text-sm font-semibold">
            History
          </h3>
          <ol className="space-y-1 text-sm">
            {[...(application.history || [])].reverse().map((row, index) => (
              <li key={`${row.at}-${index}`} className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.at?.slice(0, 16).replace('T', ' ')}
                </span>
                <span>
                  {row.from ? `${ambassadorStatusInfo(row.from).label} → ` : ''}
                  {ambassadorStatusInfo(row.to).label}
                </span>
                {row.note && <span className="text-muted-foreground">— {row.note}</span>}
                <span className="text-xs text-muted-foreground">by {row.by}</span>
              </li>
            ))}
          </ol>
        </section>
      </CardContent>

      {packet && (
        <Packet
          application={application}
          program={program}
          evidence={evidence}
          onClose={() => setPacket(false)}
        />
      )}
      <ConfirmModal
        open={confirmDelete}
        title="Delete this application?"
        description="It is kept in the store with a deletion stamp and disappears from every list. Deleting needs the publisher role."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          if (await hub.writes.deleteApplication(application.id)) onClose();
        }}
      />
      <span className="hidden">{INPUT}</span>
    </Card>
  );
}
