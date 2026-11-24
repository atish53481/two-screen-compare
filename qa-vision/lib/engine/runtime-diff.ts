import { SENSITIVE_FIELD_RE } from './extract';
import type { FindingDraft, NetworkEntry, RuntimeEvent } from './types';

export const LOG_CAP = 500;
export const EXTRA_SENSITIVE_RE = /^(authorization|cookie|set-cookie|api-?key|x-api-key|session|sid)$/i;
const BLOCKED = 'net::ERR_BLOCKED_BY_CLIENT';
const COUNTED = new Set(['xhr', 'fetch', 'document']);

export function toNetworkPath(url: string): string {
  let pathname = url;
  let search = '';
  try {
    const u = new URL(url);
    pathname = u.pathname;
    search = u.search;
  } catch {
    const noHash = url.split('#')[0];
    const i = noHash.indexOf('?');
    pathname = i >= 0 ? noHash.slice(0, i) : noHash;
    search = i >= 0 ? noHash.slice(i) : '';
  }
  const keys = [...new Set(Array.from(new URLSearchParams(search).keys()))].sort();
  return keys.length ? `${pathname}?${keys.join('&')}` : pathname;
}

export function schemaOf(json: unknown, depth = 2): string[] {
  const out: string[] = [];
  const walk = (v: unknown, prefix: string, d: number) => {
    if (d > depth || v === null || typeof v !== 'object') return;
    const node = Array.isArray(v) ? v[0] : v;
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    for (const k of Object.keys(node as object)) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(p);
      walk((node as Record<string, unknown>)[k], p, d + 1);
    }
  };
  walk(json, '', 1);
  return [...new Set(out)].sort();
}

export interface RawResponse {
  method: string;
  url: string;
  status: number | null;
  resourceType: string;
  contentType?: string;
  json?: unknown;
  failure?: string | null;
}

/** Builds a NetworkEntry from raw response facts. Keeps key names only; never bodies or query values. */
export function toNetworkEntry(r: RawResponse): NetworkEntry {
  return {
    method: r.method.toUpperCase(),
    path: toNetworkPath(r.url),
    status: r.status,
    resourceType: r.resourceType,
    contentType: (r.contentType || '').split(';')[0].trim().toLowerCase(),
    schema: r.json !== undefined ? schemaOf(r.json) : null,
    failure: r.failure ?? null,
  };
}

/** Redacts secrets from free text: URL query/fragment, Bearer/Basic credentials, values of sensitive keys. No length cap. */
export function redactSecrets(text: string, sensitiveRe: RegExp = SENSITIVE_FIELD_RE): string {
  let t = String(text ?? '').replace(/https?:\/\/[^\s'"<>)]+/g, (m) => {
    const i = m.search(/[?#]/);
    return i >= 0 ? m.slice(0, i) : m;
  });
  t = t.replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [redacted]');
  t = t.replace(/([\w.-]+)["']?\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;&}]+)/g, (m, k, sep) =>
    sensitiveRe.test(k) || EXTRA_SENSITIVE_RE.test(k) ? `${k}${sep}[redacted]` : m);
  return t;
}

/** Redacts and bounds console/page-error text. */
export function toRuntimeText(text: string): string {
  return redactSecrets(text).slice(0, 300);
}

export function pushCapped<T>(arr: T[], item: T, cap = LOG_CAP): void {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function draft(component: string, devValue: string, prodValue: string, severity: 'high' | 'medium', description: string, type: 'Network' | 'Console'): FindingDraft {
  return { type, component, devValue, prodValue, severity, description } as FindingDraft;
}

export function diffNetwork(dev: NetworkEntry[], prod: NetworkEntry[]): FindingDraft[] {
  const keep = (e: NetworkEntry) => COUNTED.has(e.resourceType) && e.failure !== BLOCKED;
  const index = (list: NetworkEntry[]) => {
    const m = new Map<string, NetworkEntry>();
    for (const e of list.filter(keep)) m.set(`${e.method} ${e.path}`, e);
    return m;
  };
  const blockedKeys = new Set(prod.filter((e) => e.failure === BLOCKED).map((e) => `${e.method} ${e.path}`));
  const d = index(dev);
  for (const k of blockedKeys) d.delete(k); // the guard blocked it on PROD; Safety findings cover it
  const p = index(prod);
  const out: FindingDraft[] = [];
  for (const [key, de] of d) {
    const pe = p.get(key);
    if (!pe) {
      out.push(draft(key, `${de.status ?? de.failure ?? 'seen'}`, 'not requested', 'medium', `Request ${key} happened only on DEV`, 'Network'));
      continue;
    }
    if (de.status !== pe.status) {
      const bad = (de.status ?? 0) >= 400 || (pe.status ?? 0) >= 400;
      out.push(draft(key, String(de.status ?? de.failure), String(pe.status ?? pe.failure), bad ? 'high' : 'medium', `Status differs for ${key}`, 'Network'));
    }
    if (de.schema && pe.schema) {
      const ds = new Set(de.schema);
      const ps = new Set(pe.schema);
      const missingProd = de.schema.filter((k) => !ps.has(k));
      const missingDev = pe.schema.filter((k) => !ds.has(k));
      if (missingProd.length || missingDev.length) {
        out.push(draft(key, de.schema.join(','), pe.schema.join(','), 'medium',
          `Response shape differs for ${key}` +
          (missingProd.length ? `; missing on PROD: ${missingProd.join(', ')}` : '') +
          (missingDev.length ? `; missing on DEV: ${missingDev.join(', ')}` : ''), 'Network'));
      }
    }
  }
  for (const [key, pe] of p) {
    if (!d.has(key)) out.push(draft(key, 'not requested', `${pe.status ?? pe.failure ?? 'seen'}`, 'medium', `Request ${key} happened only on PROD`, 'Network'));
  }
  return out;
}

export function diffRuntime(dev: RuntimeEvent[], prod: RuntimeEvent[]): FindingDraft[] {
  const norm = (e: RuntimeEvent) => `${e.kind}|${e.text.replace(/\d+/g, '<N>')}`;
  const d = new Map(dev.map((e) => [norm(e), e]));
  const p = new Map(prod.map((e) => [norm(e), e]));
  const out: FindingDraft[] = [];
  const sev = (e: RuntimeEvent) => (e.kind === 'page-error' ? 'high' : 'medium') as 'high' | 'medium';
  for (const [k, e] of d) if (!p.has(k)) out.push(draft(e.kind, e.text, '', sev(e), `${e.kind} only on DEV`, 'Console'));
  for (const [k, e] of p) if (!d.has(k)) out.push(draft(e.kind, '', e.text, sev(e), `${e.kind} only on PROD`, 'Console'));
  return out;
}
