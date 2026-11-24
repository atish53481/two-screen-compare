import type { Finding } from '../types';
import type { SessionSnapshot } from '../../playwright';

export interface ReportModel {
  meta: { projectName: string; devUrl: string; prodUrl: string; runId: string; startedAt: string; endedAt: string; generatedAt: string };
  summary: {
    pagesTested: number;
    interactions: number;
    comparisons: number;
    totalFindings: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    byClassification: Record<string, number>;
    expected: number;
    replayIssues: number;
    skippedUnsafe: number;
  };
  timeline: Array<{ stepId: string; action: string; devResult: string; prodResult: string; status: string; findingIds: string[] }>;
  findings: Finding[];
}

const baseName = (p: unknown): string | undefined =>
  typeof p === 'string' && p ? (p.split(/[\\/]/).pop() as string) : undefined;

const tally = (values: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  return out;
};

/** Screenshot references are reduced to file names so no server path can reach an export. */
function sanitizeFinding(f: any): Finding {
  const out = { ...f };
  for (const k of ['devScreenshotPath', 'prodScreenshotPath', 'diffScreenshotPath']) {
    if (k in out) {
      const b = baseName(out[k]);
      if (b) out[k] = b;
      else delete out[k];
    }
  }
  return out as Finding;
}

export function buildReportModel(snap: SessionSnapshot): ReportModel {
  const findings: Finding[] = (snap.mismatches || []).map(sanitizeFinding);
  // Engine logs are newest-first; reports read chronologically.
  const logs = [...(snap.logs || [])].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const count = (c: string) => findings.filter((f) => f.classification === c).length;
  const pages = new Set(findings.map((f) => f.page).filter(Boolean));
  const comparisons = logs.filter((l) => String(l.action).startsWith('Compared after')).length;

  return {
    meta: {
      projectName: snap.projectName,
      devUrl: snap.devUrl,
      prodUrl: snap.prodUrl,
      runId: snap.id,
      startedAt: snap.startedAt,
      endedAt: snap.endedAt || '',
      generatedAt: new Date().toISOString(),
    },
    summary: {
      pagesTested: pages.size || (comparisons ? 1 : 0),
      interactions: logs.filter((l) => /^\[step-\d+\] Replicating/.test(String(l.action))).length,
      comparisons,
      totalFindings: findings.length,
      bySeverity: tally(findings.map((f) => f.severity)),
      byType: tally(findings.map((f) => f.type)),
      byClassification: tally(findings.map((f) => f.classification)),
      expected: count('EXPECTED_DIFFERENCE'),
      replayIssues: count('REPLAY_FAILURE'),
      skippedUnsafe: count('SKIPPED_BY_SAFETY_POLICY'),
    },
    timeline: logs.map((l) => {
      const stepId = /\[(step-\d+)\]/.exec(String(l.action))?.[1] ?? '';
      return {
        stepId,
        action: String(l.action ?? ''),
        devResult: String(l.devResult ?? ''),
        prodResult: String(l.prodResult ?? ''),
        status: String(l.status ?? ''),
        findingIds: stepId ? findings.filter((f) => f.stepIds?.includes(stepId)).map((f) => f.id) : [],
      };
    }),
    findings,
  };
}
