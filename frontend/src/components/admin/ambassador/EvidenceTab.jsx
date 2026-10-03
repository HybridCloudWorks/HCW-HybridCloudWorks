/**
 * Evidence (ADR 0033 §4): the library every application draws on. Filters
 * by source module, program relevance, period and verification; add by hand;
 * import from Speaking, Certifications and Published content with a picker
 * that marks what is already in; edit, verify and delete each item.
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, Download, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { safeUrl } from '@/lib/safeUrl';
import {
  EVIDENCE_SOURCES,
  IMPORT_SOURCES,
  evidenceRelevant,
  programById,
  sourceLabel,
} from './ambassadorModel';
import EvidenceEditor from './EvidenceEditor';
import ImportDialog from './ImportDialog';
import { ReadsStatus, SelectField, allLanded } from './Parts';

const VERIFIED = {
  id: 'verified',
  label: 'Verified',
  tone: 'ok',
  help: 'A reviewer could confirm it from the URL or files.',
};
const UNVERIFIED = {
  id: 'unverified',
  label: 'Unverified',
  tone: 'muted',
  help: 'Recorded, not yet confirmed.',
};

function yearsOf(evidence) {
  return [
    ...new Set(
      evidence.map((e) => String(e.date || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y))
    ),
  ]
    .sort()
    .reverse();
}

export default function EvidenceTab({ hub }) {
  const { programs, evidence } = hub;
  const reads = [programs, evidence];
  const [source, setSource] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [year, setYear] = useState('');
  const [verification, setVerification] = useState('');
  const [editing, setEditing] = useState(null); // null | {} (new) | item
  const [importing, setImporting] = useState(null); // source module
  const [confirmDelete, setConfirmDelete] = useState(null);
  const byId = useMemo(() => programById(programs.data), [programs.data]);
  const years = useMemo(() => yearsOf(evidence.data), [evidence.data]);

  const rows = useMemo(
    () =>
      evidence.data.filter(
        (e) =>
          (!source || e.sourceModule === source) &&
          (!programFilter || evidenceRelevant(e, programFilter)) &&
          (!year || String(e.date || '').startsWith(year)) &&
          (!verification || (e.verificationStatus || 'unverified') === verification)
      ),
    [evidence.data, source, programFilter, year, verification]
  );
  const filtered = Boolean(source || programFilter || year || verification);

  const save = async (payload) => {
    const saved = editing?.id
      ? await hub.writes.patchEvidence(editing.id, payload)
      : await hub.writes.createEvidence(payload);
    return Boolean(saved);
  };

  const runImport = async (ids, programIds) => {
    const result = await hub.writes.importEvidence(importing, ids, programIds);
    return Boolean(result);
  };

  const importBusy = importing ? hub.busyIds.has(`import:${importing}`) : false;

  return (
    <div className="space-y-4 pt-4">
      <p className="text-sm text-muted-foreground">
        Everything that can be shown to a program: talks, certifications, articles, episodes, labs.
        Import from the hubs that already hold them, or add by hand; attach items to an application
        from its checklist.
      </p>
      <ReadsStatus reads={reads} label="evidence" />
      {allLanded(reads) && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <SelectField
                id="evidence-filter-source"
                label="Source"
                value={source}
                onChange={setSource}
                options={[
                  { value: '', label: 'All sources' },
                  ...EVIDENCE_SOURCES.map((s) => ({ value: s, label: sourceLabel(s) })),
                ]}
              />
              <SelectField
                id="evidence-filter-program"
                label="Relevant to"
                value={programFilter}
                onChange={setProgramFilter}
                options={[
                  { value: '', label: 'Any program' },
                  ...programs.data.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <SelectField
                id="evidence-filter-year"
                label="Period"
                value={year}
                onChange={setYear}
                options={[
                  { value: '', label: 'Any year' },
                  ...years.map((y) => ({ value: y, label: y })),
                ]}
              />
              <SelectField
                id="evidence-filter-verification"
                label="Verification"
                value={verification}
                onChange={setVerification}
                options={[
                  { value: '', label: 'Any' },
                  { value: 'verified', label: 'Verified' },
                  { value: 'unverified', label: 'Unverified' },
                ]}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {IMPORT_SOURCES.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => setImporting(s)}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Import from {sourceLabel(s)}
                </Button>
              ))}
              <Button size="sm" onClick={() => setEditing({})}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add evidence
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              compact
              variant={filtered ? 'filtered' : 'empty'}
              title={filtered ? 'No evidence matches these filters.' : 'No evidence yet.'}
              description={
                filtered
                  ? 'Clear a filter to see the rest.'
                  : 'Import your talks and certifications, or add an item by hand.'
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {rows.map((item) => {
                const url = safeUrl(item.url);
                const verified = item.verificationStatus === 'verified';
                const busy = hub.busyIds.has(item.id);
                return (
                  <Card key={item.id} data-testid="evidence-card">
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.date || 'undated'} · {sourceLabel(item.sourceModule)}
                            {item.technology?.length ? ` · ${item.technology.join(', ')}` : ''}
                          </p>
                        </div>
                        <StatusBadge size="xs" status={verified ? VERIFIED : UNVERIFIED} />
                      </div>
                      {item.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Counts for{' '}
                        {(item.programIds || []).length === 0
                          ? 'every program'
                          : item.programIds.map((id) => byId.get(id)?.name || id).join(', ')}
                        {item.metrics?.attendees ? ` · ${item.metrics.attendees} attendees` : ''}
                        {item.metrics?.views ? ` · ${item.metrics.views} views` : ''}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => setEditing(item)}
                        >
                          <Pencil className="mr-1 h-3 w-3" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          disabled={busy}
                          title={verified ? 'Mark unverified' : 'Mark verified'}
                          onClick={() =>
                            hub.writes.patchEvidence(item.id, {
                              verificationStatus: verified ? 'unverified' : 'verified',
                            })
                          }
                        >
                          <CheckCircle2 className="mr-1 h-3 w-3" />{' '}
                          {verified ? 'Unverify' : 'Verify'}
                        </Button>
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-7 items-center rounded-md border border-input px-2 text-xs hover:bg-accent"
                          >
                            <ExternalLink className="mr-1 h-3 w-3" /> Open
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-destructive"
                          disabled={busy}
                          onClick={() => setConfirmDelete(item)}
                        >
                          <Trash2 className="h-3 w-3" />
                          <span className="sr-only">Delete {item.title}</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {editing && (
        <EvidenceEditor
          item={editing.id ? editing : null}
          programs={programs.data}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={editing.id ? hub.busyIds.has(editing.id) : hub.busyIds.has('evidence:new')}
        />
      )}
      {importing && (
        <ImportDialog
          sourceModule={importing}
          programs={programs.data}
          onClose={() => setImporting(null)}
          onImport={runImport}
          importing={importBusy}
        />
      )}
      <ConfirmModal
        open={Boolean(confirmDelete)}
        title="Delete this evidence?"
        description={`"${confirmDelete?.title || ''}" is kept with a deletion stamp and leaves every list and checklist. Deleting needs the publisher role.`}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const item = confirmDelete;
          setConfirmDelete(null);
          if (item) await hub.writes.deleteEvidence(item.id);
        }}
      />
    </div>
  );
}
