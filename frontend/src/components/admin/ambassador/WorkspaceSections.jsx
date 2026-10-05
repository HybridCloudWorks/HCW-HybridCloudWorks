/**
 * The application workspace's panels (ADR 0033 §4), one component per
 * section so each is read on its own: the header with its actions, the
 * dates, the written responses, files and links, notes, and the history.
 * The form state and every write stay in ApplicationWorkspace.jsx.
 */
import React, { useRef } from 'react';
import { UPLOAD_ACCEPT, fileKey } from './useApplicationUpload';
import { Button } from '@/components/ui/button';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { Download, FileText, Loader2, Save, Trash2, Upload } from 'lucide-react';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { ambassadorStatusInfo } from './ambassadorModel';
import GuidedResponses from './GuidedResponses';
import { Field, LinkList, TextAreaField, TextField, whenText } from './Parts';

const DATE_FIELDS = [
  ['applicationDate', 'Application date'],
  ['submissionDeadline', 'Submission deadline'],
  ['decisionDate', 'Decision date'],
  ['startDate', 'Award start'],
  ['expirationDate', 'Award expires'],
  ['renewalDate', 'Renewal date'],
];

const RESPONSE_MAX = 4000;

const PRIVATE = {
  id: 'private',
  label: 'Private',
  tone: 'muted',
  help: 'Never published; export is a file you keep.',
};

/** The name, the status badges, the dates line and the actions; `children` is the status change form. */
export function WorkspaceHeader({ application, program, today, busy, actions, children }) {
  const deadline = application.submissionDeadline
    ? ` · deadline ${whenText(application.submissionDeadline, today)}`
    : '';
  return (
    <CardHeader className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            {program?.name || application.title}
            <StatusBadge status={ambassadorStatusInfo(application.status)} />
            {application.private !== false && <StatusBadge size="xs" status={PRIVATE} />}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {program?.provider} · started {application.createdAt?.slice(0, 10)}
            {deadline}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={actions.onPacket}>
            <FileText className="mr-1 h-3.5 w-3.5" /> Packet
          </Button>
          <Button size="sm" variant="outline" onClick={actions.onExport}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={actions.onDelete}
            disabled={busy}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={actions.onClose}>
            Close
          </Button>
        </div>
      </div>
      {children}
    </CardHeader>
  );
}

/** Title, the qualification period and every dated field. */
export function DatesSection({ form, set, setForm }) {
  const setPeriod = (key) => (value) =>
    setForm((f) => ({ ...f, qualificationPeriod: { ...f.qualificationPeriod, [key]: value } }));
  return (
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
          onChange={setPeriod('start')}
        />
        <TextField
          id="application-period-end"
          label="Qualification period end"
          type="date"
          value={form.qualificationPeriod.end}
          onChange={setPeriod('end')}
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
  );
}

/**
 * The written responses. A program with official `applicationQuestions`
 * gets the guided form (GuidedResponses.jsx); any other keeps the free list,
 * one entry per question with a character count on each answer.
 */
export function ResponsesSection({ responses, onChange, program, evidence, title }) {
  const questions = program?.applicationQuestions;
  if (Array.isArray(questions) && questions.length > 0) {
    return (
      <GuidedResponses
        questions={questions}
        responses={responses}
        onChange={onChange}
        evidence={evidence || []}
        title={title}
      />
    );
  }
  return <FreeResponses responses={responses} onChange={onChange} />;
}

function FreeResponses({ responses, onChange }) {
  const update = (index, patch) =>
    onChange(responses.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  return (
    <section aria-labelledby="workspace-responses" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 id="workspace-responses" className="text-sm font-semibold">
          Responses
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...responses, { questionId: '', text: '' }])}
        >
          Add response
        </Button>
      </div>
      {responses.length === 0 && (
        <p className="text-sm text-muted-foreground">
          One entry per question the program asks; the character count keeps each inside its limit.
        </p>
      )}
      {responses.map((r, index) => (
        <div key={index} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-end gap-2">
            <TextField
              id={`response-${index}-question`}
              label="Question"
              value={r.questionId}
              onChange={(v) => update(index, { questionId: v })}
              className="flex-1"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              aria-label={`Remove response ${index + 1}`}
              onClick={() => onChange(responses.filter((_, i) => i !== index))}
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
            onChange={(v) => update(index, { text: v })}
          />
        </div>
      ))}
    </section>
  );
}

/** One stored file: its name, size and date, Download for a private one, and Remove. */
function FileRow({ file, busy, onRemove, onDownload }) {
  const size = file.bytes ? `· ${Math.round(file.bytes / 1024)} KB` : '';
  const when = file.uploadedAt ? `· ${file.uploadedAt.slice(0, 10)}` : '';
  return (
    <li className="flex items-center justify-between gap-2">
      <span>
        {file.url ? (
          <a href={file.url} target="_blank" rel="noreferrer" className="underline">
            {file.name}
          </a>
        ) : (
          file.name
        )}{' '}
        <span className="text-xs text-muted-foreground">
          {size} {when}
        </span>
      </span>
      {file.path && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Download file ${file.name}`}
          onClick={onDownload}
          disabled={busy}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive"
        aria-label={`Remove file ${file.name}`}
        onClick={onRemove}
        disabled={busy}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

/** The image upload, the stored files, the links and the badge URL. */
export function FilesSection({ application, files, form, set, busy }) {
  const uploadRef = useRef(null);
  const stored = application.files || [];
  return (
    <section aria-labelledby="workspace-files" className="space-y-3">
      <h3 id="workspace-files" className="text-sm font-semibold">
        Files, images and links
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={uploadRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          aria-label="Upload a file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) files.upload(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => uploadRef.current?.click()}
          disabled={files.uploading}
        >
          {files.uploading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1 h-3.5 w-3.5" />
          )}
          Upload file
        </Button>
        <span className="text-xs text-muted-foreground">
          Stored privately under this application: images, and documents to archive (PDF, Word,
          Excel, PowerPoint, CSV, text). Anything else as a link below.
        </span>
      </div>
      {stored.length > 0 && (
        <ul className="space-y-1 text-sm">
          {stored.map((f) => (
            <FileRow
              key={fileKey(f)}
              file={f}
              busy={busy}
              onRemove={() => files.removeFile(fileKey(f))}
              onDownload={() => files.download(f)}
            />
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
  );
}

/** Notes, the program's feedback and the visibility flag. */
export function NotesSection({ form, set }) {
  return (
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
  );
}

/** The Save button and the unsaved-changes note. */
export function SaveRow({ busy, dirty }) {
  return (
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
  );
}

/** Every status move, newest first, with who made it and the note. */
export function HistorySection({ history }) {
  return (
    <section aria-labelledby="workspace-history">
      <h3 id="workspace-history" className="mb-2 text-sm font-semibold">
        History
      </h3>
      <ol className="space-y-1 text-sm">
        {[...(history || [])].reverse().map((row, index) => (
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
  );
}
