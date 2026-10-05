/**
 * Import evidence from a file the owner exports (ADR 0033 §4): the Metrics
 * That Matter classes-delivered CSV, for now. The file is chosen or its text
 * pasted, the programs it counts for ticked, and the API's CSV reader turns
 * each row into one evidence row, once per class id, so the same export can
 * be imported again after the next class without duplicates.
 */
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Upload } from 'lucide-react';
import { ProgramsFieldset, TextAreaField } from './Parts';

const MAX_TEXT = 150_000;

/** Lines under the header that hold something, as a rough row count before the import. */
const rowCount = (text) =>
  String(text || '')
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim()).length;

export default function CsvImportDialog({ source, programs, onClose, onImport, importing }) {
  const fileRef = useRef(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [programIds, setProgramIds] = useState([]);
  const [readError, setReadError] = useState('');
  const rows = rowCount(text);

  const readFile = async (file) => {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content.slice(0, MAX_TEXT));
      setFileName(file.name);
      setReadError('');
    } catch (err) {
      setReadError(`Could not read the file: ${err?.message}`);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !importing) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {source.label}</DialogTitle>
          <DialogDescription>{source.hint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label="Choose the CSV file"
              onChange={(e) => {
                readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              <Upload className="mr-1 h-3.5 w-3.5" /> Choose file
            </Button>
            <span className="text-xs text-muted-foreground">
              {fileName ? `${fileName} · ` : ''}
              {rows} row{rows === 1 ? '' : 's'} under the header
            </span>
          </div>
          {readError && <p className="text-sm text-destructive">{readError}</p>}
          <TextAreaField
            id="csv-import-text"
            label="Or paste the CSV"
            rows={8}
            value={text}
            onChange={(v) => setText(v.slice(0, MAX_TEXT))}
            placeholder="MTM Class ID,Course,Learning Method,Instructor,Start Date,End Date,Location"
            hint="The first line is the header; column names are matched however the export spells them."
          />
          <ProgramsFieldset programs={programs} value={programIds} onChange={setProgramIds} />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={rows === 0 || importing}
            onClick={async () => {
              if (await onImport(text, programIds)) onClose();
            }}
          >
            {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {rows || ''} {rows === 1 ? 'row' : 'rows'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
