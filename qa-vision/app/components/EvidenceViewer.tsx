'use client';

import React, { useState } from 'react';
import { evidenceUrl, isExpected, jsonHeaders, SEVERITY_STYLE, type Finding } from './types';

export interface EvidenceTarget {
  /** Evidence folder id: the session id (a stored run shares its session's id). */
  evidenceId: string;
  /** Live sessions can highlight in the browsers and are addressed by sessionId; stored runs by runId. */
  live: boolean;
}

interface Props {
  finding: Finding;
  target: EvidenceTarget;
  onUpdate: (f: Finding) => void;
  onClose: () => void;
}

const Facts = ({ title, items, tone }: { title: string; items?: string[]; tone: string }) =>
  items && items.length ? (
    <div className="mt-3">
      <div className={`text-xs uppercase tracking-widest ${tone}`}>{title}</div>
      <ul className="list-disc pl-5 text-sm text-zinc-300 space-y-1 mt-1">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  ) : null;

export default function EvidenceViewer({ finding, target, onUpdate, onClose }: Props) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const ref = target.live ? { sessionId: target.evidenceId } : { runId: target.evidenceId };

  const call = async (action: string, label: string) => {
    setBusy(action);
    setMessage('');
    try {
      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ action, findingId: finding.id, note: note || undefined, ...ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (action === 'highlight') {
        setMessage(data.dev || data.prod ? `Highlighted (DEV: ${data.dev ? 'yes' : 'no'}, PROD: ${data.prod ? 'yes' : 'no'})` : data.reason || 'Element not found in either browser');
      } else if (res.ok && data.finding) {
        onUpdate({ ...finding, ...data.finding });
        setMessage(`${label} done`);
      } else {
        setMessage(data.error || `${label} failed`);
      }
    } catch (e: any) {
      setMessage(e?.message || `${label} failed`);
    } finally {
      setBusy('');
    }
  };

  const images: Array<[string, string | undefined]> = [
    ['DEV', finding.devScreenshotPath],
    ['PROD', finding.prodScreenshotPath],
    ['Diff', finding.diffScreenshotPath],
  ];
  const expected = isExpected(finding);
  const btn = 'px-3 py-2 rounded-xl text-sm font-medium disabled:opacity-50';

  return (
    <aside data-testid="evidence-viewer" className="w-[28rem] shrink-0 border-l border-zinc-700 bg-zinc-900 p-6 overflow-auto">
      <button type="button" aria-label="Close evidence" onClick={onClose} className="float-right text-zinc-400 hover:text-white">✕</button>
      <div className="text-xs uppercase tracking-widest text-rose-400 mb-1">{finding.type} · {finding.classification || 'unclassified'}</div>
      <h3 className="text-xl font-semibold leading-tight mb-1">{finding.component}</h3>
      <div className="flex gap-2 items-center mb-4">
        <span className={`text-xs rounded-full px-2 py-0.5 ${SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.low}`}>{finding.severity}</span>
        <span className="text-xs font-mono text-zinc-500">{finding.page}</span>
      </div>
      <p className="text-sm text-zinc-300 mb-4">{finding.description}</p>

      <div className="grid grid-cols-2 gap-3 text-xs font-mono mb-4">
        <div className="rounded-xl bg-zinc-950 p-3 border border-emerald-900/50"><div className="text-zinc-500">DEV value</div><div data-testid="evidence-dev-value" className="text-emerald-400 break-words">{finding.devValue}</div></div>
        <div className="rounded-xl bg-zinc-950 p-3 border border-rose-900/50"><div className="text-zinc-500">PROD value</div><div data-testid="evidence-prod-value" className="text-rose-400 break-words">{finding.prodValue}</div></div>
      </div>

      <dl className="text-xs text-zinc-400 space-y-1 mb-4">
        {finding.property && <div><dt className="inline text-zinc-500">Property: </dt><dd className="inline font-mono">{finding.property}</dd></div>}
        {finding.devSelector && <div><dt className="inline text-zinc-500">DEV selector: </dt><dd className="inline font-mono break-all">{finding.devSelector}</dd></div>}
        {finding.prodSelector && <div><dt className="inline text-zinc-500">PROD selector: </dt><dd className="inline font-mono break-all">{finding.prodSelector}</dd></div>}
        <div><dt className="inline text-zinc-500">Steps: </dt><dd data-testid="evidence-steps" className="inline font-mono">{finding.stepIds?.length ? finding.stepIds.join(', ') : '—'}</dd></div>
        <div><dt className="inline text-zinc-500">Rule applied: </dt><dd data-testid="evidence-rule" className="inline font-mono">{finding.ruleApplied || '—'}</dd></div>
      </dl>

      <div className="space-y-3 mb-4">
        {images.map(([label, file]) =>
          file ? (
            <figure key={label}>
              <figcaption className="text-xs text-zinc-500 mb-1">{label}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-testid="evidence-img" alt={`${label} screenshot`} src={evidenceUrl(target.evidenceId, file)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950" />
            </figure>
          ) : null
        )}
        {images.every(([, f]) => !f) && <div className="text-xs text-zinc-500">No screenshots recorded for this finding.</div>}
      </div>

      <div data-testid="evidence-ai" className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 mb-4">
        <div className="text-xs uppercase tracking-widest text-zinc-500">AI analysis (advisory)</div>
        {!finding.ai && <div className="text-sm text-zinc-500 mt-1">Not analyzed yet.</div>}
        {finding.ai && finding.ai.status !== 'ok' && <div className="text-sm text-amber-400 mt-1">AI {finding.ai.status}{finding.ai.error ? `: ${finding.ai.error}` : ''}</div>}
        {finding.ai?.status === 'ok' && (
          <>
            {finding.ai.explanation && <p className="text-sm text-zinc-300 mt-2">{finding.ai.explanation}</p>}
            <Facts title="Observed facts" items={finding.ai.observedFacts} tone="text-emerald-400" />
            <Facts title="Hypotheses (unverified)" items={finding.ai.hypotheses} tone="text-amber-400" />
            <Facts title="Suggested investigation" items={finding.ai.suggestedInvestigation} tone="text-sky-400" />
            {finding.ai.proposedClassification && <div className="mt-3 text-xs text-zinc-500">Proposed: {finding.ai.proposedClassification} (does not change the classification)</div>}
          </>
        )}
      </div>

      <input aria-label="Expected note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full mb-3 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm" />
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="btn-mark-expected" disabled={!!busy} onClick={() => call(expected ? 'unmark-expected' : 'mark-expected', expected ? 'Unmark' : 'Mark expected')} className={`${btn} bg-white text-black`}>
          {expected ? 'Unmark' : 'Mark expected'}
        </button>
        <button type="button" data-testid="btn-highlight" disabled={!!busy || !target.live} title={target.live ? '' : 'Only available while the session is live'} onClick={() => call('highlight', 'Highlight')} className={`${btn} bg-zinc-800 hover:bg-zinc-700`}>
          Highlight in browsers
        </button>
        <button type="button" data-testid="btn-analyze" disabled={!!busy} onClick={() => call('analyze', 'Analysis')} className={`${btn} bg-violet-600 hover:bg-violet-500`}>
          {busy === 'analyze' ? 'Analyzing…' : 'Analyze with AI'}
        </button>
      </div>
      {message && <div data-testid="evidence-message" className="mt-3 text-xs text-zinc-400">{message}</div>}
    </aside>
  );
}
