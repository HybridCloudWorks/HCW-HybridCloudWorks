/**
 * Evidence (ADR 0033 §4): the library every application draws on. Filters
 * by source module, program relevance, period and verification
 * (evidenceView.js); add by hand; import from Speaking, Certifications and
 * Published content with a picker that marks what is already in; edit,
 * verify and delete each item (EvidenceCard.jsx).
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Plus } from 'lucide-react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import EmptyState from '@/components/admin/shared/EmptyState';
import { EVIDENCE_SOURCES, IMPORT_SOURCES, programById, sourceLabel } from './ambassadorModel';
import EvidenceCard from './EvidenceCard';
import EvidenceEditor from './EvidenceEditor';
import ImportDialog from './ImportDialog';
import { ReadsStatus, SelectField, allLanded } from './Parts';
import { EMPTY_EVIDENCE_FILTERS, anyFilterSet, filterEvidence, yearsOf } from './evidenceView';

const option = (value, label) => ({ value, label });

/** The four filters: source module, program relevance, period and verification. */
function EvidenceFilters({ filters, setFilter, programs, years }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField
        id="evidence-filter-source"
        label="Source"
        value={filters.source}
        onChange={setFilter('source')}
        options={[
          option('', 'All sources'),
          ...EVIDENCE_SOURCES.map((s) => option(s, sourceLabel(s))),
        ]}
      />
      <SelectField
        id="evidence-filter-program"
        label="Relevant to"
        value={filters.program}
        onChange={setFilter('program')}
        options={[option('', 'Any program'), ...programs.map((p) => option(p.id, p.name))]}
      />
      <SelectField
        id="evidence-filter-year"
        label="Period"
        value={filters.year}
        onChange={setFilter('year')}
        options={[option('', 'Any year'), ...years.map((y) => option(y, y))]}
      />
      <SelectField
        id="evidence-filter-verification"
        label="Verification"
        value={filters.verification}
        onChange={setFilter('verification')}
        options={[
          option('', 'Any'),
          option('verified', 'Verified'),
          option('unverified', 'Unverified'),
        ]}
      />
    </div>
  );
}

/** The matching items as cards, or the honest empty state. */
function EvidenceGrid({ rows, filtered, byId, hub, onEdit, onDelete }) {
  if (rows.length === 0) {
    return (
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
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((item) => (
        <EvidenceCard
          key={item.id}
          item={item}
          byId={byId}
          busy={hub.busyIds.has(item.id)}
          onEdit={() => onEdit(item)}
          onVerify={(verificationStatus) =>
            hub.writes.patchEvidence(item.id, { verificationStatus })
          }
          onDelete={() => onDelete(item)}
        />
      ))}
    </div>
  );
}

export default function EvidenceTab({ hub }) {
  const { programs, evidence } = hub;
  const reads = [programs, evidence];
  const [filters, setFilters] = useState(EMPTY_EVIDENCE_FILTERS);
  const [editing, setEditing] = useState(null); // null | {} (new) | item
  const [importing, setImporting] = useState(null); // source module
  const [confirmDelete, setConfirmDelete] = useState(null);
  const byId = useMemo(() => programById(programs.data), [programs.data]);
  const years = useMemo(() => yearsOf(evidence.data), [evidence.data]);
  const rows = useMemo(() => filterEvidence(evidence.data, filters), [evidence.data, filters]);
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));

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
            <EvidenceFilters
              filters={filters}
              setFilter={setFilter}
              programs={programs.data}
              years={years}
            />
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

          <EvidenceGrid
            rows={rows}
            filtered={anyFilterSet(filters)}
            byId={byId}
            hub={hub}
            onEdit={setEditing}
            onDelete={setConfirmDelete}
          />
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
