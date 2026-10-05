/**
 * Evidence (ADR 0033 §4): the library every application draws on. A guide
 * above the list says what each enabled program still needs, requirement by
 * requirement, with Add opening the editor on the source that would count.
 * Filters by source module, program relevance, period and verification, and
 * Group by (None / Source / Program / Year / Verification) with collapsible
 * groups whose state the browser remembers (evidenceView.js); add by hand;
 * import from Speaking, Certifications and Published content with a picker
 * that marks what is already in, or from an exported CSV; edit, verify and
 * delete each item (EvidenceCard.jsx).
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { ChevronDown, ChevronRight, Download, FileUp, Plus } from 'lucide-react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import {
  CSV_IMPORTS,
  EVIDENCE_SOURCES,
  IMPORT_SOURCES,
  programById,
  sourceLabel,
} from './ambassadorModel';
import CsvImportDialog from './CsvImportDialog';
import EvidenceCard from './EvidenceCard';
import EvidenceEditor from './EvidenceEditor';
import ImportDialog from './ImportDialog';
import { ReadsStatus, SelectField, allLanded } from './Parts';
import useReadiness from './useReadiness';
import {
  EMPTY_EVIDENCE_FILTERS,
  GROUP_BY_OPTIONS,
  anyFilterSet,
  filterEvidence,
  groupEvidence,
  groupStateKey,
  guideRows,
  readCollapsedGroups,
  writeCollapsedGroups,
  yearsOf,
} from './evidenceView';

const option = (value, label) => ({ value, label });

/** The four filters: source module, program relevance, period and verification; then Group by. */
function EvidenceFilters({ filters, setFilter, programs, years, groupBy, setGroupBy }) {
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
      <SelectField
        id="evidence-group-by"
        label="Group by"
        value={groupBy}
        onChange={setGroupBy}
        options={GROUP_BY_OPTIONS.map(([value, label]) => option(value, label))}
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

/** The groups of one grouping, each a header with its count that opens and closes. */
function EvidenceGroups({ groups, groupBy, collapsed, onToggle, gridProps }) {
  if (groups.length === 0) return <EvidenceGrid rows={[]} {...gridProps} />;
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const key = groupStateKey(groupBy, group.key);
        const open = !collapsed[key];
        const bodyId = `evidence-group-${groupBy}-${group.key}`;
        return (
          <section
            key={group.key}
            aria-labelledby={`${bodyId}-heading`}
            data-testid="evidence-group"
          >
            <h3 id={`${bodyId}-heading`} className="text-sm font-semibold">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-accent"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => onToggle(key)}
              >
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                {group.label}
                <span className="text-xs font-normal text-muted-foreground">
                  · {group.items.length} item{group.items.length === 1 ? '' : 's'}
                </span>
              </button>
            </h3>
            {open && (
              <div id={bodyId} className="mt-2">
                <EvidenceGrid rows={group.items} {...gridProps} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The words after a program's name in the guide: where its readiness stands. */
function guideState(readiness, rows) {
  if (!readiness.loaded) return readiness.error ? '' : 'computing…';
  if (rows.length === 0) return 'no requirements set';
  const open = rows.filter((row) => !row.met).length;
  return open === 0 ? 'every requirement met' : `${open} open`;
}

/** One program in the guide: its requirements with have / need, the hint for each short one, and Add. */
function GuideProgram({ program, refreshKey, onAdd }) {
  const readiness = useReadiness(program.id, '', { refreshKey });
  const rows = guideRows(program, readiness.data);
  const state = guideState(readiness, rows);
  return (
    <li className="space-y-1" data-testid="guide-program">
      <p className="text-sm font-medium">
        {program.name}
        {state && <span className="text-xs font-normal text-muted-foreground"> · {state}</span>}
      </p>
      {readiness.error && <p className="text-xs text-destructive">{readiness.error}</p>}
      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge
                size="xs"
                status={{
                  id: row.met ? 'met' : 'open',
                  label: `${row.have} / ${row.need}${row.unit === 'credits' ? ' credits' : ''}`,
                  tone: row.met ? 'ok' : 'warn',
                  help: row.met ? 'Met' : row.hint,
                }}
              />
              <span>{row.label}</span>
              {row.hint && <span className="text-muted-foreground">— {row.hint}</span>}
              {!row.met && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  aria-label={`Add evidence for ${program.name}: ${row.label}`}
                  onClick={() => onAdd(row.addSource, program.id)}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** "What each program still needs": one entry per enabled program, from the readiness arithmetic. */
function NeedsGuide({ programs, refreshKey, onAdd }) {
  const [open, setOpen] = useState(true);
  const enabled = programs.filter((p) => p.enabled !== false);
  return (
    <section
      aria-labelledby="evidence-guide-heading"
      className="rounded-md border border-border p-3"
      data-testid="evidence-guide"
    >
      <h3 id="evidence-guide-heading" className="text-sm font-semibold">
        <button
          type="button"
          className="flex items-center gap-1.5"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          What each program still needs
        </button>
      </h3>
      {open &&
        (enabled.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No enabled program; enable one on Settings.
          </p>
        ) : (
          <ul className="mt-2 grid gap-3 md:grid-cols-2">
            {enabled.map((program) => (
              <GuideProgram
                key={program.id}
                program={program}
                refreshKey={refreshKey}
                onAdd={onAdd}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

export default function EvidenceTab({ hub }) {
  const { programs, evidence } = hub;
  const { toast } = useToast();
  const reads = [programs, evidence];
  const [filters, setFilters] = useState(EMPTY_EVIDENCE_FILTERS);
  const [groupBy, setGroupBy] = useState('');
  const [collapsed, setCollapsed] = useState(() => readCollapsedGroups());
  const [editing, setEditing] = useState(null); // null | { prefill? } (new) | item
  const [importing, setImporting] = useState(null); // source module
  const [importingCsv, setImportingCsv] = useState(null); // a CSV_IMPORTS entry
  const [confirmDelete, setConfirmDelete] = useState(null);
  const byId = useMemo(() => programById(programs.data), [programs.data]);
  const years = useMemo(() => yearsOf(evidence.data), [evidence.data]);
  const rows = useMemo(() => filterEvidence(evidence.data, filters), [evidence.data, filters]);
  const groups = useMemo(() => groupEvidence(rows, groupBy, { byId }), [rows, groupBy, byId]);
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));

  const toggleGroup = (key) =>
    setCollapsed((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = true;
      writeCollapsedGroups(next);
      return next;
    });

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

  const runCsvImport = async (text, programIds) => {
    const result = await hub.writes.importEvidenceCsv(importingCsv.reader, text, programIds);
    if (result) {
      const parts = [
        `${result.created?.length || 0} added`,
        `${result.existing?.length || 0} already in`,
      ];
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      toast({ title: 'Import finished', description: parts.join(' · ') });
    }
    return Boolean(result);
  };

  const importBusy = importing ? hub.busyIds.has(`import:${importing}`) : false;
  const csvBusy = importingCsv ? hub.busyIds.has(`import:${importingCsv.reader}`) : false;
  const gridProps = {
    filtered: anyFilterSet(filters),
    byId,
    hub,
    onEdit: setEditing,
    onDelete: setConfirmDelete,
  };

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
          <NeedsGuide
            programs={programs.data}
            refreshKey={evidence.loadedAt}
            onAdd={(sourceModule, programId) =>
              setEditing({ prefill: { sourceModule, programIds: [programId] } })
            }
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <EvidenceFilters
              filters={filters}
              setFilter={setFilter}
              programs={programs.data}
              years={years}
              groupBy={groupBy}
              setGroupBy={setGroupBy}
            />
            <div className="flex flex-wrap gap-2">
              {IMPORT_SOURCES.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => setImporting(s)}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Import from {sourceLabel(s)}
                </Button>
              ))}
              {CSV_IMPORTS.map((source) => (
                <Button
                  key={source.reader}
                  size="sm"
                  variant="outline"
                  onClick={() => setImportingCsv(source)}
                >
                  <FileUp className="mr-1 h-3.5 w-3.5" /> Import {source.label}
                </Button>
              ))}
              <Button size="sm" onClick={() => setEditing({})}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add evidence
              </Button>
            </div>
          </div>

          {groupBy ? (
            <EvidenceGroups
              groups={groups}
              groupBy={groupBy}
              collapsed={collapsed}
              onToggle={toggleGroup}
              gridProps={gridProps}
            />
          ) : (
            <EvidenceGrid rows={rows} {...gridProps} />
          )}
        </>
      )}

      {editing && (
        <EvidenceEditor
          item={editing.id ? editing : null}
          prefill={editing.id ? null : editing.prefill}
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
      {importingCsv && (
        <CsvImportDialog
          source={importingCsv}
          programs={programs.data}
          onClose={() => setImportingCsv(null)}
          onImport={runCsvImport}
          importing={csvBusy}
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
