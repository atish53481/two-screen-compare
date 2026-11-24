"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSV_COLUMNS = void 0;
exports.guardCell = guardCell;
exports.renderCsv = renderCsv;
exports.CSV_COLUMNS = [
    'id', 'page', 'type', 'component', 'property', 'severity', 'classification', 'confidence', 'ruleApplied',
    'devValue', 'prodValue', 'description', 'devSelector', 'prodSelector', 'occurrences', 'stepIds', 'fingerprint',
];
/** Spreadsheet apps execute cells starting with = + - @ (or tab/CR); neutralise with a leading apostrophe. */
function guardCell(v) {
    const s = v == null ? '' : String(v);
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const quote = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
function renderCsv(model) {
    const rows = model.findings.map((f) => exports.CSV_COLUMNS.map((c) => quote(guardCell(Array.isArray(f[c]) ? f[c].join(';') : f[c]))).join(','));
    return [exports.CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
