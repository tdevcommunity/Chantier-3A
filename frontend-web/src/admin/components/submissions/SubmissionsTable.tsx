import React from 'react';
import { Calendar } from 'lucide-react';
import { adminTheme } from '../../lib/admin-theme';
import { cn } from '../../lib/utils';
import {
  SUBMISSION_COLUMN_KEYS,
  submissionColumnLabel,
  type SubmissionTableRow,
} from '../../lib/registration-submissions';

interface SubmissionsTableProps {
  rows: SubmissionTableRow[];
  onRowClick: (orderId: string) => void;
}

function CellValue({ value }: { value: string }) {
  const text = value.trim();
  if (!text) {
    return <span className="text-zinc-300">—</span>;
  }
  return <span className="line-clamp-3" title={text.length > 80 ? text : undefined}>{text}</span>;
}

export const SubmissionsTable: React.FC<SubmissionsTableProps> = ({ rows, onRowClick }) => {
  return (
    <div className={cn(adminTheme.card, 'overflow-hidden p-0')}>
      <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-17rem)]">
        <table className="w-max min-w-full border-collapse text-left text-xs text-zinc-700">
          <thead className="sticky top-0 z-20 bg-zinc-50/95 backdrop-blur-sm border-b border-zinc-200">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-30 min-w-[148px] max-w-[148px] px-4 py-3 font-semibold text-zinc-500 border-r border-zinc-200 bg-zinc-50/95"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  Soumis le
                </span>
              </th>
              {SUBMISSION_COLUMN_KEYS.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className="min-w-[160px] max-w-[240px] px-4 py-3 font-semibold text-zinc-600 whitespace-normal"
                >
                  {submissionColumnLabel(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.id)}
                className="group cursor-pointer hover:bg-emerald-50/40 transition-colors"
              >
                <td className="sticky left-0 z-10 px-4 py-3 font-medium text-zinc-800 border-r border-zinc-100 bg-white group-hover:bg-emerald-50/40 whitespace-nowrap">
                  {row.submittedAtLabel}
                </td>
                {SUBMISSION_COLUMN_KEYS.map((key) => (
                  <td key={key} className="px-4 py-3 align-top text-zinc-700 max-w-[240px]">
                    <CellValue value={row.cells[key] ?? ''} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
