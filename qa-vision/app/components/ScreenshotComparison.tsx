'use client';

/**
 * Two Screen Comparison tab: compare a DEV screenshot with a PROD reference screenshot.
 * Independent of the live comparison (no browser, no URLs, no Playwright). Server work: /api/screenshot-compare.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Eye, EyeOff, FileJson, FileText, ImageIcon, Lock, Maximize2,
  MousePointerSquareDashed, Printer, RefreshCw, RotateCcw, ShieldAlert, Trash2, Upload, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type {
  ScreenshotComparisonResult, ScreenshotFinding, ShotAlignment, ShotBBox, ShotCategory, ShotFindingStatus, ShotIgnoreRegion,
  ShotReviewStatus, ShotScope, ShotSensitivity, ShotSeverity,
} from './types';
// dependency-free constants (no sharp/pngjs): safe in the client bundle
import { DEFAULT_SHOT_SCOPE, DEFAULT_TEXT_OPTIONS, SHOT_SCOPES, SHOT_SCOPE_INFO } from '@/lib/engine/screenshot-types';

type Side = 'dev' | 'prod';
type ViewMode = 'side' | 'overlay' | 'slider' | 'diff';

interface ImageState {
  id: string;
  file: File;
  url: string; // object URL of the original (display)
  width: number;
  height: number;
  name: string;
  size: number;
}

interface AiInfo {
  configured: boolean;
  visionCapable: boolean;
  provider: string | null;
  model: string | null;
  note: string;
}
interface OcrInfo {
  available: boolean;
  engine: string | null;
  note: string;
}

const STATUS: Record<ShotFindingStatus, { label: string; cls: string }> = {
  mismatch: { label: 'Mismatch', cls: 'bg-rose-900/70 text-rose-100' },
  'missing-in-dev': { label: 'Missing in DEV', cls: 'bg-rose-900/70 text-rose-100' },
  'extra-in-dev': { label: 'Extra in DEV', cls: 'bg-orange-900/70 text-orange-100' },
  uncertain: { label: 'Uncertain — needs review', cls: 'bg-zinc-700 text-zinc-100' },
  matched: { label: 'Matched', cls: 'bg-emerald-900/70 text-emerald-100' },
  ignored: { label: 'Ignored', cls: 'bg-zinc-800 text-zinc-300' },
};

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

/** Category styling: color + glyph + dash pattern, so categories never depend on color alone. */
const CAT: Record<ShotCategory, { label: string; glyph: string; color: string; dash: string }> = {
  text: { label: 'Text/label', glyph: 'T', color: '#f59e0b', dash: '' },
  data: { label: 'Data value', glyph: '#', color: '#ec4899', dash: '' },
  typography: { label: 'Typography', glyph: 'Aa', color: '#a855f7', dash: '6 3' },
  color: { label: 'Color', glyph: '◐', color: '#06b6d4', dash: '2 2' },
  layout: { label: 'Layout', glyph: '⇄', color: '#3b82f6', dash: '8 4' },
  visual: { label: 'Visual asset', glyph: '◆', color: '#ef4444', dash: '' },
  state: { label: 'State', glyph: '⏻', color: '#22c55e', dash: '4 2 1 2' },
  match: { label: 'Match / ignored', glyph: '⊘', color: '#64748b', dash: '3 3' },
};
const REVIEW: Record<ShotReviewStatus, string> = {
  'needs-review': 'Needs review',
  expected: 'Expected',
  'false-positive': 'False positive',
  'confirmed-defect': 'Confirmed defect',
};
const SEV_CLS: Record<ShotSeverity, string> = {
  high: 'bg-rose-900/70 text-rose-200',
  medium: 'bg-amber-900/70 text-amber-200',
  low: 'bg-sky-900/70 text-sky-200',
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function downloadBlob(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = src;
  });
}

