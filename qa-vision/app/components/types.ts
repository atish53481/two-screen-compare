export interface AiInfo {
  status: 'ok' | 'unavailable' | 'error';
  explanation?: string;
  observedFacts?: string[];
  hypotheses?: string[];
  suggestedInvestigation?: string[];
  proposedClassification?: string;
  error?: string;
}

export interface Finding {
  id: string;
  timestamp: string;
  page: string;
  component: string;
  type: string;
  property?: string;
  devValue: string;
  prodValue: string;
  devSelector?: string;
  prodSelector?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  classification?: string;
  ruleApplied?: string | null;
  occurrences?: number;
  stepIds?: string[];
  devScreenshotPath?: string;
  prodScreenshotPath?: string;
  diffScreenshotPath?: string;
  ai?: AiInfo;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  action: string;
  devResult: string;
  prodResult: string;
  status: 'match' | 'mismatch' | 'skipped' | 'info';
}

export const isExpected = (f: Finding) => f.classification === 'EXPECTED_DIFFERENCE';

export const baseName = (p?: string) => (p ? (p.split(/[\\/]/).pop() as string) : '');

export const evidenceUrl = (sessionId: string, file?: string) =>
  file ? `/api/evidence?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(baseName(file))}` : '';

export const jsonHeaders = { 'Content-Type': 'application/json' };

export const SEVERITY_STYLE: Record<string, string> = {
  critical: 'text-red-600 bg-red-100',
  high: 'text-orange-600 bg-orange-100',
  medium: 'text-yellow-600 bg-yellow-100',
  low: 'text-blue-600 bg-blue-100',
};

export const EXPORT_FORMATS = ['pdf', 'html', 'json', 'xlsx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** POST /api/report for a session or a stored run and hand the file to the browser. */
export async function downloadReport(format: ExportFormat, ref: { sessionId?: string; runId?: string }): Promise<string> {
  const res = await fetch('/api/report', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ format, ...ref }) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Report failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `qa-vision-report.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}
