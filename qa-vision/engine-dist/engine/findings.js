"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprint = fingerprint;
exports.classifyFinding = classifyFinding;
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
