import type { ElementSnapshot, FindingDraft, Severity } from './types';

const FORM_FIELDS = new Set(['input', 'select', 'textarea']);
const NO_ALT = '(no alt)';

export function diffA11y(pairs: Array<[ElementSnapshot, ElementSnapshot]>): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const [dev, prod] of pairs) {
    const base = { type: 'Accessibility' as const, component: dev.name || dev.key, devSelector: dev.selector, prodSelector: prod.selector };
    const push = (property: string, devValue: string, prodValue: string, severity: Severity, description: string) =>
      out.push({ ...base, property, devValue, prodValue, severity, description });

    if (dev.role !== prod.role) {
      push('role', dev.role || '(none)', prod.role || '(none)', 'medium', `Role differs: DEV "${dev.role}" vs PROD "${prod.role}"`);
    }
    if (dev.name !== prod.name) {
      push('name', dev.name || '(none)', prod.name || '(none)', 'medium', 'Accessible name differs');
    }
    if (FORM_FIELDS.has(dev.tag) && dev.a11y.label !== prod.a11y.label) {
      const lost = !dev.a11y.label || !prod.a11y.label;
      push('label', dev.a11y.label || '(none)', prod.a11y.label || '(none)', lost ? 'high' : 'medium',
        lost ? 'Form field label present on one side only' : 'Form field label text differs');
    }
    if (dev.tag === 'img' && (dev.a11y.alt === null) !== (prod.a11y.alt === null)) {
      push('alt', dev.a11y.alt ?? NO_ALT, prod.a11y.alt ?? NO_ALT, 'high', 'Image alt attribute missing on one side only');
    }
    if (dev.a11y.ariaHidden !== prod.a11y.ariaHidden) {
      push('aria-hidden', String(dev.a11y.ariaHidden), String(prod.a11y.ariaHidden), 'medium', 'aria-hidden differs');
    }
    if (dev.a11y.focusable !== prod.a11y.focusable) {
      push('focusable', String(dev.a11y.focusable), String(prod.a11y.focusable), 'medium', 'Keyboard focusability differs');
    }
    if (Math.sign(dev.a11y.tabIndex) !== Math.sign(prod.a11y.tabIndex)) {
      push('tabindex', String(dev.a11y.tabIndex), String(prod.a11y.tabIndex), 'low', 'tabindex sign differs');
    }
  }
  return out;
}
