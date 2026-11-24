"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeUrl = sanitizeUrl;
exports.buildReportModel = buildReportModel;
const runtime_diff_1 = require("../runtime-diff");
const baseName = (p) => typeof p === 'string' && p ? p.split(/[\\/]/).pop() : undefined;
const tally = (values) => {
    const out = {};
    for (const v of values)
        out[v] = (out[v] || 0) + 1;
    return out;
};
/** Strips userinfo, query and fragment from a URL; non-URLs are redacted as text. */
function sanitizeUrl(u) {
    const raw = String(u ?? '');
    try {
        const x = new URL(raw);
        return `${x.origin}${x.pathname}`;
    }
    catch {
        return (0, runtime_diff_1.redactSecrets)(raw);
    }
}
const pathOf = (u) => {
    try {
        return new URL(u).pathname || '/';
    }
    catch {
        return u;
    }
};
function redactAi(ai) {
    if (!ai)
        return ai;
    const arr = (v) => (Array.isArray(v) ? v.map((x) => (0, runtime_diff_1.redactSecrets)(String(x))) : v);
    return {
        ...ai,
        explanation: (0, runtime_diff_1.redactSecrets)(ai.explanation),
        observedFacts: arr(ai.observedFacts),
        hypotheses: arr(ai.hypotheses),
        suggestedInvestigation: arr(ai.suggestedInvestigation),
        additionalTests: arr(ai.additionalTests),
        ...(ai.error ? { error: (0, runtime_diff_1.redactSecrets)(ai.error) } : {}),
    };
}
/** Screenshot references are reduced to file names so no server path can reach an export. */
function sanitizeFinding(f) {
    const out = { ...f };
    for (const k of ['devScreenshotPath', 'prodScreenshotPath', 'diffScreenshotPath']) {
        if (k in out) {
            const b = baseName(out[k]);
            if (b)
                out[k] = b;
            else
                delete out[k];
        }
    }
    if (out.ai)
        out.ai = redactAi(out.ai);
    return out;
}
function buildReportModel(snap) {
    const findings = (snap.mismatches || []).map(sanitizeFinding);
    // Engine logs are newest-first; reports read chronologically.
    const logs = [...(snap.logs || [])].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const count = (c) => findings.filter((f) => f.classification === c).length;
    // Pages actually visited: PROD navigations/resyncs the engine logged, plus pages that produced findings.
    const pages = new Set();
    for (const l of logs) {
        const m = /(?:Navigated PROD to|PROD navigated to|PROD aligned to) (\S+?)\.?(?:\s|$)/.exec(String(l.action));
        if (m)
            pages.add(pathOf(m[1]));
    }
    for (const f of findings)
        if (f.page)
            pages.add(pathOf(f.page));
    const skippedFindings = findings.filter((f) => f.classification === 'SKIPPED_BY_SAFETY_POLICY');
    const skippedActions = logs
        .filter((l) => l.status === 'skipped' || l.prodResult === 'Blocked')
        .map((l) => String(l.action))
        .filter((a) => !skippedFindings.some((f) => [f.component, f.devValue].some((k) => k && a.includes(k))));
    const comparisons = logs.filter((l) => String(l.action).startsWith('Compared after')).length;
    return {
        meta: {
            projectName: snap.projectName,
            devUrl: sanitizeUrl(snap.devUrl),
            prodUrl: sanitizeUrl(snap.prodUrl),
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
            skippedUnsafe: skippedFindings.length + skippedActions.length,
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
        skippedActions,
        findings,
    };
}
