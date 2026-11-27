'use client';

import React from 'react';

export interface Frame {
  data: string;
  url: string;
  /** The focused element, e.g. input[password] "password" (never its value). */
  focus?: string;
  /** Playwright viewport size (CSS px). Mouse coords must be scaled into this space. */
  vw?: number;
  vh?: number;
}

/**
 * Latest frame per side, outside React state: frames arrive several times a second, and only the pane showing a
 * side re-renders on its frame (the dashboard page around the Live view does not).
 */
export interface FrameStore {
  get(side: 'dev' | 'prod'): Frame | undefined;
  set(side: 'dev' | 'prod', frame: Frame): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createFrameStore(): FrameStore {
  let frames: { dev?: Frame; prod?: Frame } = {};
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    get: (side) => frames[side],
    set: (side, frame) => {
      frames = { ...frames, [side]: frame };
      notify();
    },
    clear: () => {
      frames = {};
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Input forwarded from a pane to that side's browser. Coordinates are CSS pixels in the viewport. */
export type LiveInput =
  | { kind: 'move' | 'click' | 'down' | 'up'; x: number; y: number; button?: 'left' | 'right'; count?: 1 | 2 | 3 }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string };

export type LivePhase = 'ready' | 'running' | 'paused';

/** Browser controls in a pane's header. */
export type LiveNavOp = 'goto' | 'back' | 'forward' | 'reload';
export type LiveNavResult = { ok: boolean; message: string; url?: string };

/** Session controls shown above the panes, so the user never has to leave the Live Comparison tab. */
export interface LiveControls {
  phase: LivePhase;
  /** A start/pause/resume request is in flight. */
  busy: boolean;
  stopping: boolean;
  resyncing: boolean;
  restarting: boolean;
  /** Latest session status (e.g. why Start failed), shown next to the buttons. */
  message?: string;
  onLaunch: () => void;
  onStart: () => void;
  /** Running -> paused and paused -> running ("Start again"). */
  onTogglePause: () => void;
  onResync: () => void;
  onStop: () => void;
  onRestart: () => void;
}

interface Props {
  labelA: string;
  labelB: string;
  frames: FrameStore;
  isRunning: boolean;
  isPaused: boolean;
  outOfSync: boolean;
  /**
   * When set, panes are interactive and forward input through this callback. DEV is drivable whenever a session
   * is open; PROD only while it is ready or paused (direct PROD input is not mirrored or compared).
   */
  onInput?: (input: LiveInput, side: 'dev' | 'prod') => void;
  /** Address bar / Back / Forward / Reload. Same availability as onInput per side. */
  onNav?: (side: 'dev' | 'prod', op: LiveNavOp, url?: string) => Promise<LiveNavResult>;
  controls?: LiveControls;
}

const NAV_BTN =
  'flex h-6 w-6 items-center justify-center rounded text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed';

/** Back / Forward / Reload and an editable address bar for one pane. */
function NavBar({
  side,
  url,
  onNav,
  disabledReason,
}: {
  side: 'dev' | 'prod';
  url?: string;
  onNav?: (op: LiveNavOp, url?: string) => Promise<LiveNavResult>;
  disabledReason: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null); // non-null while the user edits the address
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const errTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (errTimer.current) clearTimeout(errTimer.current);
  }, []);
  const enabled = Boolean(onNav) && !pending;
  const run = async (op: LiveNavOp, target?: string) => {
    if (!onNav || pending) return;
    setPending(true);
    setError('');
    try {
      const r = await onNav(op, target);
      if (r.ok) setDraft(null);
      else {
        setError(r.message);
        if (errTimer.current) clearTimeout(errTimer.current);
        errTimer.current = setTimeout(() => setError(''), 6000);
      }
    } finally {
      setPending(false);
    }
  };
  const title = (what: string) => (onNav ? what : disabledReason);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" data-testid={`live-back-${side}`} className={NAV_BTN} disabled={!enabled} title={title('Back')} onClick={() => run('back')}>
          ←
        </button>
        <button type="button" data-testid={`live-forward-${side}`} className={NAV_BTN} disabled={!enabled} title={title('Forward')} onClick={() => run('forward')}>
          →
        </button>
        <button type="button" data-testid={`live-reload-${side}`} className={NAV_BTN} disabled={!enabled} title={title('Reload')} onClick={() => run('reload')}>
          {pending ? '…' : '⟳'}
        </button>
        <input
          data-testid={`live-url-${side}`}
          aria-label={`${side.toUpperCase()} address`}
          spellCheck={false}
          readOnly={!onNav}
          title={onNav ? 'Edit the address and press Enter' : disabledReason}
          value={draft ?? (url || '')}
          placeholder="—"
          onFocus={(e) => {
            if (!onNav) return;
            setDraft(url || '');
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (!pending) setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft && draft.trim()) {
              e.preventDefault();
              void run('goto', draft.trim());
            } else if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          className={`min-w-0 flex-1 truncate rounded bg-zinc-950 px-3 py-1 text-xs font-mono outline-none ${
            draft !== null ? 'text-zinc-100 ring-1 ring-sky-600' : 'text-zinc-400'
          } ${onNav ? '' : 'cursor-default'}`}
        />
      </div>
      {error ? (
        <div data-testid={`live-nav-error-${side}`} className="mt-1 truncate text-[10px] text-rose-300" title={error}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** Keys sent as named key presses; printable characters are sent as text instead. */
const NAMED_KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
]);

function keyFor(e: React.KeyboardEvent): string | null {
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.metaKey && 'Meta'].filter(Boolean) as string[];
  if (NAMED_KEYS.has(e.key)) return [...mods, ...(e.shiftKey ? ['Shift'] : []), e.key].join('+');
  // Shortcuts such as Control+a (select all); plain characters go through as text
  if (mods.length > 0 && e.key.length === 1) return [...mods, e.key].join('+');
  return null;
}

function Pane({
  side,
  label,
  frames,
  tone,
  syncText,
  onInput,
  onNav,
  navDisabledReason,
  followLabel,
}: {
  side: 'dev' | 'prod';
  label: string;
  frames: FrameStore;
  tone: string;
  syncText: string;
  onInput?: (input: LiveInput) => void;
  onNav?: (op: LiveNavOp, url?: string) => Promise<LiveNavResult>;
  navDisabledReason: string;
  /** When this pane is following another side, name of the driver (e.g. DEV label). */
  followLabel?: string;
}) {
  const frame = React.useSyncExternalStore(
    frames.subscribe,
    () => frames.get(side),
    () => undefined
  );
  const imgRef = React.useRef<HTMLImageElement>(null);
  const lastMove = React.useRef(0);
  const inputRef = React.useRef(onInput);
  React.useEffect(() => {
    inputRef.current = onInput;
  }, [onInput]);
  const [focused, setFocused] = React.useState(false);
  const interactive = Boolean(onInput && frame);

  // Map a pointer on the displayed <img> into Playwright viewport CSS pixels.
  // Screencast frames can be smaller than the real viewport: scale natural → vw/vh so clicks hit the right controls.
  const toViewport = (clientX: number, clientY: number, clamp = false) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const vw = frame?.vw && frame.vw > 0 ? frame.vw : nw;
    const vh = frame?.vh && frame.vh > 0 ? frame.vh : nh;
    // object-contain letterboxes the picture inside the element box: map through the drawn area only
    const r = img.getBoundingClientRect();
    const scale = Math.min(r.width / nw, r.height / nh);
    if (!(scale > 0)) return null;
    const left = r.left + (r.width - nw * scale) / 2;
    const top = r.top + (r.height - nh * scale) / 2;
    let ix = (clientX - left) / scale;
    let iy = (clientY - top) / scale;
    if (clamp) {
      ix = Math.min(Math.max(ix, 0), nw - 1);
      iy = Math.min(Math.max(iy, 0), nh - 1);
    }
    if (ix < 0 || iy < 0 || ix > nw || iy > nh) return null;
    const x = Math.round((ix / nw) * vw);
    const y = Math.round((iy / nh) * vh);
    return {
      x: Math.min(Math.max(x, 0), vw - 1),
      y: Math.min(Math.max(y, 0), vh - 1),
    };
  };

