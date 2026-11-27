import type { CaptureSettings, Category, Classification, FindingDraft } from './types';

type Draftish = Partial<FindingDraft> & { type: Category; diffPercent?: number };

/** Identity of a finding: same page + same kind + same element + same values. */
export function fingerprint(page: string, f: Draftish): string {
  const base: string[] = [page, f.type, f.classification || '', String(f.component ?? '')];
  if (f.type === 'Visual') {
    // pixel ratio jitters between captures; bucket to whole percent
    base.push(String(Math.round((Number(f.diffPercent) || 0) * 100)));
  } else {
    base.push(
      String(f.devValue ?? ''),
      String(f.prodValue ?? ''),
      f.type === 'Interaction' || f.type === 'Safety' ? String(f.description ?? '') : ''
    );
  }
  if (f.property) base.push(f.property);
  return base.join('␟');
}

const HIGH: Category[] = ['Text', 'DOM', 'Data', 'Network', 'Console'];
const MID: Category[] = ['CSS', 'Layout', 'Accessibility'];

export function classifyFinding(
  f: Draftish,
  expectedFingerprints: Set<string>,
  fp: string
): { classification: Classification; confidence: number; ruleApplied: string | null } {
  if (f.classification) return { classification: f.classification, confidence: 1, ruleApplied: null };
  if (expectedFingerprints.has(fp)) {
    return { classification: 'EXPECTED_DIFFERENCE', confidence: 1, ruleApplied: 'expected:' + fp };
  }
  const confidence = HIGH.includes(f.type) ? 0.9 : MID.includes(f.type) ? 0.75 : 0.6;
  return { classification: 'POTENTIAL_DEFECT', confidence, ruleApplied: null };
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  viewport: { width: 1280, height: 800 },
  pixelThreshold: 0.1,
  visualDiffRatio: 0.02,
  fullPage: false,
  maskSelectors: [],
  scopeSelector: '',
  settleMs: 150,
  layoutTolerancePx: 2,
};

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeCaptureSettings(input: Partial<CaptureSettings> | undefined): CaptureSettings {
  const d = DEFAULT_CAPTURE_SETTINGS;
  const i = input || {};
  return {
    viewport: {
      width: Math.round(clampNum(i.viewport?.width, 320, 3840, d.viewport.width)),
      height: Math.round(clampNum(i.viewport?.height, 320, 2160, d.viewport.height)),
    },
    pixelThreshold: clampNum(i.pixelThreshold, 0, 1, d.pixelThreshold),
    visualDiffRatio: clampNum(i.visualDiffRatio, 0, 1, d.visualDiffRatio),
    fullPage: typeof i.fullPage === 'boolean' ? i.fullPage : d.fullPage,
    maskSelectors: Array.isArray(i.maskSelectors)
      ? i.maskSelectors.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
      : [],
    scopeSelector: typeof i.scopeSelector === 'string' ? i.scopeSelector.trim() : '',
    settleMs: clampNum(i.settleMs, 0, 10000, d.settleMs),
    layoutTolerancePx: clampNum(i.layoutTolerancePx, 0, 50, d.layoutTolerancePx),
  };
}
