"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CAPTURE_SETTINGS = void 0;
exports.fingerprint = fingerprint;
exports.classifyFinding = classifyFinding;
exports.normalizeCaptureSettings = normalizeCaptureSettings;
/** Identity of a finding: same page + same kind + same element + same values. */
function fingerprint(page, f) {
    const base = [page, f.type, f.classification || '', String(f.component ?? '')];
    if (f.type === 'Visual') {
        // pixel ratio jitters between captures; bucket to whole percent
        base.push(String(Math.round((Number(f.diffPercent) || 0) * 100)));
    }
    else {
        base.push(String(f.devValue ?? ''), String(f.prodValue ?? ''), f.type === 'Interaction' || f.type === 'Safety' ? String(f.description ?? '') : '');
    }
    if (f.property)
        base.push(f.property);
    return base.join('␟');
}
const HIGH = ['Text', 'DOM', 'Data', 'Network', 'Console'];
const MID = ['CSS', 'Layout', 'Accessibility'];
function classifyFinding(f, expectedFingerprints, fp) {
    if (f.classification)
        return { classification: f.classification, confidence: 1, ruleApplied: null };
    if (expectedFingerprints.has(fp)) {
        return { classification: 'EXPECTED_DIFFERENCE', confidence: 1, ruleApplied: 'expected:' + fp };
    }
    const confidence = HIGH.includes(f.type) ? 0.9 : MID.includes(f.type) ? 0.75 : 0.6;
    return { classification: 'POTENTIAL_DEFECT', confidence, ruleApplied: null };
}
exports.DEFAULT_CAPTURE_SETTINGS = {
    viewport: { width: 1280, height: 800 },
    pixelThreshold: 0.1,
    visualDiffRatio: 0.02,
    fullPage: false,
    maskSelectors: [],
    scopeSelector: '',
    settleMs: 350,
    layoutTolerancePx: 2,
};
function clampNum(v, min, max, fallback) {
    const n = typeof v === 'number' ? v : Number.NaN;
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
function normalizeCaptureSettings(input) {
    const d = exports.DEFAULT_CAPTURE_SETTINGS;
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
