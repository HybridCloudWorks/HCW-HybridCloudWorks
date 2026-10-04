/**
 * The hub's tables (ADR 0033 §4): one wrapper and one head, so Applications
 * and Settings read the same and a column is one string here. An empty
 * column label renders the bare cell above the row actions.
 */
import React from 'react';

const HEAD_CELL = 'px-4 py-2.5 text-left font-medium text-muted-foreground';

export default function DataTable({ columns, children }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((column, index) =>
              column ? (
                <th key={column} className={HEAD_CELL}>
                  {column}
                </th>
              ) : (
                <th key={`actions-${index}`} className="px-4 py-2.5" />
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
