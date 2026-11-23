import type { ElementSnapshot, FindingDraft, Severity } from './types';
import { STYLE_PROPS } from './extract';

const MEDIUM_PROPS = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'display', 'visibility', 'opacity',
]);
const MAX_CSS_PER_ELEMENT = 8;
const MAX_LAYOUT_PER_ELEMENT = 4;
const BOX_FIELDS = ['x', 'y', 'w', 'h'] as const;

function normalize(value: string | undefined): string {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v.replace(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*1(?:\.0+)?\s*\)/g, 'rgb($1, $2, $3)');
}

export function diffCss(
  pairs: Array<[ElementSnapshot, ElementSnapshot]>,
  opts: { layoutTolerancePx: number },
): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const [dev, prod] of pairs) {
    if (!dev.visible || !prod.visible) continue;
    const component = dev.name || dev.key;
    const base = { component, devSelector: dev.selector, prodSelector: prod.selector };

    let css = 0;
    for (const prop of STYLE_PROPS) {
      if (css >= MAX_CSS_PER_ELEMENT) break;
      const dv = normalize(dev.styles[prop]);
      const pv = normalize(prod.styles[prop]);
      if (dv === pv) continue;
      css++;
      out.push({
        ...base,
        type: 'CSS',
        property: prop,
        devValue: dv,
        prodValue: pv,
        severity: MEDIUM_PROPS.has(prop) ? 'medium' : 'low',
        description: `${prop} differs on ${component}: DEV ${dv || '(none)'} vs PROD ${pv || '(none)'}`,
      });
    }

    let layout = 0;
    for (const f of BOX_FIELDS) {
      if (layout >= MAX_LAYOUT_PER_ELEMENT) break;
      const delta = Math.abs(dev.box[f] - prod.box[f]);
      if (delta <= opts.layoutTolerancePx) continue;
      layout++;
      const severity: Severity = delta > 20 ? 'medium' : 'low';
      out.push({
        ...base,
        type: 'Layout',
        property: `box.${f}`,
        devValue: `${dev.box[f]}px`,
        prodValue: `${prod.box[f]}px`,
        severity,
        description: `box.${f} differs on ${component} by ${delta}px`,
      });
    }
  }
  return out;
}
