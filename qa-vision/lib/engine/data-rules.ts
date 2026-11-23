import type { DataRule, ElementSnapshot, FindingDraft, TableSnapshot } from './types';

const MAX_CELL_FINDINGS = 20;
const EMPTY_TOKENS = new Set(['', 'null', 'undefined', 'n/a', '—', '–', '-']);

/** Parse "$1,250.50", "1.2M", "3k", "(42)", "12%" into a number; null when not numeric. */
export function parseNumber(s: string): number | null {
  let t = String(s ?? '').trim();
  if (!t) return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(t);
  if (paren) {
    negative = true;
    t = paren[1].trim();
  }
  t = t.replace(/^[$€£¥]/, '').replace(/,/g, '').trim();
  const m = /^(-?\d+(?:\.\d+)?|-?\.\d+)\s*([kKmMbB%])?$/.exec(t);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const mult: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
  const suffix = (m[2] || '').toLowerCase();
  if (mult[suffix]) n *= mult[suffix];
  return negative ? -n : n;
}

function dayOf(s: string): string | null {
  const text = s.trim();
  const t = Date.parse(text);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  // Date-only ISO strings parse as UTC; other formats as local time.
  const utc = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const mo = utc ? d.getUTCMonth() : d.getMonth();
  const da = utc ? d.getUTCDate() : d.getDate();
  return `${y}-${mo + 1}-${da}`;
}

function evaluate(dev: string, prod: string, rule: DataRule): { match: boolean; detail: string } {
  const tol = rule.tolerance ?? 0;
  switch (rule.mode) {
    case 'ignore':
      return { match: true, detail: 'ignored' };
    case 'case-insensitive':
      return { match: dev.toLowerCase() === prod.toLowerCase(), detail: 'case-insensitive compare' };
    case 'null-equals-empty': {
      const norm = (v: string) => {
        const x = v.trim().toLowerCase();
        return EMPTY_TOKENS.has(x) ? '' : x;
      };
      return { match: norm(dev) === norm(prod), detail: 'null/empty treated as equal' };
    }
    case 'date': {
      const a = dayOf(dev);
      const b = dayOf(prod);
      if (a === null || b === null) return { match: false, detail: 'not a date' };
      return { match: a === b, detail: a === b ? 'same day' : `${a} ≠ ${b}` };
    }
    case 'numeric':
    case 'tolerance':
    case 'percent': {
      const a = parseNumber(dev);
      const b = parseNumber(prod);
      if (a === null || b === null) return { match: false, detail: 'not numeric' };
      const delta = Math.abs(a - b);
      if (rule.mode === 'numeric') return { match: delta === 0, detail: `Δ ${delta}` };
      if (rule.mode === 'tolerance') {
        return { match: delta <= tol, detail: delta <= tol ? `Δ ${delta} ≤ ${tol}` : `Δ ${delta} > ${tol}` };
      }
      const base = Math.abs(a);
      const pct = base === 0 ? (delta === 0 ? 0 : Infinity) : (delta / base) * 100;
      const shown = Number.isFinite(pct) ? Math.round(pct * 100) / 100 : pct;
      return { match: pct <= tol, detail: pct <= tol ? `Δ ${shown}% ≤ ${tol}%` : `Δ ${shown}% > ${tol}%` };
    }
    case 'exact':
    default:
      return { match: dev === prod, detail: 'exact compare' };
  }
}

export function compareValues(dev: string, prod: string, rule: DataRule): { match: boolean; detail: string } {
  const r = evaluate(String(dev ?? ''), String(prod ?? ''), rule);
  if (rule.expect === 'different') {
    return { match: !r.match, detail: r.match ? 'expected different but values match' : r.detail };
  }
  return r;
}

/** "table:<key>:<header>" split on the LAST colon so keys may contain ':'. */
function parseTableTarget(target: string): { key: string; header: string } | null {
  if (!target.startsWith('table:')) return null;
  const rest = target.slice('table:'.length);
  const i = rest.lastIndexOf(':');
  if (i <= 0) return null;
  return { key: rest.slice(0, i), header: rest.slice(i + 1) };
}

