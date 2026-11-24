"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.renderHtml = renderHtml;
exports.loadEvidenceImages = loadEvidenceImages;
function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const e = escapeHtml;
const list = (items) => (items.length ? `<ul>${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>');
const countTable = (rec) => Object.keys(rec).length
    ? `<table><tr><th>Name</th><th>Count</th></tr>${Object.entries(rec).map(([k, v]) => `<tr><td>${e(k)}</td><td>${e(v)}</td></tr>`).join('')}</table>`
    : '<p class="muted">None.</p>';
const findingRows = (fs) => fs.length
    ? `<table><tr><th>Page</th><th>Type</th><th>Component</th><th>Severity</th><th>DEV</th><th>PROD</th><th>Details</th></tr>${fs
        .map((f) => `<tr><td>${e(f.page)}</td><td>${e(f.type)}</td><td>${e(f.component)}</td><td>${e(f.severity)}</td><td>${e(f.devValue)}</td><td>${e(f.prodValue)}</td><td>${e(f.description)}${f.ruleApplied ? ` <em>(rule: ${e(f.ruleApplied)})</em>` : ''}</td></tr>`)
        .join('')}</table>`
    : '<p class="muted">None.</p>';
/** One self-contained file: inline CSS, screenshots as data: URIs from `images` (file name -> base64 PNG). */
function renderHtml(model, images) {
    const { meta, summary, findings } = model;
    const img = (name, label) => name && images.has(name)
        ? `<figure><img alt="${e(label)}" src="data:image/png;base64,${e(images.get(name))}"><figcaption>${e(label)}: ${e(name)}</figcaption></figure>`
        : '';
    const ai = findings
        .filter((f) => f.ai && f.ai.status === 'ok')
        .map((f) => {
        const a = f.ai;
        return `<div class="card"><h3>${e(f.type)} - ${e(f.component)}</h3><p>${e(a.explanation)}</p>
<h4>Observed facts</h4>${list(a.observedFacts || [])}<h4>Hypotheses</h4>${list(a.hypotheses || [])}
<h4>Suggested investigation</h4>${list(a.suggestedInvestigation || [])}
<p class="muted">Advisory only (${e(a.provider)} / ${e(a.model)}${a.proposedClassification ? `; proposes ${e(a.proposedClassification)}` : ''}).</p></div>`;
    });
    const evidence = findings
        .filter((f) => f.devScreenshotPath || f.prodScreenshotPath || f.diffScreenshotPath)
        .map((f) => `<div class="card"><h3>${e(f.type)} - ${e(f.component)} <span class="muted">${e(f.id)}</span></h3>${img(f.devScreenshotPath, 'DEV')}${img(f.prodScreenshotPath, 'PROD')}${img(f.diffScreenshotPath, 'Diff')}</div>`);
    const timeline = model.timeline.length
        ? `<table><tr><th>Step</th><th>Action</th><th>DEV</th><th>PROD</th><th>Status</th><th>Findings</th></tr>${model.timeline
            .map((t) => `<tr><td>${e(t.stepId)}</td><td>${e(t.action)}</td><td>${e(t.devResult)}</td><td>${e(t.prodResult)}</td><td>${e(t.status)}</td><td>${e(t.findingIds.join(', '))}</td></tr>`)
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
async function loadEvidenceImages(evidenceDir, model) {
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    const path = await Promise.resolve().then(() => __importStar(require('path')));
    const out = new Map();
    const root = path.resolve(evidenceDir);
    const names = new Set();
    for (const f of model.findings)
        for (const n of [f.devScreenshotPath, f.prodScreenshotPath, f.diffScreenshotPath])
            if (n)
                names.add(n);
    let sharp = null;
    try {
        sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    }
    catch {
        /* embed originals */
    }
    for (const name of names) {
        try {
            const full = path.resolve(root, name);
            if (path.dirname(full) !== root || !fs.existsSync(full))
                continue;
            let bytes = fs.readFileSync(full);
            if (sharp)
                bytes = await sharp(bytes).resize({ width: 1200, withoutEnlargement: true }).png().toBuffer();
            out.set(name, bytes.toString('base64'));
        }
        catch {
            /* missing or unreadable image never fails the report */
        }
    }
    return out;
}
