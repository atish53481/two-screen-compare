import type { ReportModel } from './model';

export const CSV_COLUMNS = [
  'id', 'page', 'type', 'component', 'property', 'severity', 'classification', 'confidence', 'ruleApplied',
  'devValue', 'prodValue', 'description', 'devSelector', 'prodSelector', 'occurrences', 'stepIds', 'fingerprint',
] as const;

/** Spreadsheet apps execute cells starting with = + - @ (or tab/CR); neutralise with a leading apostrophe. */
export function guardCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function renderCsv(model: ReportModel): string {
  const rows = model.findings.map((f: any) =>
    CSV_COLUMNS.map((c) => quote(guardCell(Array.isArray(f[c]) ? f[c].join(';') : f[c]))).join(',')
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
