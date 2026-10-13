import React, { useState } from 'react';
import { adminTheme } from '../../lib/admin-theme';
import { cn } from '../../lib/utils';
import type { InsightTextEntry } from '../../lib/registration-insights-aggregate';

const PAGE_SIZE = 20;

interface InsightTextListProps {
  title: string;
  entries: InsightTextEntry[];
}

export const InsightTextList: React.FC<InsightTextListProps> = ({ title, entries }) => {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const slice = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className={cn(adminTheme.card, 'flex h-full flex-col p-5')}>
      <div className="mb-4">
        <h3 className={adminTheme.cardTitle}>{title}</h3>
        <p className={adminTheme.cardSubtitle}>{entries.length} réponse(s) texte libre</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-zinc-500 py-6 text-center">Aucune réponse.</p>
      ) : (
        <>
          <ul className="space-y-2 flex-1 overflow-y-auto max-h-[320px] pr-1 text-sm">
            {slice.map((entry, i) => (
              <li
                key={`${entry.participantId}-${i}`}
                className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2 text-zinc-800 leading-relaxed"
              >
                {entry.text}
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-zinc-200 px-2 py-1 disabled:opacity-40"
              >
                Précédent
              </button>
              <span>
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-zinc-200 px-2 py-1 disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};
