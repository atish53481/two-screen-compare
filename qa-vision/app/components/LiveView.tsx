'use client';

import React from 'react';

export interface Frame {
  data: string;
  url: string;
  /** DEV only: the focused element, e.g. input[password] "password" (never its value). */
  focus?: string;
}

/** Input forwarded from the DEV pane to the DEV browser. Coordinates are CSS pixels in the DEV viewport. */
export type LiveInput =
  | { kind: 'move' | 'click' | 'down' | 'up'; x: number; y: number; button?: 'left' | 'right'; count?: 1 | 2 | 3 }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string };

interface Props {
  labelA: string;
  labelB: string;
  frames: { dev?: Frame; prod?: Frame };
  isRunning: boolean;
  isPaused: boolean;
  outOfSync: boolean;
  /** When set, the DEV pane is interactive and forwards input through this callback. */
  onInput?: (input: LiveInput) => void;
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
  frame,
  tone,
  syncText,
  onInput,
}: {
  side: 'dev' | 'prod';
  label: string;
  frame?: Frame;
  tone: string;
  syncText: string;
  onInput?: (input: LiveInput) => void;
}) {
  const imgRef = React.useRef<HTMLImageElement>(null);
  const lastMove = React.useRef(0);
  const inputRef = React.useRef(onInput);
  React.useEffect(() => {
    inputRef.current = onInput;
  }, [onInput]);
  const [focused, setFocused] = React.useState(false);
  const interactive = Boolean(onInput && frame);

  // Map a pointer position on the scaled <img> to the DEV viewport (the frame's natural size).
  const toViewport = (clientX: number, clientY: number, clamp = false) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    // object-contain letterboxes the picture inside the element box: map through the drawn area only
    const r = img.getBoundingClientRect();
    const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const left = r.left + (r.width - img.naturalWidth * scale) / 2;
    const top = r.top + (r.height - img.naturalHeight * scale) / 2;
    let x = (clientX - left) / scale;
    let y = (clientY - top) / scale;
    if (clamp) {
      x = Math.min(Math.max(x, 0), img.naturalWidth - 1);
      y = Math.min(Math.max(y, 0), img.naturalHeight - 1);
    }
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return null;
    return { x: Math.round(x), y: Math.round(y) };
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

  // Wheel needs a non-passive listener so the dashboard itself does not scroll while over the pane
  React.useEffect(() => {
    const img = imgRef.current;
    if (!img || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      const p = toViewport(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      send({ kind: 'wheel', ...p, deltaX: e.deltaX, deltaY: e.deltaY });
    };
    img.addEventListener('wheel', onWheel, { passive: false });
    return () => img.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send/toViewport only read refs
  }, [interactive]);
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

  return (
    <div className="flex flex-col border border-zinc-700 rounded-2xl overflow-hidden bg-zinc-950">
      <div className="bg-zinc-900 px-4 py-2 flex items-center gap-3 border-b border-zinc-800">
        <span className={`font-mono text-xs ${tone}`}>{label}</span>
        <div data-testid={`live-url-${side}`} className="flex-1 truncate rounded bg-zinc-950 px-3 py-1 text-xs font-mono text-zinc-400">
          {frame?.url || '—'}
        </div>
        {side === 'dev' && frame?.focus ? (
          <span data-testid="live-focus" className="max-w-[40%] truncate text-[10px] font-mono text-emerald-300" title={frame.focus}>
            Focus: {frame.focus}
          </span>
        ) : null}
        <span data-testid={`live-sync-${side}`} className="text-[10px] font-mono text-zinc-500">{syncText}</span>
      </div>
      {/* Fixed to the DEV viewport's shape (1280x800 by default) so the pane never shrinks as the page grows */}
      <div className="w-full flex items-center justify-center bg-black" style={{ aspectRatio: '16 / 10' }}>
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            data-testid={`live-frame-${side}`}
            alt={`${label} live frame`}
            src={`data:image/jpeg;base64,${frame.data}`}
            draggable={false}
            className={`w-full h-full object-contain select-none outline-none ${
              interactive ? `cursor-pointer ring-2 ${focused ? 'ring-emerald-400' : 'ring-transparent hover:ring-emerald-800'}` : ''
            }`}
            {...handlers}
          />
        ) : (
          <div className="text-xs text-zinc-500">Waiting for first frame…</div>
        )}
      </div>
    </div>
  );
}

export default function LiveView({ labelA, labelB, frames, isRunning, isPaused, outOfSync, onInput }: Props) {
  const syncText = !isRunning ? 'Idle' : outOfSync ? 'OUT OF SYNC' : isPaused ? 'Paused' : 'Synced';
  return (
    <div className="flex flex-col gap-2 shrink-0">
      <div data-testid="live-hint" className="text-xs text-zinc-400">
        Live view: click, scroll and type in the {labelA} pane (click it first to give it the keyboard). {labelB} mirrors your actions.
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Pane side="dev" label={labelA} frame={frames.dev} tone="text-emerald-400" syncText={syncText} onInput={isRunning ? onInput : undefined} />
        <Pane side="prod" label={labelB} frame={frames.prod} tone="text-rose-400" syncText={syncText} />
      </div>
    </div>
  );
}