  // Typed characters are buffered and sent as one burst after a short pause (or before any other input), so a
  // word replays as one fill step instead of one step per keystroke. Uses refs only, so it is safe in listeners.
  const textBuf = React.useRef('');
  const textTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushText = () => {
    if (textTimer.current) clearTimeout(textTimer.current);
    textTimer.current = null;
    const text = textBuf.current;
    textBuf.current = '';
    if (text) inputRef.current?.({ kind: 'text', text });
  };
  const send = (input: LiveInput) => {
    if (input.kind === 'text') {
      textBuf.current += input.text;
      if (textTimer.current) clearTimeout(textTimer.current);
      textTimer.current = setTimeout(flushText, 250);
      return;
    }
    if (input.kind !== 'move') flushText();
    inputRef.current?.(input);
  };
  React.useEffect(() => () => {
    if (textTimer.current) clearTimeout(textTimer.current);
  }, []);

  // Wheel: coalesce bursts (~30fps) so PROD mirror stays smooth and the socket is not flooded
  const wheelAcc = React.useRef({ x: 0, y: 0, dx: 0, dy: 0 });
  const wheelTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const img = imgRef.current;
    if (!img || !interactive) return;
    const flushWheel = () => {
      wheelTimer.current = null;
      const w = wheelAcc.current;
      if (!w.dx && !w.dy) return;
      const payload = { kind: 'wheel' as const, x: w.x, y: w.y, deltaX: w.dx, deltaY: w.dy };
      w.dx = 0;
      w.dy = 0;
      send(payload);
    };
    const onWheel = (e: WheelEvent) => {
      const p = toViewport(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      wheelAcc.current.x = p.x;
      wheelAcc.current.y = p.y;
      wheelAcc.current.dx += e.deltaX;
      wheelAcc.current.dy += e.deltaY;
      if (!wheelTimer.current) wheelTimer.current = setTimeout(flushWheel, 32);
    };
    img.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      img.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send uses refs
  }, [interactive, frame?.vw, frame?.vh, frame?.data]);
  const handlers = interactive
    ? {
        tabIndex: 0,
        onFocus: () => setFocused(true),
        onBlur: () => {
          flushText();
          setFocused(false);
        },
        onMouseMove: (e: React.MouseEvent) => {
          const now = Date.now();
          // 150 ms is enough for hover menus; while a button is held (drag-select) follow the pointer closely
          if (now - lastMove.current < (e.buttons ? 40 : 150)) return;
          lastMove.current = now;
          const p = toViewport(e.clientX, e.clientY);
          if (p) send({ kind: 'move', ...p });
        },
        // Press and release go separately, so drag-to-select, double-click (word) and triple-click (line) work
        onMouseDown: (e: React.MouseEvent) => {
          if (e.button !== 0 && e.button !== 2) return;
          const p = toViewport(e.clientX, e.clientY);
          if (!p) return;
          e.preventDefault(); // keep the dashboard from selecting the <img>, but still give the pane focus
          (e.currentTarget as HTMLElement).focus();
          const count = Math.min(Math.max(e.detail, 1), 3) as 1 | 2 | 3;
          const button = e.button === 2 ? 'right' : 'left';
          send({ kind: 'down', ...p, button, count });
          // Release is caught on the window: a drag that ends outside the pane must still release DEV's button
          const onUp = (u: MouseEvent) => {
            if (u.button !== e.button) return;
            window.removeEventListener('mouseup', onUp);
            const q = toViewport(u.clientX, u.clientY, true);
            if (q) send({ kind: 'up', ...q, button, count });
          };
          window.addEventListener('mouseup', onUp);
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        onKeyDown: (e: React.KeyboardEvent) => {
          // Ctrl/Cmd+V arrives as a paste event below
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return;
          const key = keyFor(e);
          if (key) {
            e.preventDefault();
            send({ kind: 'key', key });
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            send({ kind: 'text', text: e.key });
          }
        },
        onPaste: (e: React.ClipboardEvent) => {
          const text = e.clipboardData.getData('text/plain');
          if (text) {
            e.preventDefault();
            send({ kind: 'text', text: text.slice(0, 5000) });
          }
        },
      }
    : {};

  const ring = side === 'dev'
    ? (focused ? 'ring-emerald-400' : 'ring-transparent hover:ring-emerald-800')
    : (focused ? 'ring-rose-400' : 'ring-transparent hover:ring-rose-800');

  const modeBadge =
    side === 'dev'
      ? interactive
        ? focused
          ? 'Click · scroll · type here'
          : 'Click pane to control'
        : 'Not interactive'
      : interactive
        ? focused
          ? 'Direct control (not mirrored)'
          : 'Click pane to control'
        : 'Following DEV';

  return (
    <div className="flex flex-col border border-zinc-700 rounded-2xl overflow-hidden bg-zinc-950">
      <div className="bg-zinc-900 px-4 py-2 flex items-center gap-3 border-b border-zinc-800">
        <span className={`font-mono text-xs font-semibold ${tone}`}>{label}</span>
        <span
          data-testid={`live-mode-${side}`}
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            interactive
              ? side === 'dev'
                ? 'bg-emerald-950 text-emerald-300'
                : 'bg-rose-950 text-rose-300'
              : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {modeBadge}
        </span>
        <NavBar side={side} url={frame?.url} onNav={onNav} disabledReason={navDisabledReason} />
        {interactive && frame?.focus ? (
          <span
            data-testid={side === 'dev' ? 'live-focus' : 'live-focus-prod'}
            className={`max-w-[30%] truncate text-[10px] font-mono ${side === 'dev' ? 'text-emerald-300' : 'text-rose-300'}`}
            title={frame.focus}
          >
            Focus: {frame.focus}
          </span>
        ) : null}
        <span data-testid={`live-sync-${side}`} className="text-[10px] font-mono text-zinc-500">{syncText}</span>
      </div>
      {/* Fixed to the DEV viewport's shape (1280x800 by default) so the pane never shrinks as the page grows */}
      <div className="relative w-full flex items-center justify-center bg-black" style={{ aspectRatio: '16 / 10' }}>
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            data-testid={`live-frame-${side}`}
            alt={`${label} live frame`}
            src={`data:image/jpeg;base64,${frame.data}`}
            draggable={false}
            className={`w-full h-full object-contain select-none outline-none ${
              interactive ? `cursor-pointer ring-2 ${ring}` : 'cursor-default opacity-95'
            }`}
            {...handlers}
          />
        ) : (
          <div className="text-xs text-zinc-500">Waiting for first frame…</div>
        )}
        {/* When PROD is only following, show a light banner so users do not try to click it */}
        {!interactive && side === 'prod' && frame ? (
          <div
            data-testid="live-prod-follow-banner"
            className="pointer-events-none absolute inset-x-0 top-0 bg-rose-950/70 px-3 py-1.5 text-center text-[11px] text-rose-100"
          >
            Following {followLabel || 'DEV'} — Pause comparison to control this pane
          </div>
        ) : null}
      </div>
    </div>
  );
}

