import type { Finding } from '../types';
import type { ReportModel } from './model';

export function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const e = escapeHtml;
const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>');
const countTable = (rec: Record<string, number>) =>
  Object.keys(rec).length
    ? `<table><tr><th>Name</th><th>Count</th></tr>${Object.entries(rec).map(([k, v]) => `<tr><td>${e(k)}</td><td>${e(v)}</td></tr>`).join('')}</table>`
    : '<p class="muted">None.</p>';
const findingRows = (fs: Finding[]) =>
  fs.length
    ? `<table><tr><th>Page</th><th>Type</th><th>Component</th><th>Severity</th><th>DEV</th><th>PROD</th><th>Details</th></tr>${fs
        .map(
          (f) =>
            `<tr><td>${e(f.page)}</td><td>${e(f.type)}</td><td>${e(f.component)}</td><td>${e(f.severity)}</td><td>${e(f.devValue)}</td><td>${e(f.prodValue)}</td><td>${e(f.description)}${f.ruleApplied ? ` <em>(rule: ${e(f.ruleApplied)})</em>` : ''}</td></tr>`
        )
        .join('')}</table>`
    : '<p class="muted">None.</p>';

/** One self-contained file: inline CSS, screenshots as data: URIs from `images` (file name -> base64 PNG). */
export function renderHtml(model: ReportModel, images: Map<string, string>): string {
  const { meta, summary, findings } = model;
  const img = (name?: string, label?: string) =>
    name && images.has(name)
      ? `<figure><img alt="${e(label)}" src="data:image/png;base64,${e(images.get(name))}"><figcaption>${e(label)}: ${e(name)}</figcaption></figure>`
      : '';

  const ai = findings
    .filter((f) => f.ai && f.ai.status === 'ok')
    .map((f) => {
      const a = f.ai!;
      return `<div class="card"><h3>${e(f.type)} - ${e(f.component)}</h3><p>${e(a.explanation)}</p>
<h4>Observed facts</h4>${list(a.observedFacts || [])}<h4>Hypotheses</h4>${list(a.hypotheses || [])}
<h4>Suggested investigation</h4>${list(a.suggestedInvestigation || [])}
<p class="muted">Advisory only (${e(a.provider)} / ${e(a.model)}${a.proposedClassification ? `; proposes ${e(a.proposedClassification)}` : ''}).</p></div>`;
    });

  const evidence = findings
    .filter((f) => f.devScreenshotPath || f.prodScreenshotPath || f.diffScreenshotPath)
    .map(
      (f) =>
        `<div class="card"><h3>${e(f.type)} - ${e(f.component)} <span class="muted">${e(f.id)}</span></h3>${img(f.devScreenshotPath, 'DEV')}${img(f.prodScreenshotPath, 'PROD')}${img(f.diffScreenshotPath, 'Diff')}</div>`
    );

  const timeline = model.timeline.length
    ? `<table><tr><th>Step</th><th>Action</th><th>DEV</th><th>PROD</th><th>Status</th><th>Findings</th></tr>${model.timeline
        .map(
          (t) =>
            `<tr><td>${e(t.stepId)}</td><td>${e(t.action)}</td><td>${e(t.devResult)}</td><td>${e(t.prodResult)}</td><td>${e(t.status)}</td><td>${e(t.findingIds.join(', '))}</td></tr>`
        )
        .join('')}</table>`
    : '<p class="muted">No actions logged.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(meta.projectName)} - QA Vision report</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top;word-break:break-word}
th{background:#f2f4f7}.muted{color:#666}.card{border:1px solid #ddd;border-radius:6px;padding:.5rem 1rem;margin:.75rem 0}
img{max-width:100%;border:1px solid #ccc}figure{margin:.5rem 0}</style></head><body>
<h1>QA Vision report: ${e(meta.projectName)}</h1>
<p class="muted">Run ${e(meta.runId)} | DEV ${e(meta.devUrl)} | PROD ${e(meta.prodUrl)}<br>Started ${e(meta.startedAt)} | Ended ${e(meta.endedAt)} | Generated ${e(meta.generatedAt)}</p>
<h2>Executive summary</h2>
<table><tr><th>Pages tested</th><th>Interactions</th><th>Comparisons</th><th>Findings</th></tr>
<tr><td>${e(summary.pagesTested)}</td><td>${e(summary.interactions)}</td><td>${e(summary.comparisons)}</td><td>${e(summary.totalFindings)}</td></tr></table>
<h2>Severity breakdown</h2>${countTable(summary.bySeverity)}
<h2>Differences by type</h2>${countTable(summary.byType)}${countTable(summary.byClassification)}
<h2>Expected differences</h2>${findingRows(findings.filter((f) => f.classification === 'EXPECTED_DIFFERENCE'))}
<h2>Replay issues</h2>${findingRows(findings.filter((f) => f.classification === 'REPLAY_FAILURE'))}
<h2>Skipped unsafe actions</h2>${findingRows(findings.filter((f) => f.classification === 'SKIPPED_BY_SAFETY_POLICY'))}
<h2>All findings</h2>${findingRows(findings)}
<h2>Timeline</h2>${timeline}
<h2>AI analysis</h2><p class="muted">Observed facts and hypotheses are listed separately. AI output is advisory and never changes a classification.</p>${ai.join('') || '<p class="muted">No AI analysis available.</p>'}
<h2>Evidence</h2>${evidence.join('') || '<p class="muted">No screenshots available.</p>'}
</body></html>
`;
}

/**
 * Reads the named screenshots from `evidenceDir` only (anything resolving outside it, or missing, is skipped)
 * and downscales each to <= 1200 px wide. Returns file name -> base64 PNG.
 */
export async function loadEvidenceImages(evidenceDir: string, model: ReportModel): Promise<Map<string, string>> {
  const fs = await import('fs');
  const path = await import('path');
  const out = new Map<string, string>();
  const root = path.resolve(evidenceDir);
  const names = new Set<string>();
  for (const f of model.findings) for (const n of [f.devScreenshotPath, f.prodScreenshotPath, f.diffScreenshotPath]) if (n) names.add(n);
  let sharp: any = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    /* embed originals */
  }
  for (const name of names) {
    try {
      const full = path.resolve(root, name);
      if (path.dirname(full) !== root || !fs.existsSync(full)) continue;
      let bytes: Buffer = fs.readFileSync(full);
      if (sharp) bytes = await sharp(bytes).resize({ width: 1200, withoutEnlargement: true }).png().toBuffer();
      out.set(name, bytes.toString('base64'));
    } catch {
      /* missing or unreadable image never fails the report */
    }
  }
  return out;
}
