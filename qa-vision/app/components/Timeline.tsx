'use client';

import React, { useMemo } from 'react';
import { format } from 'date-fns';
import type { Finding, LogEntry } from './types';

interface Props {
  logs: LogEntry[];
  findings: Finding[];
  selectedStep: string | null;
  onSelectStep: (step: string | null) => void;
}

const STEP_RE = /^\[([\w-]+)\]\s*/;

/** One row per step: logs carry "[step-0001] ..." prefixes; the baseline comparison is step "initial". */
export default function Timeline({ logs, findings, selectedStep, onSelectStep }: Props) {
  const rows = useMemo(() => {
    const steps = new Map<string, { id: string; label: string; time: string }>();
    // logs are newest-first; walk oldest-first so the first line of a step names it
    for (const l of [...logs].reverse()) {
      const m = STEP_RE.exec(l.action);
      if (m && !steps.has(m[1])) steps.set(m[1], { id: m[1], label: l.action.replace(STEP_RE, ''), time: l.timestamp });
    }
    for (const f of findings) {
      for (const s of f.stepIds || []) {
        if (!steps.has(s)) steps.set(s, { id: s, label: s === 'initial' ? 'Baseline comparison' : s, time: f.timestamp });
      }
    }
    return [...steps.values()].map((s) => ({ ...s, count: findings.filter((f) => f.stepIds?.includes(s.id)).length }));
  }, [logs, findings]);

  return (
    <div data-testid="timeline" className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="px-4 py-2 text-xs uppercase tracking-widest text-zinc-500 border-b border-zinc-800 flex justify-between">
        <span>Timeline</span>
        {selectedStep && (
          <button type="button" onClick={() => onSelectStep(null)} className="normal-case text-sky-400">
            Clear step filter ({selectedStep})
          </button>
        )}
      </div>
      <ul className="max-h-60 overflow-auto divide-y divide-zinc-800 text-sm">
        {rows.length === 0 && <li className="px-4 py-3 text-zinc-500">No steps yet.</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              data-testid="timeline-step"
              data-step={r.id}
              onClick={() => onSelectStep(selectedStep === r.id ? null : r.id)}
              className={`w-full flex items-center gap-4 px-4 py-2 text-left hover:bg-zinc-800 ${selectedStep === r.id ? 'bg-sky-950/40' : ''}`}
            >
              <span className="font-mono text-xs text-zinc-500 w-20 shrink-0">{format(new Date(r.time), 'HH:mm:ss')}</span>
              <span className="font-mono text-xs text-zinc-400 w-24 shrink-0">{r.id}</span>
              <span className="flex-1 truncate">{r.label}</span>
              <span data-testid="timeline-count" className={`text-xs rounded-full px-2 py-0.5 ${r.count ? 'bg-rose-900 text-rose-300' : 'bg-zinc-800 text-zinc-500'}`}>
                {r.count} finding{r.count === 1 ? '' : 's'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