const BTN = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function ControlBar({ c, isRunning, labelA, labelB }: { c: LiveControls; isRunning: boolean; labelA: string; labelB: string }) {
  const locked = c.busy || c.stopping || c.restarting;
  if (!isRunning) {
    return (
      <div data-testid="live-controls" className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3">
        <button type="button" data-testid="live-launch" onClick={c.onLaunch} disabled={c.stopping || c.restarting}
          className={`${BTN} bg-violet-600 hover:bg-violet-500 text-white px-4 py-2`}>
          {c.restarting ? '↻ Restarting…' : '⏻ 1. Launch both browsers'}
        </button>
        <span className="text-xs text-zinc-400">Opens {labelA} and {labelB} in the panes below (not Chrome tabs).</span>
      </div>
    );
  }
  return (
    <div data-testid="live-controls" data-phase={c.phase} className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {c.phase === 'ready' && (
          <button type="button" data-testid="live-start" onClick={c.onStart} disabled={locked}
            className={`${BTN} bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2`}>
            {c.busy ? 'Starting…' : '▶ 3. Start Comparison'}
          </button>
        )}
        {c.phase === 'running' && (
          <button type="button" data-testid="live-pause" onClick={c.onTogglePause} disabled={locked}
            className={`${BTN} bg-zinc-800 hover:bg-zinc-700 text-white`}>
            {c.busy ? 'Pausing…' : '⏸ Pause'}
          </button>
        )}
        {c.phase === 'paused' && (
          <button type="button" data-testid="live-resume" onClick={c.onTogglePause} disabled={locked}
            className={`${BTN} bg-emerald-600 hover:bg-emerald-500 text-white`}>
            {c.busy ? 'Starting…' : '▶ Resume Comparison'}
          </button>
        )}
        {c.phase === 'running' && (
          <button type="button" data-testid="live-resync" onClick={c.onResync} disabled={locked || c.resyncing}
            className={`${BTN} border border-zinc-700 hover:bg-zinc-800 text-zinc-200`}>
            {c.resyncing ? 'Resyncing…' : '⇄ Resync PROD to DEV'}
          </button>
        )}
        <button type="button" data-testid="live-stop" onClick={c.onStop} disabled={c.stopping || c.restarting}
          className={`${BTN} bg-red-600 hover:bg-red-500 text-white`}>
          {c.stopping && !c.restarting ? 'Stopping…' : '■ Stop'}
        </button>
        <button type="button" data-testid="live-restart" onClick={c.onRestart} disabled={c.stopping || c.restarting}
          title="Stop this session and launch a fresh one with the same profile"
          className={`${BTN} border border-zinc-700 hover:bg-zinc-800 text-zinc-200`}>
          {c.restarting ? 'Restarting…' : '↻ Restart'}
        </button>
        {c.message ? (
          <span
            data-testid="live-status"
            title={c.message}
            className={`ml-2 min-w-0 flex-1 truncate text-xs ${c.message.startsWith('❌') ? 'text-rose-300' : 'text-zinc-400'}`}
          >
            {c.message}
          </span>
        ) : null}
      </div>
      <ol data-testid="live-steps" className="grid grid-cols-1 gap-1 text-[11px] text-zinc-400 sm:grid-cols-3">
        <li className={c.phase ? 'text-emerald-400' : ''}>
          <span className="font-semibold text-zinc-300">1. Launch</span> — browsers open below
        </li>
        <li className={c.phase === 'ready' || c.phase === 'running' || c.phase === 'paused' ? 'text-emerald-400' : ''}>
          <span className="font-semibold text-zinc-300">2. Log in</span> — click each pane and sign in
        </li>
        <li className={c.phase === 'running' ? 'text-emerald-400' : c.phase === 'ready' ? 'text-sky-300' : ''}>
          <span className="font-semibold text-zinc-300">3. Compare</span> — work only in {labelA}; {labelB} follows
        </li>
      </ol>
    </div>
  );
}

