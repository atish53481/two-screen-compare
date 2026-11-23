import type { ElementSnapshot, FindingDraft, Severity } from './types';

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'combobox', 'textbox', 'tab', 'menuitem']);
const HIGH_ATTRS = new Set(['type', 'required', 'disabled']);
const MAX_ORDER_FINDINGS = 10;

function isInteractive(e: ElementSnapshot): boolean {
  return INTERACTIVE_TAGS.has(e.tag) || INTERACTIVE_ROLES.has(e.role);
}

/** Pair elements by key; duplicate keys pair k-th DEV occurrence with k-th PROD occurrence (by `order`). */
export function pairElements(
  dev: ElementSnapshot[],
  prod: ElementSnapshot[],
): { pairs: Array<[ElementSnapshot, ElementSnapshot]>; devOnly: ElementSnapshot[]; prodOnly: ElementSnapshot[] } {
  const group = (list: ElementSnapshot[]) => {
    const m = new Map<string, ElementSnapshot[]>();
    for (const e of [...list].sort((a, b) => a.order - b.order)) {
      const g = m.get(e.key);
      if (g) g.push(e);
      else m.set(e.key, [e]);
    }
    return m;
  };
  const d = group(dev);
  const p = group(prod);
  const pairs: Array<[ElementSnapshot, ElementSnapshot]> = [];
  const devOnly: ElementSnapshot[] = [];
  const prodOnly: ElementSnapshot[] = [];
  for (const [key, ds] of d) {
    const ps = p.get(key) || [];
    const n = Math.min(ds.length, ps.length);
    for (let i = 0; i < n; i++) pairs.push([ds[i], ps[i]]);
    devOnly.push(...ds.slice(n));
    prodOnly.push(...ps.slice(n));
  }
  for (const [key, ps] of p) if (!d.has(key)) prodOnly.push(...ps);
  pairs.sort((a, b) => a[0].order - b[0].order);
  devOnly.sort((a, b) => a.order - b.order);
  prodOnly.sort((a, b) => a.order - b.order);
  return { pairs, devOnly, prodOnly };
}

/** Indices (into seq) that are NOT part of a longest increasing subsequence. */
function outsideLis(seq: number[]): number[] {
  const n = seq.length;
  const len = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let best = -1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j] < seq[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
    if (best < 0 || len[i] > len[best]) best = i;
  }
  const keep = new Set<number>();
  for (let i = best; i >= 0; i = prev[i]) keep.add(i);
  return seq.map((_, i) => i).filter((i) => !keep.has(i));
}

export function diffDom(dev: ElementSnapshot[], prod: ElementSnapshot[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  const { pairs, devOnly, prodOnly } = pairElements(dev, prod);
  const comp = (e: ElementSnapshot) => e.name || e.key;

  for (const e of devOnly) {
    if (!e.visible) continue;
    out.push({
      type: 'DOM',
      component: comp(e),
      property: 'presence',
      devValue: `<${e.tag}> present`,
      prodValue: '(missing on PROD)',
      severity: isInteractive(e) || e.testId ? 'high' : 'medium',
      description: `Element ${comp(e)} exists on DEV but not on PROD`,
      devSelector: e.selector,
    });
  }
  for (const e of prodOnly) {
    if (!e.visible) continue;
    out.push({
      type: 'DOM',
      component: comp(e),
      property: 'presence',
      devValue: '(missing on DEV)',
      prodValue: `<${e.tag}> present`,
      severity: 'medium',
      description: `Element ${comp(e)} exists on PROD but not on DEV`,
      prodSelector: e.selector,
    });
  }

  const live = pairs.filter(([d, p]) => d.visible || p.visible);
  for (const [d, p] of live) {
    const push = (property: string, devValue: string, prodValue: string, severity: Severity, description: string) =>
      out.push({
        type: 'DOM',
        component: comp(d),
        property,
        devValue,
        prodValue,
        severity,
        description,
        devSelector: d.selector,
        prodSelector: p.selector,
      });
    if (d.tag !== p.tag) push('tag', d.tag, p.tag, 'medium', `Tag of ${comp(d)} differs`);
    if (d.visible !== p.visible)
      push('visibility', d.visible ? 'visible' : 'hidden', p.visible ? 'visible' : 'hidden', 'high', `Visibility of ${comp(d)} differs`);
    if (d.enabled !== p.enabled)
      push('enabled', d.enabled ? 'enabled' : 'disabled', p.enabled ? 'enabled' : 'disabled', 'high', `Enabled state of ${comp(d)} differs`);
    const names = new Set([...Object.keys(d.attrs), ...Object.keys(p.attrs)]);
    for (const name of [...names].sort()) {
      if (name === 'class') continue;
      const dv = d.attrs[name];
      const pv = p.attrs[name];
      if (dv === pv) continue;
      const show = (v: string | undefined) => (v === undefined ? '(absent)' : v === '' ? '(present)' : v);
      push(`attr:${name}`, show(dv), show(pv), HIGH_ATTRS.has(name) ? 'high' : 'medium', `Attribute ${name} of ${comp(d)} differs`);
    }
  }

  // Relative order of paired keys: pairs are sorted by DEV order; find those out of place in PROD order.
  const prodRank = [...live].map(([, p]) => p.order);
  const moved = outsideLis(prodRank).slice(0, MAX_ORDER_FINDINGS);
  for (const i of moved) {
    const [d, p] = live[i];
    out.push({
      type: 'DOM',
      component: comp(d),
      property: 'order',
      devValue: `position ${i + 1} of ${live.length}`,
      prodValue: `position ${[...prodRank].sort((a, b) => a - b).indexOf(p.order) + 1} of ${live.length}`,
      severity: 'low',
      description: `Relative order of ${comp(d)} changed`,
      devSelector: d.selector,
      prodSelector: p.selector,
    });
  }
  return out;
}