export function diffData(
  pairs: Array<[ElementSnapshot, ElementSnapshot]>,
  tablesDev: TableSnapshot[],
  tablesProd: TableSnapshot[],
  rules: DataRule[],
): FindingDraft[] {
  const out: FindingDraft[] = [];
  const ruleLabel = (r: DataRule) => `${r.target}/${r.mode}`;

  const elementRules = new Map<string, DataRule>();
  const tableRules = new Map<string, Map<string, DataRule>>();
  for (const r of rules) {
    const t = parseTableTarget(r.target);
    if (t) {
      if (!tableRules.has(t.key)) tableRules.set(t.key, new Map());
      tableRules.get(t.key)!.set(t.header, r);
    } else elementRules.set(r.target, r);
  }

  for (const [dev, prod] of pairs) {
    const rule = elementRules.get(dev.key);
    if (!rule || rule.mode === 'ignore') continue;
    const res = compareValues(dev.text, prod.text, rule);
    if (res.match) continue;
    out.push({
      type: 'Data',
      component: dev.key,
      devValue: dev.text,
      prodValue: prod.text,
      severity: 'medium',
      description: `Data differs for ${dev.key} (${rule.mode}): ${res.detail}`,
      devSelector: dev.selector,
      prodSelector: prod.selector,
      ruleApplied: ruleLabel(rule),
    });
  }

  const prodByKey = new Map(tablesProd.map((t) => [t.key, t]));
  for (const dt of tablesDev) {
    const hr = tableRules.get(dt.key);
    const pt = prodByKey.get(dt.key);
    if (!hr || !pt) continue;

    const active = [...hr.values()].filter((r) => r.mode !== 'ignore');
    if (active.length === 0) continue;

    const base = { type: 'Data' as const, devSelector: dt.selector, prodSelector: pt.selector };
    if (dt.rowCount !== pt.rowCount) {
      const star = hr.get('*');
      out.push({
        ...base,
        component: dt.key,
        devValue: String(dt.rowCount),
        prodValue: String(pt.rowCount),
        severity: 'high',
        description: `Row count differs in table ${dt.key}: DEV ${dt.rowCount}, PROD ${pt.rowCount}`,
        ruleApplied: ruleLabel(star && star.mode !== 'ignore' ? star : active[0]),
      });
    }

    const rows = Math.min(dt.rows.length, pt.rows.length);
    let cells = 0;
    for (let c = 0; c < dt.headers.length && cells < MAX_CELL_FINDINGS; c++) {
      const header = dt.headers[c];
      const rule = hr.get(header) ?? hr.get('*');
      if (!rule || rule.mode === 'ignore') continue;
      const pc = pt.headers.indexOf(header);
      if (pc < 0) {
        out.push({
          ...base,
          component: `${dt.key} / ${header}`,
          devValue: header,
          prodValue: '(column missing)',
          severity: 'medium',
          description: `Column "${header}" missing in PROD table ${dt.key}`,
          ruleApplied: ruleLabel(rule),
        });
        cells++;
        continue;
      }
      for (let r = 0; r < rows && cells < MAX_CELL_FINDINGS; r++) {
        const dv = dt.rows[r][c] ?? '';
        const pv = pt.rows[r][pc] ?? '';
        const res = compareValues(dv, pv, rule);
        if (res.match) continue;
        out.push({
          ...base,
          component: `${dt.key} / ${header} / row ${r + 1}`,
          devValue: dv,
          prodValue: pv,
          severity: 'medium',
          description: `Cell differs in ${dt.key} "${header}" row ${r + 1} (${rule.mode}): ${res.detail}`,
          ruleApplied: ruleLabel(rule),
        });
        cells++;
      }
    }
  }
  return out;
}
