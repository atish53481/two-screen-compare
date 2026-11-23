import type { Category, Classification, FindingDraft } from './types';

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