/** Re-encode through a canvas: drops EXIF/GPS and other metadata before an image goes into an export. */
async function cleanDataUrl(src: string): Promise<string> {
  const img = await loadImg(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Canvas-space box of a finding (canvas = DEV pixel grid, PROD-only boxes mapped back). */
function canvasBox(f: ScreenshotFinding, r: ScreenshotComparisonResult): ShotBBox | null {
  if (f.devBbox) return f.devBbox;
  if (!f.prodBbox) return null;
  const { prodScaleX: sx, prodScaleY: sy } = r.alignment;
  return { ...f.prodBbox, x: f.prodBbox.x / sx, y: f.prodBbox.y / sy, width: f.prodBbox.width / sx, height: f.prodBbox.height / sy, sourceWidth: r.canvas.width, sourceHeight: r.canvas.height };
}

// ------------------------------------------------------------------ annotation overlay

function Annotations({
  findings, side, width, height, selectedId, onSelect, scale, result,
}: {
  findings: ScreenshotFinding[];
  side: Side | 'canvas';
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  scale: number; // displayed px per source px
  result: ScreenshotComparisonResult;
}) {
  const fs = 13 / Math.max(scale, 0.0001);
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ pointerEvents: 'none' }}>
      {findings.map((f) => {
        const b = side === 'dev' ? f.devBbox : side === 'prod' ? f.prodBbox : canvasBox(f, result);
        if (!b) return null;
        const m = CAT[f.category];
        const sel = f.id === selectedId;
        const label = f.number > 0 ? `${f.number} ${m.glyph}` : m.glyph;
        const tagW = (label.length * 0.62 + 0.8) * fs;
        const ty = b.y - fs * 1.35 < 0 ? b.y + b.height : b.y - fs * 1.35;
        return (
          <g key={f.id} style={{ pointerEvents: 'all', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelect(f.id); }} data-testid={`anno-${side}-${f.number}`}>
            {sel && <rect x={b.x - 3 / scale} y={b.y - 3 / scale} width={b.width + 6 / scale} height={b.height + 6 / scale} fill="none" stroke="#facc15" strokeWidth={5} vectorEffect="non-scaling-stroke" className="animate-pulse" />}
            <rect x={b.x} y={b.y} width={b.width} height={b.height} fill={sel ? `${m.color}33` : `${m.color}14`} stroke={m.color} strokeWidth={sel ? 3 : 2} strokeDasharray={m.dash} vectorEffect="non-scaling-stroke" />
            <rect x={b.x} y={ty} width={tagW} height={fs * 1.35} fill={m.color} rx={fs * 0.2} />
            <text x={b.x + fs * 0.4} y={ty + fs * 1.02} fontSize={fs} fontWeight={700} fill="#0a0a0a" fontFamily="system-ui, sans-serif">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ zoom / pan pane

/** zoom 1 = image fits the pane width. (cx, cy) = image fraction at the pane center; cy 0 at zoom 1 = top anchored. */
interface ViewState { zoom: number; cx: number; cy: number }
const FIT: ViewState = { zoom: 1, cx: 0.5, cy: 0 };

function ZoomPane({
  srcW, srcH, view, setView, children, label, testId,
}: {
  srcW: number;
  srcH: number;
  view: ViewState;
  setView: (v: ViewState) => void;
  children: (scale: number) => React.ReactNode;
  label: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(600);
  const ch = 520;
  const drag = useRef<{ x: number; y: number; v: ViewState; moved: boolean } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 600));
    ro.observe(el);
    setCw(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);
  const dispW = cw * view.zoom;
  const dispH = dispW * (srcH / srcW);
  const scale = dispW / srcW;
  const anchored = view.zoom === 1 && view.cy === 0;
  const tx = anchored ? 0 : Math.min(0, Math.max(cw - dispW, cw / 2 - view.cx * dispW));
  const ty = anchored || dispH <= ch ? 0 : Math.min(0, Math.max(ch - dispH, ch / 2 - view.cy * dispH));
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const fx = (e.clientX - rect.left - tx) / dispW;
    const fy = (e.clientY - rect.top - ty) / dispH;
    const zoom = Math.min(12, Math.max(1, view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    setView({ zoom, cx: fx, cy: Math.max(0.0001, fy) });
  };
  return (
    <div className="relative" data-testid={testId}>
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold">{label}</div>
      <div
        ref={ref}
        className="relative cursor-grab select-none overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 active:cursor-grabbing"
        style={{ height: ch, touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
          const base = d.v.zoom === 1 && d.v.cy === 0 ? { ...d.v, cx: cw / 2 / dispW, cy: Math.min(1, ch / 2 / dispH) } : d.v;
          setView({ zoom: base.zoom, cx: Math.min(1, Math.max(0, base.cx - dx / dispW)), cy: Math.min(1, Math.max(0.0001, base.cy - dy / dispH)) });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <div className="absolute left-0 top-0" style={{ width: dispW, height: dispH, transform: `translate(${tx}px, ${ty}px)` }}>
          {children(scale)}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ main component

const ScreenshotComparison: React.FC = () => {
  const [images, setImages] = useState<Record<Side, ImageState | null>>({ dev: null, prod: null });
  const [activePanel, setActivePanel] = useState<Side>('dev');
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [pageName, setPageName] = useState('');
  const [devLabel, setDevLabel] = useState('DEV');
  const [prodLabel, setProdLabel] = useState('PROD');
  const [expectedNotes, setExpectedNotes] = useState('');
  const [sensitivity, setSensitivity] = useState<ShotSensitivity>('normal');
  const [alignment, setAlignment] = useState<ShotAlignment>('none');
  const [ignoreRegions, setIgnoreRegions] = useState<ShotIgnoreRegion[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [aiInfo, setAiInfo] = useState<AiInfo | null>(null);
  const [ocrInfo, setOcrInfo] = useState<OcrInfo | null>(null);
  const [aiConsent, setAiConsent] = useState(false);
  // "What do you want to compare?" — Data & Text only by default
  const [scope, setScope] = useState<Set<ShotScope>>(() => new Set(DEFAULT_SHOT_SCOPE));
  const [matching, setMatching] = useState<'normalized' | 'strict'>(DEFAULT_TEXT_OPTIONS.matching);
  const [caseSensitive, setCaseSensitive] = useState(DEFAULT_TEXT_OPTIONS.caseSensitive);
  const [numericTolerance, setNumericTolerance] = useState(DEFAULT_TEXT_OPTIONS.numericTolerance);
  const [ocrMinConf, setOcrMinConf] = useState(DEFAULT_TEXT_OPTIONS.minConfidence);
  const [ignoreFieldsText, setIgnoreFieldsText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'confirmed' | 'uncertain'>('');
  const [isComparing, setIsComparing] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ScreenshotComparisonResult | null>(null);
  const [reviews, setReviews] = useState<Record<string, ShotReviewStatus>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side');
  const [view, setView] = useState<ViewState>(FIT);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [sliderPos, setSliderPos] = useState(50);
  const [catFilter, setCatFilter] = useState<Set<ShotCategory>>(new Set());
  const [sevFilter, setSevFilter] = useState<'' | ShotSeverity>('');
  const [reviewFilter, setReviewFilter] = useState<'' | ShotReviewStatus>('');
  const [minConfidence, setMinConfidence] = useState(0);
  const [preview, setPreview] = useState<Side | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [error, setError] = useState('');

  const devInput = useRef<HTMLInputElement>(null);
  const prodInput = useRef<HTMLInputElement>(null);
  const inputRefs = { dev: devInput, prod: prodInput };
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const devPreviewImg = useRef<HTMLImageElement>(null);
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);

  useEffect(() => {
    fetch('/api/screenshot-compare')
      .then((r) => r.json())
      .then((j) => { setAiInfo(j?.ai || null); setOcrInfo(j?.ocr || null); })
      .catch(() => { setAiInfo(null); setOcrInfo(null); });
    return () => {
      for (const s of ['dev', 'prod'] as Side[]) if (imagesRef.current[s]) URL.revokeObjectURL(imagesRef.current[s]!.url);
    };
  }, []);

  const dev = images.dev, prod = images.prod;
  const sizeMismatch = !!dev && !!prod && (dev.width !== prod.width || dev.height !== prod.height);
  const scopeList = SHOT_SCOPES.filter((s) => scope.has(s));
  // Data & Text alone is matched by content (OCR), so different sizes need no pixel alignment
  const needsAlignment = sizeMismatch && (scopeList.some((s) => s !== 'data_text') || !ocrInfo?.available);
  const toggleScope = (s: ShotScope) => {
    setScope((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
    setResult(null); // a result never describes a different scope than the one selected
  };
  const labelOf = (s: Side) => (s === 'dev' ? devLabel || 'DEV' : prodLabel || 'PROD');

  // ---------------------------------------------------------------- input

  const loadImage = useCallback(async (file: File, side: Side) => {
    setError('');
    if (file.type && !ACCEPT.includes(file.type)) {
      setError(`Invalid image for ${side.toUpperCase()}: "${file.name || 'pasted item'}" is ${file.type}. Use PNG, JPG or WebP.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`${side.toUpperCase()} image is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB. Crop it or save as JPG/WebP.`);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) {
        URL.revokeObjectURL(url);
        setError(`${side.toUpperCase()} image is ${img.naturalWidth}×${img.naturalHeight} — over the 16.7 MP limit. Crop it to the area you need.`);
        return;
      }
      setImages((prev) => {
        if (prev[side]) URL.revokeObjectURL(prev[side]!.url);
        return {
          ...prev,
          [side]: {
            id: `${side}-${Date.now().toString(36)}`,
            file,
            url,
            width: img.naturalWidth,
            height: img.naturalHeight,
            name: file.name || `pasted-${side}.png`,
            size: file.size,
          },
        };
      });
      setResult(null); // a result never describes a different pair than the one on screen
      setSelectedId(null);
      setAlignment('none');
    } catch {
      URL.revokeObjectURL(url);
      setError(`Invalid image for ${side.toUpperCase()}: the file could not be decoded. Re-capture it or save it again as PNG.`);
    }
  }, []);

  const removeImage = (side: Side) => {
    setImages((prev) => {
      if (prev[side]) URL.revokeObjectURL(prev[side]!.url);
      return { ...prev, [side]: null };
    });
    setResult(null);
    setSelectedId(null);
    if (side === 'dev') { setIgnoreRegions([]); setDrawMode(false); }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            void loadImage(blob, activePanel);
            return;
          }
        }
      }
      // no image in the clipboard: let text paste into inputs proceed normally
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [activePanel, loadImage]);

  // ---------------------------------------------------------------- ignore-region drawing (DEV preview)

  const toSource = (e: React.PointerEvent) => {
    const img = devPreviewImg.current!;
    const r = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(img.naturalWidth, ((e.clientX - r.left) / r.width) * img.naturalWidth)),
      y: Math.max(0, Math.min(img.naturalHeight, ((e.clientY - r.top) / r.height) * img.naturalHeight)),
    };
  };
  const finishDraft = () => {
    if (!draft) return;
    const x = Math.round(Math.min(draft.x0, draft.x1)), y = Math.round(Math.min(draft.y0, draft.y1));
    const w = Math.round(Math.abs(draft.x1 - draft.x0)), h = Math.round(Math.abs(draft.y1 - draft.y0));
    setDraft(null);
    if (w >= 3 && h >= 3) {
      setIgnoreRegions((prev) => [...prev, { label: `Ignore ${prev.length + 1}`, x, y, width: w, height: h }]);
      setResult(null);
    }
  };

  // ---------------------------------------------------------------- compare

  const canCompare = !!dev && !!prod && !isComparing && scopeList.length > 0 && (!needsAlignment || alignment !== 'none');

  const compare = () => {
    if (!dev || !prod) {
      setError('Both DEV and PROD screenshots are required.');
      return;
    }
    if (!scopeList.length) {
      setError('Select at least one comparison category under “What do you want to compare?”.');
      return;
    }
    if (needsAlignment && alignment === 'none') {
      setError('Different dimensions — choose an alignment before comparing.');
      return;
    }
    setIsComparing(true);
    setDrawMode(false);
    setError('');
    setResult(null);
    setSelectedId(null);
    setProgress('Uploading screenshots… 0%');
    const fd = new FormData();
    fd.append('devImage', dev.file, dev.name);
    fd.append('prodImage', prod.file, prod.name);
    fd.append('options', JSON.stringify({
      scope: scopeList,
      text: {
        matching, caseSensitive, numericTolerance, minConfidence: ocrMinConf,
        ignoreFields: ignoreFieldsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      },
      sensitivity, alignment: needsAlignment ? alignment : sizeMismatch ? 'none' : alignment, ignoreRegions, pageName, devLabel, prodLabel, expectedNotes,
      devId: dev.id, prodId: prod.id, aiConsent: aiConsent && !!aiInfo?.configured,
    }));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/screenshot-compare');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        const work = scope.has('data_text') && ocrInfo?.available ? 'Reading visible text (local OCR) and comparing data' : 'Comparing pixels and grouping regions';
        setProgress(pct < 100 ? `Uploading screenshots… ${pct}%` : aiConsent ? `${work}, then asking the AI model…` : `${work}…`);
      }
    };
    xhr.onload = () => {
      setIsComparing(false);
      let data: { success?: boolean; error?: string; result?: ScreenshotComparisonResult } | null = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (!data) {
        setError(`Comparison failed: server returned HTTP ${xhr.status} without a JSON body.`);
        setProgress('');
        return;
      }
      if (xhr.status >= 400 || !data.success || !data.result) {
        setError(data.error || `Comparison failed (HTTP ${xhr.status}).`);
        setProgress('');
        return;
      }
      const r = data.result;
      setResult(r);
      setReviews(Object.fromEntries(r.findings.map((f) => [f.id, f.reviewStatus])));
      setView(FIT);
      setViewMode('side');
      setProgress(
        r.status === 'alignment-required' ? 'Alignment required'
          : r.status === 'no-differences' ? 'No material differences within tolerance'
          : `Comparison complete — ${r.summary.confirmedMismatches} mismatch(es), ${r.summary.uncertainItems} uncertain${r.pixelAnalysis ? `, ${r.summary.diffPercent}% of pixels changed` : ''}`
      );
    };
    xhr.onerror = () => {
      setIsComparing(false);
      setProgress('');
      setError('Could not reach the QA Vision server. Is it still running?');
    };
    xhr.send(fd);
  };

  const reset = () => {
    for (const s of ['dev', 'prod'] as Side[]) if (images[s]) URL.revokeObjectURL(images[s]!.url);
    setImages({ dev: null, prod: null });
    setResult(null);
    setReviews({});
    setSelectedId(null);
    setIgnoreRegions([]);
    setDrawMode(false);
    setAlignment('none');
    setPageName('');
    setExpectedNotes('');
    setAiConsent(false);
    setScope(new Set(DEFAULT_SHOT_SCOPE)); // a fresh comparison starts with Data & Text only
    setError('');
    setProgress('');
    setView(FIT);
    setActivePanel('dev');
  };

  // ---------------------------------------------------------------- findings

  const findings = useMemo(() => (result ? result.findings.map((f) => ({ ...f, reviewStatus: reviews[f.id] || f.reviewStatus })) : []), [result, reviews]);
  const realFindings = findings.filter((f) => f.number > 0 || (f.category !== 'match' && !f.ignoredByRule));
  const ignoredFindings = findings.filter((f) => f.ignoredByRule);
  const filtered = realFindings.filter(
    (f) =>
      (!catFilter.size || catFilter.has(f.category)) &&
      (!sevFilter || f.severitySuggestion === sevFilter) &&
      (!reviewFilter || f.reviewStatus === reviewFilter) &&
      (!statusFilter || (statusFilter === 'uncertain') === (f.status === 'uncertain')) &&
      f.confidence * 100 >= minConfidence
  );
  const annotated = showAnnotations ? filtered.filter((f) => f.number > 0) : [];
  const selected = findings.find((f) => f.id === selectedId) || null;
  const reviewCounts = realFindings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.reviewStatus]: (acc[f.reviewStatus] || 0) + 1 }), {});

  const focusFinding = (id: string, fromImage = false) => {
    setSelectedId(id);
    const f = findings.find((x) => x.id === id);
    if (!f || !result) return;
    if (fromImage) {
      listRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const b = canvasBox(f, result);
    if (!b) return;
    const cw = result.canvas.width || dev?.width || 1, chh = result.canvas.height || dev?.height || 1;
    const zoom = Math.min(8, Math.max(1.5, Math.min(cw / (b.width * 2.5), chh / (b.height * 2.5))));
    setView({ zoom, cx: (b.x + b.width / 2) / cw, cy: Math.max(0.0001, (b.y + b.height / 2) / chh) });
  };

  const setReview = (id: string, s: ShotReviewStatus) => setReviews((prev) => ({ ...prev, [id]: s }));

  // ---------------------------------------------------------------- exports

  const reportPayload = async () => {
    if (!result || !dev || !prod) return null;
    const [devUrl, prodUrl] = await Promise.all([cleanDataUrl(dev.url), cleanDataUrl(prod.url)]);
    return {
      ...result,
      findings,
      review: {
        reviewed: realFindings.filter((f) => f.reviewStatus !== 'needs-review').length,
        confirmedDefects: reviewCounts['confirmed-defect'] || 0,
        expected: reviewCounts.expected || 0,
        falsePositives: reviewCounts['false-positive'] || 0,
        needsReview: reviewCounts['needs-review'] || 0,
      },
      // the specification's report schema (snake_case), one entry per reported finding
      spec_findings: realFindings.filter((f) => f.number > 0).map((f) => ({
        id: f.code,
        category: f.scope,
        finding_category: f.category,
        severity: f.severitySuggestion,
        confidence: +f.confidence.toFixed(2),
        page_section: f.pageSection ?? null,
        field: f.field ?? null,
        prod_value: f.prodValue ?? null,
        dev_value: f.devValue ?? null,
        expected_baseline: f.expectedBaseline ?? 'PROD screenshot',
        title: f.title,
        description: f.evidence,
        dev_observation: f.devObservation,
        prod_observation: f.prodObservation,
        dev_bbox: f.devBbox ? [f.devBbox.x, f.devBbox.y, f.devBbox.x + f.devBbox.width, f.devBbox.y + f.devBbox.height] : null,
        prod_bbox: f.prodBbox ? [f.prodBbox.x, f.prodBbox.y, f.prodBbox.x + f.prodBbox.width, f.prodBbox.y + f.prodBbox.height] : null,
        bbox_format: '[x1, y1, x2, y2] in each original image\'s pixels, top-left origin',
        status: f.status,
        review_status: f.reviewStatus,
        review_note: f.reviewNote ?? null,
        ignored_by_rule: f.ignoredByRule,
        image_ids: f.imageIds,
      })),
      originals: {
        note: "Original screenshots, re-encoded as PNG with metadata removed. Bounding boxes use each image's own pixel coordinates (top-left origin).",
        dev: { name: dev.name, width: dev.width, height: dev.height, dataUrl: devUrl },
        prod: { name: prod.name, width: prod.width, height: prod.height, dataUrl: prodUrl },
      },
    };
  };

  const fileBase = () => `qa-vision-two-screen-${(result?.pageName || 'comparison').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

  const exportJson = async () => {
    const p = await reportPayload();
    if (p) downloadBlob(JSON.stringify(p, null, 2), 'application/json', `${fileBase()}.json`);
  };

  const buildHtml = async (): Promise<string | null> => {
    const p = await reportPayload();
    if (!p || !result || !dev || !prod) return null;
    const svgFor = (side: Side, w: number, h: number) =>
      `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${p.findings
        .filter((f) => f.number > 0 && (side === 'dev' ? f.devBbox : f.prodBbox))
        .map((f) => {
          const b = (side === 'dev' ? f.devBbox : f.prodBbox)!;
          const m = CAT[f.category];
          const fs = Math.max(12, w / 70);
          const ty = Math.max(0, b.y - fs * 1.35);
          return `<g><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${m.color}22" stroke="${m.color}" stroke-width="${Math.max(2, w / 500)}" stroke-dasharray="${m.dash}"/><rect x="${b.x}" y="${ty}" width="${fs * (String(f.number).length * 0.62 + 1.9)}" height="${fs * 1.35}" fill="${m.color}"/><text x="${b.x + fs * 0.35}" y="${ty + fs * 1.02}" font-size="${fs}" font-weight="700" font-family="system-ui">${f.number} ${esc(m.glyph)}</text></g>`;
        })
        .join('')}</svg>`;
    const bb = (b: ShotBBox | null) => (b ? `${b.x},${b.y} ${b.width}×${b.height} <span class="m">of ${b.sourceWidth}×${b.sourceHeight}</span>` : '—');
    const rows = p.findings
      .map((f) => {
        const m = CAT[f.category];
        return `<tr><td><span class="tag" style="background:${m.color}">${f.number || ''} ${esc(m.glyph)}</span><div class="m">${esc(f.code)}</div></td><td><b>${esc(f.title)}</b><div class="m">${esc(f.scope ? SHOT_SCOPE_INFO[f.scope].label : '—')} · ${esc(m.label)} · ${esc(STATUS[f.status].label)}${f.field ? ` · field “${esc(f.field)}”` : ''}${f.ignoredByRule ? ` · ignored by rule “${esc(f.ignoredByRule)}”` : ''}</div>${f.reviewNote ? `<div class="m">${esc(f.reviewNote)}</div>` : ''}</td><td>${f.devValue !== undefined ? `<b>${esc(f.devValue ?? '— (not found)')}</b>` : esc(f.devObservation)}</td><td>${f.prodValue !== undefined ? `<b>${esc(f.prodValue ?? '— (not found)')}</b>` : esc(f.prodObservation)}</td><td>${bb(f.devBbox)}</td><td>${bb(f.prodBbox)}</td><td>${esc(f.evidence)}${f.ai ? `<div class="ai">AI (advisory): ${esc(f.ai.explanation)}${f.ai.devText || f.ai.prodText ? `<br>DEV text: “${esc(f.ai.devText || '')}” · PROD text: “${esc(f.ai.prodText || '')}”` : ''}</div>` : ''}</td><td>${Math.round(f.confidence * 100)}%</td><td>${esc(f.severitySuggestion)}</td><td>${esc(REVIEW[f.reviewStatus])}</td></tr>`;
      })
      .join('');
    const cats = Object.entries(result.summary.mismatchesByCategory).map(([k, v]) => `${esc(CAT[k as ShotCategory]?.label || k)}: ${v}`).join(' · ') || 'none';
    const data = JSON.stringify({ ...p, originals: { note: p.originals.note } }).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Two Screen Comparison — ${esc(result.pageName || 'report')}</title>
<style>
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;margin:24px;color:#111;background:#fff}
h1{margin:0 0 4px}h2{margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.m{color:#666;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.shot{position:relative;border:1px solid #ccc}.shot img{display:block;width:100%;height:auto}.shot svg{position:absolute;inset:0;width:100%;height:100%}
.cap{font-weight:600;margin:4px 0}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}th{background:#f4f4f5}
.tag{display:inline-block;padding:1px 6px;border-radius:4px;font-weight:700;color:#000;white-space:nowrap}
.warn{background:#fff7ed;border:1px solid #fdba74;padding:8px 12px;border-radius:6px;margin:6px 0}.ai{margin-top:4px;color:#6b21a8}
.kv td:first-child{font-weight:600;width:220px}
</style></head><body>
<h1>Two Screen Comparison Report</h1>
<div class="m">QA Vision · session ${esc(result.sessionId)} · ${esc(new Date(result.timestamp).toLocaleString())}</div>
<h2>Summary</h2>
<table class="kv">
<tr><td>Page</td><td>${esc(result.pageName || '—')}</td></tr>
<tr><td>Result</td><td>${result.status === 'no-differences' ? 'No material differences within tolerance in the selected checks' : `${result.summary.confirmedMismatches} mismatch(es), ${result.summary.uncertainItems} uncertain item(s) needing review`}</td></tr>
<tr><td>Data &amp; Text</td><td>${result.ocr.used ? `${result.summary.matchedItems} visible text item(s) matched · ${result.ocr.devTextItems} DEV / ${result.ocr.prodTextItems} PROD items read` : 'Not read'} — ${esc(result.ocr.note)}</td></tr>
<tr><td>Changed pixels</td><td>${result.pixelAnalysis ? `${result.summary.diffPercent}% (similarity ${result.summary.similarityPercent}%), ${result.summary.identicalZones}/${result.summary.totalZones} screen zones identical` : 'Pixel diff skipped (different sizes, only Data &amp; Text selected)'}</td></tr>
<tr><td>By category</td><td>${cats}</td></tr>
<tr><td>Review</td><td>${p.review.reviewed} reviewed · ${p.review.confirmedDefects} confirmed defect(s) · ${p.review.expected} expected · ${p.review.falsePositives} false positive(s) · ${p.review.needsReview} need review</td></tr>
<tr><td>${esc(result.devLabel)} image</td><td>${esc(dev.name)} — ${result.devDimensions.width}×${result.devDimensions.height}</td></tr>
<tr><td>${esc(result.prodLabel)} image</td><td>${esc(prod.name)} — ${result.prodDimensions.width}×${result.prodDimensions.height}</td></tr>
<tr><td>Alignment</td><td>${esc(result.alignment.description)}</td></tr>
<tr><td>Tolerance</td><td>Sensitivity ${esc(result.settings.sensitivity)} · pixel threshold ${result.settings.pixelThreshold} · minimum region ${result.settings.minRegionPixels}px · anti-aliasing excluded</td></tr>
<tr><td>AI</td><td>${esc(result.ai.note)}${result.ai.model ? ` (model: ${esc(result.ai.model)})` : ''}</td></tr>
${result.expectedNotes ? `<tr><td>Expected differences (notes)</td><td>${esc(result.expectedNotes).replace(/\n/g, '<br>')}</td></tr>` : ''}
</table>
${result.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}
<h2>Selected checks</h2>
<div class="m">Only selected checks were run. “Not checked” means not run — it is not a pass.</div>
<table><tr><th>Priority</th><th>Check</th><th>Status</th><th>Mismatches</th><th>Uncertain</th></tr>${SHOT_SCOPES.map((s) => {
      const b = result.summary.byScope[s];
      return `<tr><td>${SHOT_SCOPE_INFO[s].priority}</td><td>${esc(SHOT_SCOPE_INFO[s].label)}</td><td>${b.checked ? (b.findings ? 'Differences found' : 'No differences found') : '<b>Not checked</b>'}</td><td>${b.checked ? b.mismatches : '—'}</td><td>${b.checked ? b.uncertain : '—'}</td></tr>`;
    }).join('')}</table>
<h2>Annotated screenshots</h2>
<div class="m">Numbered boxes match the findings table. Boxes use each original image's pixel coordinates.</div>
<div class="grid">
<div><div class="cap">${esc(result.devLabel)} (New Changes)</div><div class="shot"><img alt="DEV screenshot" src="${p.originals.dev.dataUrl}">${svgFor('dev', dev.width, dev.height)}</div></div>
<div><div class="cap">${esc(result.prodLabel)} (Reference)</div><div class="shot"><img alt="PROD screenshot" src="${p.originals.prod.dataUrl}">${svgFor('prod', prod.width, prod.height)}</div></div>
</div>
${result.evidence.diffPngBase64 ? `<h2>Difference map</h2><div class="m">Red: changed pixels · blue: changes inside ignore regions · dimmed: unchanged</div><div class="shot" style="max-width:900px"><img alt="Diff map" src="data:image/png;base64,${result.evidence.diffPngBase64}"></div>` : ''}
<h2>Findings</h2>
<table><thead><tr><th>#</th><th>Finding</th><th>${esc(result.devLabel)} (value / observation)</th><th>${esc(result.prodLabel)} (baseline)</th><th>DEV bbox</th><th>PROD bbox</th><th>Evidence</th><th>Conf.</th><th>Severity</th><th>Review</th></tr></thead><tbody>${rows}</tbody></table>
${result.ignoredLog.length ? `<h2>Ignore regions</h2><table><tr><th>Rule</th><th>Region (DEV px)</th><th>Suppressed pixels</th><th>Excluded text items</th></tr>${result.ignoredLog.map((l) => `<tr><td>${esc(l.label)}</td><td>${l.rect.x},${l.rect.y} ${l.rect.width}×${l.rect.height}</td><td>${l.suppressedPixels.toLocaleString()}</td><td>${l.suppressedTextItems ?? 0}</td></tr>`).join('')}</table>` : ''}
${result.ignoredFields.length ? `<h2>Ignored fields</h2><div class="m">Configured exclusions (text/labels), e.g. timestamps or known test-data differences.</div><table><tr><th>Rule</th><th>Excluded in DEV</th><th>Excluded in PROD</th></tr>${result.ignoredFields.map((f) => `<tr><td>${esc(f.rule)}</td><td>${esc(f.devItems.join(' · ') || '—')}</td><td>${esc(f.prodItems.join(' · ') || '—')}</td></tr>`).join('')}</table>` : ''}
<h2>Limitations</h2><ul>${result.summary.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<script type="application/json" id="qa-vision-data">${data}</script>
</body></html>`;
  };

  const exportHtml = async () => {
    const html = await buildHtml();
    if (html) downloadBlob(html, 'text/html', `${fileBase()}.html`);
  };

  const printPdf = async () => {
    const html = await buildHtml();
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (!w) {
      setError('Pop-up blocked: allow pop-ups for this page, or download the HTML report and print it to PDF.');
      return;
    }
    w.addEventListener('load', () => setTimeout(() => w.print(), 300));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const exportAnnotatedPng = async () => {
    if (!result || !dev || !prod) return;
    const [di, pi] = await Promise.all([loadImg(dev.url), loadImg(prod.url)]);
    const gap = 24, head = 40;
    const c = document.createElement('canvas');
    c.width = di.naturalWidth + pi.naturalWidth + gap;
    c.height = Math.max(di.naturalHeight, pi.naturalHeight) + head;
    const g = c.getContext('2d')!;
    g.fillStyle = '#18181b';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.font = 'bold 20px system-ui';
    g.fillText(`${result.devLabel} (New Changes)`, 8, 27);
    g.fillText(`${result.prodLabel} (Reference)`, di.naturalWidth + gap + 8, 27);
    g.drawImage(di, 0, head);
    g.drawImage(pi, di.naturalWidth + gap, head);
    const draw = (b: ShotBBox, ox: number, f: ScreenshotFinding) => {
      const m = CAT[f.category];
      g.strokeStyle = m.color;
      g.lineWidth = 3;
      g.setLineDash(m.dash ? m.dash.split(' ').map((n) => Number(n) * 2) : []);
      g.strokeRect(ox + b.x, head + b.y, b.width, b.height);
      g.setLineDash([]);
      const label = `${f.number} ${m.glyph}`;
      g.font = 'bold 15px system-ui';
      const tw = g.measureText(label).width + 10;
      const ty = Math.max(head, head + b.y - 20);
      g.fillStyle = m.color;
      g.fillRect(ox + b.x, ty, tw, 20);
      g.fillStyle = '#000';
      g.fillText(label, ox + b.x + 5, ty + 15);
    };
    for (const f of findings.filter((x) => x.number > 0)) {
      if (f.devBbox) draw(f.devBbox, 0, f);
      if (f.prodBbox) draw(f.prodBbox, di.naturalWidth + gap, f);
    }
    c.toBlob((b) => b && downloadBlob(b, 'image/png', `${fileBase()}-annotated.png`), 'image/png');
  };

  // ---------------------------------------------------------------- render helpers

  const panel = (side: Side) => {
    const img = images[side];
    const active = activePanel === side;
    return (
      <div
        role="region"
        aria-label={`${side === 'dev' ? 'DEV (New Changes)' : 'PROD (Reference)'} screenshot panel`}
        tabIndex={0}
        data-testid={`panel-${side}`}
        data-active={active ? 'true' : 'false'}
        onFocus={() => setActivePanel(side)}
        onClick={() => setActivePanel(side)}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); inputRefs[side].current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(side); setActivePanel(side); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(null);
          const f = e.dataTransfer.files?.[0];
          if (f) void loadImage(f, side);
        }}
        className={`rounded-3xl border-2 p-5 outline-none transition-all ${
          active ? (side === 'dev' ? 'border-emerald-500 bg-emerald-950/20' : 'border-sky-500 bg-sky-950/20') : 'border-zinc-800'
        } ${dragOver === side ? 'ring-4 ring-white/30' : ''}`}
      >
        <input ref={inputRefs[side]} type="file" accept={ACCEPT.join(',')} className="hidden" data-testid={`file-${side}`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadImage(f, side); e.target.value = ''; }} />
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${side === 'dev' ? 'bg-emerald-500' : 'bg-sky-500'}`} />
            <h3 className={`font-semibold ${side === 'dev' ? 'text-emerald-400' : 'text-sky-400'}`}>
              {side === 'dev' ? `${labelOf('dev')} (New Changes)` : `${labelOf('prod')} (Reference)`}
            </h3>
          </div>
          <span className={`text-xs ${active ? 'font-semibold text-white' : 'text-zinc-500'}`}>
            {active ? '● Ctrl+V pastes here' : 'Click to target paste'}
          </span>
        </div>

        <div className="relative flex h-80 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-zinc-700 bg-zinc-900">
          {img ? (
            <div
              className="relative inline-block max-h-full max-w-full"
              style={{ cursor: side === 'dev' && drawMode ? 'crosshair' : 'default', touchAction: drawMode ? 'none' : 'auto' }}
              onPointerDown={(e) => {
                if (side !== 'dev' || !drawMode) return;
                e.stopPropagation();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const p = toSource(e);
                setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
              }}
              onPointerMove={(e) => { if (draft && side === 'dev') { const p = toSource(e); setDraft((d) => (d ? { ...d, x1: p.x, y1: p.y } : d)); } }}
              onPointerUp={() => side === 'dev' && finishDraft()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={side === 'dev' ? devPreviewImg : undefined} src={img.url} alt={`${side.toUpperCase()} screenshot`} draggable={false}
                className="block max-h-80 max-w-full object-contain" data-testid={`preview-${side}`} />
              {(ignoreRegions.length > 0 || draft) && (side === 'dev' || !sizeMismatch) && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${img.width} ${img.height}`} preserveAspectRatio="none">
                  {ignoreRegions.map((r, i) => (
                    <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill="#3b82f633" stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
                  ))}
                  {draft && side === 'dev' && (
                    <rect x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)} width={Math.abs(draft.x1 - draft.x0)} height={Math.abs(draft.y1 - draft.y0)}
                      fill="#facc1533" stroke="#facc15" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  )}
                </svg>
              )}
            </div>
          ) : (
            <div className="px-4 text-center">
              <Upload className="mx-auto mb-3 h-10 w-10 text-zinc-500" />
              <p className="text-zinc-300">Ctrl+V or drop image</p>
              <p className="mt-1 text-xs text-zinc-500">PNG, JPG or WebP · up to 10 MB</p>
              <button onClick={(e) => { e.stopPropagation(); setActivePanel(side); inputRefs[side].current?.click(); }}
                className="mx-auto mt-5 flex items-center gap-2 rounded-2xl bg-zinc-800 px-6 py-2.5 text-sm hover:bg-zinc-700" data-testid={`upload-${side}`}>
                <Upload className="h-4 w-4" /> Upload {side.toUpperCase()} image
              </button>
            </div>
          )}
        </div>

        {img && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
            <div className="truncate" data-testid={`meta-${side}`}>{img.name} · {img.width}×{img.height} · {(img.size / 1024).toFixed(0)} KB</div>
            <div className="flex gap-1">
              <button onClick={(e) => { e.stopPropagation(); setPreview(side); setPreviewZoom(1); }} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-zinc-800" aria-label={`Preview ${side}`}>
                <Maximize2 className="h-3.5 w-3.5" /> Preview / zoom
              </button>
              <button onClick={(e) => { e.stopPropagation(); inputRefs[side].current?.click(); }} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-zinc-800">
                <RefreshCw className="h-3.5 w-3.5" /> Replace
              </button>
              <button onClick={(e) => { e.stopPropagation(); removeImage(side); }} className="flex items-center gap-1 rounded-lg px-2 py-1 text-rose-400 hover:bg-zinc-800" data-testid={`remove-${side}`}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const canvasSrc = (side: Side) => {
    if (!result) return '';
    const b64 = side === 'dev' ? result.evidence.devCanvasPngBase64 : result.evidence.prodCanvasPngBase64;
    return b64 ? `data:image/png;base64,${b64}` : images[side]?.url || '';
  };

  const viewer = () => {
    if (!result || !dev || !prod || result.status === 'alignment-required') return null;
    const cW = result.canvas.width, cH = result.canvas.height;
    if (viewMode === 'side') {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(['dev', 'prod'] as Side[]).map((s) => {
            const im = images[s]!;
            return (
              <ZoomPane key={s} srcW={im.width} srcH={im.height} view={view} setView={setView} testId={`viewer-${s}`}
                label={s === 'dev' ? `${labelOf('dev')} (New Changes)` : `${labelOf('prod')} (Reference)`}>
                {(scale) => (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt={`${s} screenshot`} draggable={false} className="block h-full w-full" />
                    <Annotations findings={annotated} side={s} width={im.width} height={im.height} selectedId={selectedId} onSelect={(id) => focusFinding(id, true)} scale={scale} result={result} />
                  </>
                )}
              </ZoomPane>
            );
          })}
        </div>
      );
    }
    const label = viewMode === 'overlay' ? `Overlay: PROD over DEV at ${overlayOpacity}%` : viewMode === 'slider' ? `Slider: DEV ◀ ${sliderPos}% ▶ PROD` : 'Difference map';
    return (
      <ZoomPane srcW={cW} srcH={cH} view={view} setView={setView} label={label} testId={`viewer-${viewMode}`}>
        {(scale) => (
          <>
            {viewMode === 'diff' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/png;base64,${result.evidence.diffPngBase64}`} alt="Difference map" draggable={false} className="block h-full w-full" />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={canvasSrc(viewMode === 'slider' ? 'prod' : 'dev')} alt="base layer" draggable={false} className="absolute inset-0 block h-full w-full" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={canvasSrc(viewMode === 'slider' ? 'dev' : 'prod')}
                  alt="top layer"
                  draggable={false}
                  className="absolute inset-0 block h-full w-full"
                  style={viewMode === 'overlay' ? { opacity: overlayOpacity / 100 } : { clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                />
                {viewMode === 'slider' && <div className="absolute bottom-0 top-0 w-0.5 bg-yellow-400" style={{ left: `${sliderPos}%` }} />}
              </>
            )}
            <Annotations findings={annotated} side="canvas" width={cW} height={cH} selectedId={selectedId} onSelect={(id) => focusFinding(id, true)} scale={scale} result={result} />
          </>
        )}
      </ZoomPane>
    );
  };

  // ---------------------------------------------------------------- render

  return (
    <div className="flex-1 overflow-auto bg-zinc-950 p-6" data-testid="screenshot-comparison">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Two Screen Comparison</h1>
            <p className="mt-1 text-zinc-400">Compare a DEV screenshot (new changes) with a PROD screenshot (known-good reference). No live sites, logins or browsers involved.</p>
          </div>
          <div className="flex gap-2">
            {result && result.status !== 'alignment-required' && (
              <button onClick={exportHtml} className="flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-medium text-black hover:bg-zinc-200" data-testid="download-report">
                <FileText className="h-4 w-4" /> Download Report
              </button>
            )}
            <button onClick={reset} className="flex items-center gap-2 rounded-2xl bg-zinc-800 px-5 py-2.5 text-sm font-medium hover:bg-zinc-700" data-testid="reset">
              <RotateCcw className="h-4 w-4" /> Clear
            </button>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-600/50 bg-amber-950/30 p-4 text-sm text-amber-200" data-testid="privacy-warning">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <b>Screenshots may contain personal data or credentials.</b> Crop or mask sensitive areas first. Comparison runs locally on this QA Vision server
            (<Lock className="inline h-3 w-3" /> local-only by default); screenshots are processed in memory for this request and not stored. Nothing is sent
            to a third party unless you tick the AI option below.
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-500/50 bg-rose-950/50 p-4 text-rose-200" data-testid="error">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <button onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {panel('dev')}
          {panel('prod')}
        </div>

        <div className="mt-5 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4" data-testid="scope">
          <div className="mb-1 font-semibold">What do you want to compare?</div>
          <div className="mb-3 text-xs text-zinc-400">Only the checked categories are run and reported. Data correctness comes first; styling and layout only when you ask for them.</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {SHOT_SCOPES.map((s) => {
              const info = SHOT_SCOPE_INFO[s];
              const on = scope.has(s);
              return (
                <label key={s} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${on ? 'border-white/70 bg-zinc-800' : 'border-zinc-800 hover:border-zinc-600'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleScope(s)} className="mt-1" data-testid={`scope-${s}`} />
                  <span>
                    <span className="font-semibold">{info.label}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${info.priority === 'P1' ? 'bg-rose-600' : info.priority === 'P2' ? 'bg-amber-600' : 'bg-zinc-600'}`}>{info.priority}</span>
                    <span className="mt-0.5 block text-xs text-zinc-400">{info.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {scopeList.length === 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm text-amber-300" data-testid="scope-required"><AlertTriangle className="h-4 w-4" /> Select at least one category to compare.</div>
          )}
          {scope.has('data_text') && ocrInfo && !ocrInfo.available && (
            <div className="mt-3 flex items-center gap-2 text-sm text-amber-300" data-testid="ocr-unavailable"><AlertTriangle className="h-4 w-4" /> OCR unavailable ({ocrInfo.note}) — Data &amp; Text will locate text changes but cannot read values.</div>
          )}
        </div>

        {sizeMismatch && !needsAlignment && (
          <div className="mt-5 rounded-2xl border border-sky-600/50 bg-sky-950/30 p-4 text-sm text-sky-100" data-testid="size-info">
            DEV is {dev!.width}×{dev!.height}, PROD is {prod!.width}×{prod!.height}. Only Data &amp; Text is selected, so visible text is matched by content — no alignment needed.
            Select a visual check to compare pixels (alignment will then be required).
          </div>
        )}

        {needsAlignment && (
          <div className="mt-5 rounded-2xl border border-amber-500/60 bg-amber-950/30 p-4 text-sm" data-testid="alignment-warning">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <AlertTriangle className="h-4 w-4" /> Different dimensions — alignment required
            </div>
            <p className="mt-1 text-amber-100/80">
              DEV is {dev!.width}×{dev!.height}, PROD is {prod!.width}×{prod!.height}. Screenshots may differ in viewport, zoom, scroll position or device pixel ratio.
              Originals are never modified; choose how to line them up:
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              {([
                ['top-left', 'Align top-left', 'Compare the overlapping area; extra area is reported as a size difference. No resampling.'],
                ['scale', 'Scale PROD to DEV', 'Resample PROD to DEV size (for different zoom/DPR). May add resampling noise.'],
              ] as const).map(([v, t, d]) => (
                <label key={v} className={`flex max-w-sm cursor-pointer items-start gap-2 rounded-xl border p-3 ${alignment === v ? 'border-amber-400 bg-amber-900/30' : 'border-zinc-700'}`}>
                  <input type="radio" name="alignment" checked={alignment === v} onChange={() => { setAlignment(v); setResult(null); }} className="mt-1" data-testid={`align-${v}`} />
                  <span><b>{t}</b><br /><span className="text-xs text-zinc-400">{d}</span></span>
                </label>
              ))}
            </div>
          </div>
        )}

        <details className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4" open>
          <summary className="cursor-pointer text-sm font-semibold">Comparison settings (optional)</summary>
          <div className="mt-4 rounded-xl border border-zinc-800 p-3 text-sm" data-testid="text-settings">
            <div className="mb-2 font-semibold">Data &amp; Text matching</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <label>Text matching
                <select value={matching} onChange={(e) => { setMatching(e.target.value as 'normalized' | 'strict'); setResult(null); }} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" data-testid="opt-matching">
                  <option value="normalized">Normalized (1,250 = 1250; $1,250.00 = $1250; Nov 3, 2026 = 2026-11-03)</option>
                  <option value="strict">Strict (exact visible text)</option>
                </select>
              </label>
              <label>Numeric tolerance (±)
                <input type="number" min={0} step="any" value={numericTolerance} onChange={(e) => { setNumericTolerance(Math.max(0, Number(e.target.value) || 0)); setResult(null); }} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" data-testid="opt-tolerance" />
              </label>
              <label>Min. OCR confidence: {ocrMinConf}%
                <input type="range" min={30} max={95} step={5} value={ocrMinConf} onChange={(e) => { setOcrMinConf(+e.target.value); setResult(null); }} className="mt-3 w-full" data-testid="opt-ocr-conf" />
                <span className="block text-xs text-zinc-500">Lower readings are marked Uncertain / needs review.</span>
              </label>
              <label className="flex items-center gap-2 pt-6">
                <input type="checkbox" checked={caseSensitive} onChange={(e) => { setCaseSensitive(e.target.checked); setResult(null); }} /> Case-sensitive
              </label>
              <label className="md:col-span-4">Ignored fields (comma or new line; text or /regex/)
                <input value={ignoreFieldsText} onChange={(e) => { setIgnoreFieldsText(e.target.value); setResult(null); }} placeholder="e.g. Last updated, Session ID, /^Welcome/"
                  className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" data-testid="opt-ignore-fields" />
                <span className="block text-xs text-zinc-500">Timestamps, randomized IDs, personalized content or known test-data differences. Every exclusion is listed in the report.</span>
              </label>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="text-sm">Page name
              <input value={pageName} onChange={(e) => setPageName(e.target.value)} placeholder="e.g. Users list" className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" data-testid="opt-page" />
            </label>
            <label className="text-sm">DEV label
              <input value={devLabel} onChange={(e) => setDevLabel(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <label className="text-sm">PROD label
              <input value={prodLabel} onChange={(e) => setProdLabel(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <label className="text-sm md:col-span-2">Expected intentional differences (notes for reviewers and the report)
              <textarea value={expectedNotes} onChange={(e) => setExpectedNotes(e.target.value)} rows={2} placeholder="e.g. New primary button color; chart is experimental in DEV"
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <label className="text-sm">Sensitivity
              <select value={sensitivity} onChange={(e) => { setSensitivity(e.target.value as ShotSensitivity); setResult(null); }} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" data-testid="opt-sensitivity">
                <option value="strict">Strict — smallest changes (threshold 0.05)</option>
                <option value="normal">Normal (threshold 0.10)</option>
                <option value="relaxed">Relaxed — ignore subtle shading (0.20)</option>
              </select>
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={!dev}
                onClick={() => setDrawMode((d) => !d)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${drawMode ? 'bg-yellow-400 text-black' : 'bg-zinc-800 hover:bg-zinc-700'} disabled:opacity-40`}
                data-testid="draw-ignore"
              >
                <MousePointerSquareDashed className="h-4 w-4" /> {drawMode ? 'Drawing: drag on the DEV image (click to stop)' : 'Add ignore region'}
              </button>
              <span className="text-xs text-zinc-500">Exclude clocks, timestamps, avatars or rotating banners. Regions use DEV pixel coordinates and are logged in the report.</span>
            </div>
            {ignoreRegions.length > 0 && (
              <ul className="mt-3 space-y-2" data-testid="ignore-list">
                {ignoreRegions.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <input value={r.label} onChange={(e) => setIgnoreRegions((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      className="w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1" aria-label={`Ignore region ${i + 1} label`} />
                    <span className="font-mono text-xs text-zinc-400">({r.x}, {r.y}) {r.width}×{r.height}px</span>
                    <button onClick={() => { setIgnoreRegions((p) => p.filter((_, j) => j !== i)); setResult(null); }} className="text-rose-400 hover:text-rose-300" aria-label={`Remove ignore region ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 p-3 text-sm" data-testid="ai-option">
            <label className={`flex items-start gap-2 ${aiInfo?.configured && aiInfo.visionCapable ? 'cursor-pointer' : 'opacity-60'}`}>
              <input type="checkbox" checked={aiConsent} disabled={!aiInfo?.configured || !aiInfo.visionCapable} onChange={(e) => setAiConsent(e.target.checked)} className="mt-1" data-testid="ai-consent" />
              <span>
                <b>Ask an AI vision model to explain the differences</b> (optional, advisory).{' '}
                {aiInfo?.configured && aiInfo.visionCapable ? (
                  <>I consent to sending <b>cropped regions</b> around detected differences to <b>{aiInfo.provider}</b> ({aiInfo.model}). Whole screenshots are not sent.</>
                ) : (
                  <span className="text-zinc-400">Unavailable: {aiInfo?.note || 'checking server…'} Deterministic comparison is used.</span>
                )}
              </span>
            </label>
          </div>
        </details>

        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            onClick={compare}
            disabled={!canCompare}
            className="flex items-center gap-3 rounded-3xl bg-white px-12 py-4 text-lg font-semibold text-black shadow-xl shadow-white/10 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="compare"
          >
            {isComparing ? <RefreshCw className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            {isComparing ? 'Comparing…' : 'Compare Screenshots'}
          </button>
          <div className="text-xs text-zinc-500" data-testid="status" aria-live="polite">
            {progress || (!dev || !prod ? `Add ${!dev && !prod ? 'both screenshots' : !dev ? 'the DEV screenshot' : 'the PROD screenshot'} to compare.` : !scopeList.length ? 'Select at least one comparison category.' : needsAlignment && alignment === 'none' ? 'Choose an alignment to compare.' : `Ready to compare: ${scopeList.map((s) => SHOT_SCOPE_INFO[s].label).join(', ')}.`)}
          </div>
        </div>

        {result && (
          <div className="mt-10" data-testid="results">
            {result.warnings.length > 0 && (
              <div className="mb-4 space-y-2" data-testid="warnings">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}

            {result.status === 'alignment-required' ? (
              <div className="rounded-2xl border border-amber-500/60 bg-amber-950/30 p-6 text-amber-200">Alignment required — choose an option above and compare again.</div>
            ) : (
              <>
                {result.status === 'no-differences' && (
                  <div className="mb-6 flex items-center gap-4 rounded-3xl border border-emerald-500/50 bg-emerald-950/30 p-6" data-testid="no-differences">
                    <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                    <div>
                      <div className="text-2xl font-semibold text-emerald-300">No material differences within tolerance 🎉</div>
                      <div className="text-sm text-emerald-100/70">
                        Checked: {result.scope.map((s) => SHOT_SCOPE_INFO[s].label).join(', ')}
                        {result.ocr.used ? ` · ${result.summary.matchedItems} visible text items matched` : ''}
                        {result.pixelAnalysis ? ` · ${result.summary.similarityPercent}% pixel similarity at “${result.settings.sensitivity}” sensitivity` : ''}
                        {result.ignoredLog.length + result.ignoredFields.length ? ` · ${result.ignoredLog.length + result.ignoredFields.length} ignore rule(s) applied` : ''}. Unchecked categories were not run. A visual match does not prove functional correctness.
                      </div>
                    </div>
                  </div>
                )}

                <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-5" data-testid="scope-summary">
                  {SHOT_SCOPES.map((s) => {
                    const b = result.summary.byScope[s];
                    const info = SHOT_SCOPE_INFO[s];
                    return (
                      <div key={s} data-testid={`scope-summary-${s}`} data-checked={b.checked ? 'true' : 'false'}
                        className={`rounded-xl border p-3 text-xs ${!b.checked ? 'border-zinc-800 text-zinc-500' : b.findings ? 'border-rose-700/60 bg-rose-950/20' : 'border-emerald-700/60 bg-emerald-950/20'}`}>
                        <div className="font-semibold">{info.priority} · {info.label}</div>
                        <div className="mt-1">
                          {!b.checked ? 'Not checked' : b.findings ? `${b.mismatches} mismatch(es) · ${b.uncertain} uncertain` : 'No differences found'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="summary">
                  {[
                    ['Confirmed mismatches', String(result.summary.confirmedMismatches)],
                    ['Uncertain / needs review', String(result.summary.uncertainItems)],
                    ['Matched text items', result.ocr.used ? String(result.summary.matchedItems) : '—'],
                    result.pixelAnalysis ? ['Pixels changed', `${result.summary.diffPercent}%`] : ['Ignored items', String(result.ignoredLog.length + result.ignoredFields.reduce((n, f) => n + f.devItems.length + f.prodItems.length, 0))],
                    ['Reviewed', `${realFindings.filter((f) => f.reviewStatus !== 'needs-review').length}/${realFindings.length}`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                      <div className="text-xs uppercase tracking-wider text-zinc-500">{k}</div>
                      <div className="mt-1 text-2xl font-semibold">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                  {Object.entries(result.summary.mismatchesByCategory).map(([k, v]) => (
                    <span key={k} className="rounded-full px-3 py-1 font-semibold text-black" style={{ background: CAT[k as ShotCategory]?.color }}>{CAT[k as ShotCategory]?.glyph} {CAT[k as ShotCategory]?.label}: {v}</span>
                  ))}
                  {(['confirmed-defect', 'expected', 'false-positive'] as ShotReviewStatus[]).map((s) => (reviewCounts[s] ? <span key={s} className="rounded-full bg-zinc-800 px-3 py-1">{REVIEW[s]}: {reviewCounts[s]}</span> : null))}
                  <span className="text-zinc-500">· {result.alignment.description}</span>
                </div>

                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex rounded-xl bg-zinc-900 p-1 text-sm" role="tablist">
                    {([['side', 'Side by side'], ['overlay', 'Overlay'], ['slider', 'Before/after slider'], ['diff', 'Diff map']] as const).filter(([m]) => m === 'side' || result.pixelAnalysis).map(([m, t]) => (
                      <button key={m} role="tab" aria-selected={viewMode === m} onClick={() => setViewMode(m)} data-testid={`mode-${m}`}
                        className={`rounded-lg px-3 py-1.5 ${viewMode === m ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>{t}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {viewMode === 'overlay' && (
                      <label className="flex items-center gap-2 text-xs">PROD opacity
                        <input type="range" min={0} max={100} value={overlayOpacity} onChange={(e) => setOverlayOpacity(+e.target.value)} />
                      </label>
                    )}
                    {viewMode === 'slider' && (
                      <label className="flex items-center gap-2 text-xs">Position
                        <input type="range" min={0} max={100} value={sliderPos} onChange={(e) => setSliderPos(+e.target.value)} data-testid="slider" />
                      </label>
                    )}
                    <button onClick={() => setShowAnnotations((s) => !s)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-zinc-300 hover:bg-zinc-800" data-testid="toggle-annotations">
                      {showAnnotations ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {showAnnotations ? 'Hide' : 'Show'} boxes
                    </button>
                    <button onClick={() => setView((v) => ({ ...v, zoom: Math.max(1, v.zoom / 1.5), cy: v.cy || 0.0001 }))} className="rounded-lg p-1.5 hover:bg-zinc-800" aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
                    <span className="w-12 text-center font-mono text-xs" data-testid="zoom-level">{Math.round(view.zoom * 100)}%</span>
                    <button onClick={() => setView((v) => ({ ...v, zoom: Math.min(12, v.zoom * 1.5), cy: v.cy || 0.0001 }))} className="rounded-lg p-1.5 hover:bg-zinc-800" aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
                    <button onClick={() => setView(FIT)} className="rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-800">Fit</button>
                  </div>
                </div>
                <div className="mb-2 text-xs text-zinc-500">Drag to pan · Ctrl+scroll to zoom · click a box or a finding to highlight it on both images.</div>
                {viewer()}

                <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
                  <div className="lg:col-span-4">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm" data-testid="filters">
                      <div className="mb-2 font-semibold">Filters</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.keys(CAT) as ShotCategory[]).filter((c) => c !== 'match').map((c) => {
                          const on = catFilter.has(c);
                          return (
                            <button key={c} onClick={() => setCatFilter((p) => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n; })}
                              className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'text-black' : 'border-zinc-700 text-zinc-300'}`}
                              style={on ? { background: CAT[c].color, borderColor: CAT[c].color } : undefined} aria-pressed={on} data-testid={`filter-${c}`}>
                              {CAT[c].glyph} {CAT[c].label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value as '' | ShotSeverity)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs" aria-label="Severity filter">
                          <option value="">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                        </select>
                        <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as '' | ShotReviewStatus)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs" aria-label="Review filter">
                          <option value="">Any review status</option>
                          {(Object.keys(REVIEW) as ShotReviewStatus[]).map((s) => <option key={s} value={s}>{REVIEW[s]}</option>)}
                        </select>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | 'confirmed' | 'uncertain')} className="col-span-2 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs" aria-label="Mismatch filter" data-testid="filter-status">
                          <option value="">Mismatches and uncertain items</option>
                          <option value="confirmed">Mismatches only (incl. missing/extra)</option>
                          <option value="uncertain">Uncertain / needs review only</option>
                        </select>
                      </div>
                      <label className="mt-3 block text-xs">Minimum confidence: {minConfidence}%
                        <input type="range" min={0} max={95} step={5} value={minConfidence} onChange={(e) => setMinConfidence(+e.target.value)} className="w-full" />
                      </label>
                    </div>

                    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
                      <div className="mb-2 font-semibold">Export</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={exportHtml} className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-black hover:bg-zinc-200" data-testid="export-html"><FileText className="h-4 w-4" /> HTML report</button>
                        <button onClick={exportJson} className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 hover:bg-emerald-500" data-testid="export-json"><FileJson className="h-4 w-4" /> JSON</button>
                        <button onClick={exportAnnotatedPng} className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-800 px-3 py-2 hover:bg-zinc-700" data-testid="export-png"><ImageIcon className="h-4 w-4" /> Annotated PNG</button>
                        <button onClick={printPdf} className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-800 px-3 py-2 hover:bg-zinc-700"><Printer className="h-4 w-4" /> Print / PDF</button>
                      </div>
                      <div className="mt-2 text-xs text-zinc-500">Exports include the originals (metadata removed), boxes, annotations and your review decisions.</div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400" data-testid="ocr-note">
                      <div className="mb-1 font-semibold text-zinc-300">Text reading (OCR)</div>{result.ocr.note}
                    </div>
                    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400" data-testid="ai-note">
                      <div className="mb-1 font-semibold text-zinc-300">AI</div>{result.ai.note}
                    </div>
                  </div>

                  <div className="lg:col-span-8">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-xl font-semibold">Findings ({filtered.length}{filtered.length !== realFindings.length ? ` of ${realFindings.length}` : ''})</h2>
                      {selected && <button onClick={() => { setSelectedId(null); setView(FIT); }} className="text-xs text-zinc-400 hover:text-white">Clear selection</button>}
                    </div>
                    <div className="max-h-[900px] space-y-3 overflow-auto pr-1" data-testid="findings">
                      {filtered.length === 0 && (
                        <div className="rounded-2xl border border-zinc-800 p-6 text-center text-sm text-zinc-500">
                          {realFindings.length === 0 ? 'No differences to review.' : 'No findings match the filters.'}
                        </div>
                      )}
                      {filtered.map((f) => {
                        const m = CAT[f.category];
                        const sel = f.id === selectedId;
                        return (
                          <div key={f.id} ref={(el) => { listRefs.current[f.id] = el; }} onClick={() => focusFinding(f.id)} data-testid={`finding-${f.number}`} data-selected={sel ? 'true' : 'false'}
                            className={`cursor-pointer rounded-2xl border p-4 transition-all ${sel ? 'border-yellow-400 bg-yellow-950/20' : 'border-zinc-800 hover:border-zinc-600'}`}>
                            <div className="flex items-start gap-3">
                              <span className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-sm font-bold text-black" style={{ background: m.color }}>
                                {f.number ? `${f.number} ` : ''}{m.glyph}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-xs text-zinc-400" data-testid={`code-${f.number}`}>{f.code}</span>
                                  <span className="font-medium">{f.title}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[f.status].cls}`} data-testid={`status-${f.number}`}>{STATUS[f.status].label}</span>
                                  <span className="text-xs uppercase tracking-wider text-zinc-500">{f.scope ? SHOT_SCOPE_INFO[f.scope].label : ''} · {m.label}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs ${SEV_CLS[f.severitySuggestion]}`}>{f.severitySuggestion} (suggested)</span>
                                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs">{Math.round(f.confidence * 100)}% conf.</span>
                                </div>
                                {f.devValue !== undefined || f.prodValue !== undefined ? (
                                  <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2" data-testid={`values-${f.number}`}>
                                    <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/20 px-3 py-2">
                                      <div className="text-[11px] uppercase tracking-wider text-emerald-400">{labelOf('dev')}{f.field ? ` · ${f.field}` : ''}</div>
                                      <div className="font-mono" data-testid={`dev-value-${f.number}`}>{f.devValue ?? <span className="italic text-zinc-500">not found</span>}</div>
                                    </div>
                                    <div className="rounded-lg border border-sky-800/60 bg-sky-950/20 px-3 py-2">
                                      <div className="text-[11px] uppercase tracking-wider text-sky-400">{labelOf('prod')} (baseline){f.field ? ` · ${f.field}` : ''}</div>
                                      <div className="font-mono" data-testid={`prod-value-${f.number}`}>{f.prodValue ?? <span className="italic text-zinc-500">not found</span>}</div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-2 grid grid-cols-1 gap-1 text-xs md:grid-cols-2">
                                    <div><span className="text-emerald-400">{labelOf('dev')}:</span> {f.devObservation}</div>
                                    <div><span className="text-sky-400">{labelOf('prod')}:</span> {f.prodObservation}</div>
                                  </div>
                                )}
                                {f.pageSection && <div className="mt-1 text-xs text-zinc-500">Section: {f.pageSection}</div>}
                                {f.reviewNote && <div className="mt-1 text-xs text-amber-200/80">{f.reviewNote}</div>}
                                {(f.metrics?.devColor || f.metrics?.prodColor) && (
                                  <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                                    <span className="inline-block h-4 w-4 rounded border border-zinc-600" style={{ background: String(f.metrics.devColor) }} /> {String(f.metrics.devColor)}
                                    <span>→</span>
                                    <span className="inline-block h-4 w-4 rounded border border-zinc-600" style={{ background: String(f.metrics.prodColor) }} /> {String(f.metrics.prodColor)}
                                  </div>
                                )}
                                <div className="mt-2 text-xs text-zinc-500">{f.evidence}</div>
                                <div className="mt-1 font-mono text-[11px] text-zinc-600">
                                  {f.devBbox ? `DEV box ${f.devBbox.x},${f.devBbox.y} ${f.devBbox.width}×${f.devBbox.height}` : 'DEV: —'} · {f.prodBbox ? `PROD box ${f.prodBbox.x},${f.prodBbox.y} ${f.prodBbox.width}×${f.prodBbox.height}` : 'PROD: —'}
                                </div>
                                {f.ai && (
                                  <div className="mt-2 rounded-lg border border-purple-800/60 bg-purple-950/30 p-2 text-xs text-purple-200">
                                    <b>AI (advisory, unverified):</b> {f.ai.explanation}
                                    {(f.ai.devText || f.ai.prodText) && <div className="mt-1">DEV reads “{f.ai.devText}” · PROD reads “{f.ai.prodText}”</div>}
                                  </div>
                                )}
                                <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()} role="radiogroup" aria-label={`Review status for finding ${f.number}`}>
                                  {(Object.keys(REVIEW) as ShotReviewStatus[]).map((s) => (
                                    <button key={s} onClick={() => setReview(f.id, s)} role="radio" aria-checked={f.reviewStatus === s} data-testid={`review-${f.number}-${s}`}
                                      className={`rounded-lg border px-2 py-1 text-xs ${f.reviewStatus === s ? 'border-white bg-white text-black' : 'border-zinc-700 text-zinc-400 hover:text-white'}`}>
                                      {REVIEW[s]}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {(ignoredFindings.length > 0 || result.ignoredFields.length > 0) && (
                      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm" data-testid="ignored-log">
                        <div className="mb-2 font-semibold">Ignored by rule</div>
                        {ignoredFindings.map((f) => (
                          <div key={f.id} className="text-xs text-zinc-400">⊘ <b className="text-zinc-300">{f.ignoredByRule}</b> — {f.devObservation}; {f.prodObservation}</div>
                        ))}
                        {result.ignoredFields.map((f) => (
                          <div key={f.rule} className="text-xs text-zinc-400" data-testid="ignored-field">
                            ⊘ <b className="text-zinc-300">Field “{f.rule}”</b> — {f.devItems.length || f.prodItems.length
                              ? <>excluded DEV: {f.devItems.join(' · ') || '—'}; PROD: {f.prodItems.join(' · ') || '—'}</>
                              : 'matched nothing'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-8 border-t border-zinc-800 pt-4 text-xs text-zinc-500" data-testid="limitations">
                  <div className="mb-1 font-semibold text-zinc-400">Limitations</div>
                  <ul className="list-disc space-y-0.5 pl-5">{result.summary.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {preview && images[preview] && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={() => setPreview(null)} onKeyDown={(e) => e.key === 'Escape' && setPreview(null)} role="dialog" aria-label="Screenshot preview" tabIndex={-1}>
          <div className="flex items-center justify-between p-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <span>{preview === 'dev' ? `${labelOf('dev')} (New Changes)` : `${labelOf('prod')} (Reference)`} — {images[preview]!.width}×{images[preview]!.height}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPreviewZoom((z) => Math.max(0.25, z / 1.25))} className="rounded p-1.5 hover:bg-zinc-800" aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
              <span className="w-12 text-center font-mono text-xs">{Math.round(previewZoom * 100)}%</span>
              <button onClick={() => setPreviewZoom((z) => Math.min(8, z * 1.25))} className="rounded p-1.5 hover:bg-zinc-800" aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
              <button onClick={() => setPreview(null)} className="rounded p-1.5 hover:bg-zinc-800" aria-label="Close preview"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[preview]!.url} alt="Preview" style={{ width: images[preview]!.width * previewZoom, maxWidth: 'none' }} className="mx-auto block" />
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreenshotComparison;
