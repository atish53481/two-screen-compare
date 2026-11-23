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