export default function LiveView({ labelA, labelB, frames, isRunning, isPaused, outOfSync, onInput, onNav, controls }: Props) {
  const syncText = !isRunning ? 'Idle' : outOfSync ? 'OUT OF SYNC' : isPaused ? 'Paused' : 'Synced';
  const phase = controls?.phase ?? (isPaused ? 'paused' : 'running');
  // PROD is drivable only while nothing is replicated into it (ready / paused) and no start is aligning it
  const prodDrivable = isRunning && phase !== 'running' && !controls?.busy;
  const devInput = React.useCallback((i: LiveInput) => onInput?.(i, 'dev'), [onInput]);
  const prodInput = React.useCallback((i: LiveInput) => onInput?.(i, 'prod'), [onInput]);
  const devNav = React.useCallback((op: LiveNavOp, url?: string) => onNav!('dev', op, url), [onNav]);
  const prodNav = React.useCallback((op: LiveNavOp, url?: string) => onNav!('prod', op, url), [onNav]);
  const hint = !isRunning
    ? `Live view: launch a session, then click, scroll and type in the ${labelA} pane.`
    : phase === 'running'
      ? `Comparing: click, scroll and type in the ${labelA} pane (click it first for the keyboard). ${labelB} mirrors your actions. Pause to control ${labelB} directly.`
      : phase === 'ready'
        ? `Log in on ${labelA} and ${labelB} (click each pane to focus it, then click, scroll and type). When both show the same page, press “3. Start Comparison”.`
        : `Paused: click, scroll and type in either pane. Resume re-aligns ${labelB} to ${labelA}. Pause to control ${labelB} was used to get here.`;
  return (
    <div className="flex flex-col gap-3 shrink-0">
      {controls && <ControlBar c={controls} isRunning={isRunning} labelA={labelA} labelB={labelB} />}
      <div
        data-testid="live-hint"
        className={`rounded-lg px-3 py-2 text-xs ${
          phase === 'running'
            ? 'border border-emerald-800/60 bg-emerald-950/40 text-emerald-100'
            : phase === 'ready'
              ? 'border border-sky-800/60 bg-sky-950/40 text-sky-100'
              : 'border border-zinc-800 bg-zinc-900 text-zinc-300'
        }`}
      >
        {hint}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Pane
          side="dev"
          label={labelA}
          frames={frames}
          tone="text-emerald-400"
          syncText={syncText}
          onInput={isRunning && onInput ? devInput : undefined}
          onNav={isRunning && onNav && !controls?.busy ? devNav : undefined}
          navDisabledReason={isRunning ? 'Wait for the current action to finish' : 'Launch a session first'}
        />
        <Pane
          side="prod"
          label={labelB}
          frames={frames}
          tone="text-rose-400"
          syncText={syncText}
          followLabel={labelA}
          onInput={prodDrivable && onInput ? prodInput : undefined}
          onNav={prodDrivable && onNav ? prodNav : undefined}
          navDisabledReason={
            isRunning
              ? phase === 'running'
                ? `Pause to control ${labelB} directly`
                : `Wait for Start to finish`
              : 'Launch a session first'
          }
        />
      </div>
    </div>
  );
}
