export type Classification =
  | 'MATCH'
  | 'EXPECTED_DIFFERENCE'
  | 'POTENTIAL_DEFECT'
  | 'REPLAY_FAILURE'
  | 'NOT_COMPARABLE'
  | 'SKIPPED_BY_SAFETY_POLICY'
  | 'UNMAPPED_OR_MISSING_FEATURE';

export type Category =
  | 'Text'
  | 'Visual'
  | 'DOM'
  | 'CSS'
  | 'Layout'
  | 'Accessibility'
  | 'Data'
  | 'Network'
  | 'Console'
  | 'Interaction'
  | 'Safety'
  | 'Navigation';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** Minimal AI analysis shape; filled in by the AI provider layer later. */
export interface AiAnalysis {
  status: string;
  provider: string;
  model: string;
  explanation: string;
  observedFacts: string[];
  hypotheses: string[];
  suggestedInvestigation: string[];
  additionalTests: string[];
  proposedClassification?: Classification;
  confidence?: number;
  error?: string;
  generatedAt: string;
}

export interface FindingDraft {
  type: Category;
  component: string;
  devValue: string;
  prodValue: string;
  severity: Severity;
  description: string;
  classification?: Classification;
  confidence?: number;
  property?: string;
  devSelector?: string;
  prodSelector?: string;
  ruleApplied?: string | null;
}

export interface Finding extends FindingDraft {
  id: string;
  timestamp: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  page: string;
  fingerprint: string;
  stepIds?: string[];
  classification: Classification;
  confidence: number;
  ai?: AiAnalysis;
  devScreenshotPath?: string;
  prodScreenshotPath?: string;
  diffScreenshotPath?: string;
  diffPercent?: number;
}

export interface CaptureSettings {
  viewport: { width: number; height: number };
  /** pixelmatch per-pixel threshold, 0..1 */
  pixelThreshold: number;
  /** fraction of differing pixels that becomes a visual finding */
  visualDiffRatio: number;
  fullPage: boolean;
  maskSelectors: string[];
  /** '' = whole page */
  scopeSelector: string;
  settleMs: number;
  layoutTolerancePx: number;
}

// Placeholders: defined fully in later tasks (login, data rules, API and DB checks).
export interface LoginConfig {
  strategy: 'manual' | 'form';
}
export interface DataRule {
  target: string;
  mode: string;
}
export interface ApiCheck {
  name: string;
  path: string;
}
export interface DbCheck {
  name: string;
}
