'use client';

import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { downloadReport, EXPORT_FORMATS, type ExportFormat, type Finding } from './types';

export interface RunSummary {
  id: string;
  projectName: string;
  devUrl: string;
  prodUrl: string;
  startedAt: string;
  endedAt: string | null;
  counts: { total: number; expected: number };
}

interface Props {
  /** Bumped by the parent to force a reload (e.g. after a session stops). */
  refreshKey: number;
  /** Opens a stored run read-only in the dashboard. */
  onOpen: (run: { id: string; projectName: string; mismatches: Finding[]; logs: any[] }) => void;
}

export default function HistoryTab({ refreshKey, onOpen }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/runs');
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load runs');
        if (!cancelled) {
          setRuns(data.runs);
          setError('');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load runs');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const open = async (id: string) => {
    const res = await fetch(`/api/runs?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (data.success) onOpen({ id, projectName: data.run.projectName, mismatches: data.run.mismatches, logs: data.run.logs || [] });
    else setError(data.error || 'Could not open run');
  };

  const exportRun = async (id: string, fmt: ExportFormat) => {
    setNote('');
    try {
      setNote(`Exported ${await downloadReport(fmt, { runId: id })}`);
    } catch (e: any) {
      setNote(`Export failed: ${e?.message}`);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-5xl mx-auto">
        <h3 className="text-xl font-semibold mb-2">Run history</h3>
        <p className="text-sm text-zinc-400 mb-6">Stored runs open read-only. Marking a finding expected here updates the stored run and the profile&apos;s expectations.</p>
        {error && <div className="mb-4 text-sm text-rose-400">{error}</div>}
        {note && <div data-testid="history-note" className="mb-4 text-sm text-zinc-300">{note}</div>}
        <div className="space-y-3">
          {runs.length === 0 && <div className="text-sm text-zinc-500">No stored runs yet.</div>}
          {runs.map((r) => (
            <div key={r.id} data-testid="history-run" data-run-id={r.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-48">
                <div className="font-medium">{r.projectName}</div>
                <div className="text-xs text-zinc-500 font-mono">{format(new Date(r.startedAt), 'yyyy-MM-dd HH:mm:ss')} · {r.counts.total} findings · {r.counts.expected} expected</div>
              </div>
              <button type="button" data-testid="history-open" onClick={() => open(r.id)} className="px-3 py-2 rounded-xl text-sm bg-sky-600 hover:bg-sky-500">Open</button>
              <div className="flex gap-1">
                {EXPORT_FORMATS.map((f) => (
                  <button key={f} type="button" data-testid={`history-export-${f}`} onClick={() => exportRun(r.id, f)} className="px-2 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 uppercase">{f}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
