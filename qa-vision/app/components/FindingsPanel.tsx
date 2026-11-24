'use client';

import React, { useMemo, useState } from 'react';
import { isExpected, SEVERITY_STYLE, type Finding } from './types';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  stepFilter: string | null;
  onSelect: (f: Finding) => void;
}

type GroupBy = 'none' | 'page' | 'type' | 'element';
const CLASSIFICATIONS = [
  'POTENTIAL_DEFECT',
  'EXPECTED_DIFFERENCE',
  'REPLAY_FAILURE',
  'NOT_COMPARABLE',
  'SKIPPED_BY_SAFETY_POLICY',
  'UNMAPPED_OR_MISSING_FEATURE',
  'MATCH',
];

const selectCls = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs';

export default function FindingsPanel({ findings, selectedId, stepFilter, onSelect }: Props) {
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [classification, setClassification] = useState('');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [showExpected, setShowExpected] = useState(true);

  const types = useMemo(() => [...new Set(findings.map((f) => f.type))].sort(), [findings]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (type && f.type !== type) return false;
      if (severity && f.severity !== severity) return false;
      if (classification && f.classification !== classification) return false;
      if (!showExpected && isExpected(f)) return false;
      if (stepFilter && !f.stepIds?.includes(stepFilter)) return false;
      if (q && !`${f.page} ${f.component} ${f.type} ${f.property || ''} ${f.devValue} ${f.prodValue} ${f.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [findings, type, severity, classification, search, showExpected, stepFilter]);

  const groups = useMemo(() => {
    const key = (f: Finding) => (groupBy === 'page' ? f.page : groupBy === 'type' ? f.type : groupBy === 'element' ? f.component : '');
    const m = new Map<string, Finding[]>();
    for (const f of visible) m.set(key(f), [...(m.get(key(f)) || []), f]);
    return [...m.entries()];
  }, [visible, groupBy]);

  return (
    <div data-testid="findings-panel" className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-800 text-xs">
        <select aria-label="Filter by type" data-testid="filter-type" className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Filter by severity" data-testid="filter-severity" className={selectCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Filter by classification" data-testid="filter-classification" className={selectCls} value={classification} onChange={(e) => setClassification(e.target.value)}>
          <option value="">All classifications</option>
          {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input aria-label="Search findings" data-testid="filter-search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${selectCls} w-40`} />
        <select aria-label="Group by" data-testid="group-by" className={selectCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="none">No grouping</option>
          <option value="page">Group by page</option>
          <option value="type">Group by type</option>
          <option value="element">Group by element</option>
        </select>
        <label className="flex items-center gap-1 text-zinc-300">
          <input type="checkbox" data-testid="toggle-expected" checked={showExpected} onChange={(e) => setShowExpected(e.target.checked)} />
          Show expected
        </label>
        <span data-testid="findings-count" className="ml-auto text-zinc-500 font-mono">{visible.length} / {findings.length}</span>
      </div>
      <div className="max-h-96 overflow-auto">
        {visible.length === 0 && <div className="px-6 py-6 text-sm text-zinc-500">No findings match.</div>}
        {groups.map(([name, list]) => (
          <div key={name || 'all'}>
            {groupBy !== 'none' && <div data-testid="group-header" className="px-4 py-1 bg-zinc-950 text-xs text-zinc-400 font-mono">{name || '(none)'} · {list.length}</div>}
            <ul className="divide-y divide-zinc-800">
              {list.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    data-testid="finding-row"
                    data-finding-id={f.id}
                    data-expected={isExpected(f) ? 'true' : 'false'}
                    onClick={() => onSelect(f)}
                    className={`w-full grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-center px-4 py-3 text-left text-sm hover:bg-zinc-800 ${selectedId === f.id ? 'bg-sky-950/40' : ''} ${isExpected(f) ? 'opacity-50' : ''}`}
                  >
                    <span className="truncate"><span className="font-mono text-xs text-zinc-500">{f.page}</span> {f.component}</span>
                    <span className="truncate font-mono text-xs"><span className="text-emerald-400">{f.devValue}</span> <span className="text-zinc-600">vs</span> <span className="text-rose-400">{f.prodValue}</span></span>
                    <span className="text-xs rounded-full bg-zinc-800 text-zinc-300 px-2 py-0.5">{f.type}</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.low}`}>{f.severity}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
