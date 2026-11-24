'use client';

import React from 'react';

export interface Frame {
  data: string;
  url: string;
}

interface Props {
  labelA: string;
  labelB: string;
  frames: { dev?: Frame; prod?: Frame };
  isRunning: boolean;
  isPaused: boolean;
  outOfSync: boolean;
}

function Pane({ side, label, frame, tone, syncText }: { side: 'dev' | 'prod'; label: string; frame?: Frame; tone: string; syncText: string }) {
  return (
    <div className="flex flex-col border border-zinc-700 rounded-2xl overflow-hidden bg-zinc-950 min-h-0">
      <div className="bg-zinc-900 px-4 py-2 flex items-center gap-3 border-b border-zinc-800">
        <span className={`font-mono text-xs ${tone}`}>{label}</span>
        <div data-testid={`live-url-${side}`} className="flex-1 truncate rounded bg-zinc-950 px-3 py-1 text-xs font-mono text-zinc-400">
          {frame?.url || '—'}
        </div>
        <span data-testid={`live-sync-${side}`} className="text-[10px] font-mono text-zinc-500">{syncText}</span>
      </div>
      <div className="flex-1 flex items-center justify-center min-h-[180px] bg-black">
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img data-testid={`live-frame-${side}`} alt={`${label} live frame`} src={`data:image/jpeg;base64,${frame.data}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-xs text-zinc-500">Waiting for first frame…</div>
        )}
      </div>
    </div>
  );
}

export default function LiveView({ labelA, labelB, frames, isRunning, isPaused, outOfSync }: Props) {
  const syncText = !isRunning ? 'Idle' : outOfSync ? 'OUT OF SYNC' : isPaused ? 'Paused' : 'Synced';
  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="text-xs text-zinc-400">Live view: interact in the QA Vision DEV window</div>
      <div className="grid grid-cols-2 gap-4 min-h-0">
        <Pane side="dev" label={labelA} frame={frames.dev} tone="text-emerald-400" syncText={syncText} />
        <Pane side="prod" label={labelB} frame={frames.prod} tone="text-rose-400" syncText={syncText} />
      </div>
    </div>
  );
}
