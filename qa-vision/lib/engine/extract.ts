import type { ElementSnapshot, PageSnapshot, TableSnapshot } from './types';

/** Fields whose values must never leave the page (shared with extractPageContent). */
export const SENSITIVE_FIELD_RE = /pass|pwd|secret|token|otp|cvv|cvc|card.?num|cc-|ssn|pin\b/i;

/**
 * Fields that take a one-time code (2-step verification, SMS/email/authenticator codes). Matched against the
 * field's name, id, autocomplete, aria-label, placeholder and label. A code is single-use, so it is never replayed.
 */
export const ONE_TIME_CODE_RE =
  /\b(otp|totp|mfa|2fa)|one.?time|two.?factor|2.?step|passcode|verification.?code|security.?code|authenticat\w*.?code|sms.?code|enter.?(the.?|your.?)?code\b/i;

export const STYLE_PROPS: readonly string[] = [
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'text-decoration-line', 'color', 'background-color', 'border-top-color', 'border-top-width',
  'border-top-style', 'border-radius', 'box-shadow', 'opacity', 'display', 'visibility', 'position',
  'overflow', 'z-index', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'flex-direction', 'justify-content',
  'align-items', 'gap', 'grid-template-columns',
];

export const ATTR_ALLOWLIST: readonly string[] = [
  'type', 'href', 'required', 'maxlength', 'minlength', 'min', 'max', 'pattern', 'placeholder',
  'disabled', 'readonly', 'checked', 'aria-expanded', 'aria-selected', 'aria-checked',
  'aria-disabled', 'aria-invalid', 'aria-required', 'aria-describedby', 'role', 'alt', 'target',
];

export interface ExtractArg {
  scopeSelector: string;
  maxElements: number;
  maxRows: number;
  sensitiveSource: string;
  styleProps: string[];
  attrAllowlist: string[];
}

/**
 * Runs inside the page via page.evaluate: MUST stay self-contained (no imports, no outer
 * references, no constructs that make tsc emit helpers).
 */
export function extractPageSnapshot(arg: ExtractArg): PageSnapshot {
  const sensitiveRe = new RegExp(arg.sensitiveSource, 'i');
  const scope: Element = (arg.scopeSelector && document.querySelector(arg.scopeSelector)) || document.body;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD', 'TEMPLATE', 'TITLE', 'BASE']);
  const INTERACTIVE = 'a,button,input,select,textarea,[role],[tabindex]';
  const CONTENT = 'h1,h2,h3,h4,h5,h6,label,img,th,td,li,p';
  const IMPLICIT_ROLES: Record<string, string> = {
    a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', nav: 'navigation',
    ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell', th: 'columnheader',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    form: 'form', main: 'main', header: 'banner', footer: 'contentinfo', dialog: 'dialog',
  };

  const clip = (s: string, n: number) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const pathOf = (el: Element) => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.tagName !== 'HTML' && parts.length < 7) {
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      let idx = 1;
      if (parent) {
        for (const sib of Array.from(parent.children)) {
          if (sib === cur) break;
          if (sib.tagName === cur.tagName) idx++;
        }
      }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      cur = parent;
    }
    return parts.join(' > ');
  };
  const isSensitive = (el: Element) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const hay = [el.getAttribute('name'), el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-testid')]
      .filter(Boolean)
      .join(' ');
    return type === 'password' || sensitiveRe.test(hay);
  };
  const labelOf = (el: Element) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return clip(aria, 80);
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const lb = clip(ids.map((id) => (document.getElementById(id) ? (document.getElementById(id) as Element).textContent || '' : '')).join(' '), 80);
    if (lb) return lb;
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) return clip(labels[0].textContent || '', 80);
    return '';
  };
  const keyOf = (testId: string, elementId: string, role: string, name: string, path: string) =>
    testId ? 'tid:' + testId : elementId ? 'id:' + elementId : role && name ? 'rn:' + role + '|' + name : 'path:' + path;
  const selectorOf = (testId: string, elementId: string, path: string) => {
    try {
      if (testId) {
        const s = '[data-testid="' + testId.replace(/"/g, '\\"') + '"]';
        if (document.querySelectorAll(s).length === 1) return s;
      }
      if (elementId) {
        const s = '#' + CSS.escape(elementId);
        if (document.querySelectorAll(s).length === 1) return s;
      }
    } catch (e) {
      // fall through to path
    }
    return path;
  };

  // Bucket by priority (keeping document order), then cap.
  const all = Array.from(scope.querySelectorAll('*')).filter((el) => !SKIP.has(el.tagName));
  const order = new Map<Element, number>();
  all.forEach((el, i) => order.set(el, i));
  const buckets: Element[][] = [[], [], [], []];
  for (const el of all) {
    if (el.hasAttribute('data-testid')) buckets[0].push(el);
    else if (el.matches(INTERACTIVE)) buckets[1].push(el);
    else if (el.matches(CONTENT)) buckets[2].push(el);
    else buckets[3].push(el);
  }
  const ranked = buckets.flat();
  const truncated = ranked.length > arg.maxElements;
  const chosen = ranked.slice(0, arg.maxElements).sort((a, b) => (order.get(a) as number) - (order.get(b) as number));

  const elements: ElementSnapshot[] = chosen.map((el) => {
    const tag = el.tagName.toLowerCase();
    const testId = el.getAttribute('data-testid') || '';
    const elementId = el.id || '';
    const role = el.getAttribute('role') || IMPLICIT_ROLES[tag] || '';
    const sensitive = isSensitive(el);
    const label = labelOf(el);
    const innerText = clip((el as HTMLElement).innerText || el.textContent || '', 200);
    const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
    const alt = el.getAttribute('alt');
    const name = clip(label || alt || el.getAttribute('title') || (isField ? '' : innerText), 80);
    let text = innerText;
    if (isField) {
      const v = (el as HTMLInputElement).value || '';
      text = sensitive ? (v ? '[redacted]' : '') : clip(v, 200);
    }
    const rect = el.getBoundingClientRect();
    const box = {
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
    const hasArea = rect.width * rect.height > 0;
    const cv = (el as Element & { checkVisibility?: () => boolean }).checkVisibility;
    const visible = (cv ? cv.call(el) : true) && hasArea;
    const enabled = !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true';
    const cs = getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const p of arg.styleProps) styles[p] = cs.getPropertyValue(p);
    const attrs: Record<string, string> = {};
    for (const a of arg.attrAllowlist) {
      if (!el.hasAttribute(a)) continue;
      let v = el.getAttribute(a) || '';
      if (a === 'href') {
        try {
          v = new URL(v, document.baseURI).pathname;
        } catch (e) {
          v = v.split(/[?#]/)[0];
        }
      }
      attrs[a] = v;
    }
    const tabIndex = (el as HTMLElement).tabIndex;
    const path = pathOf(el);
    return {
      key: keyOf(testId, elementId, role, name, path),
      selector: selectorOf(testId, elementId, path),
      path,
      tag,
      testId,
      elementId,
      role,
      name,
      text,
      visible,
      enabled,
      box,
      styles,
      attrs,
      a11y: { label, alt, ariaHidden: el.getAttribute('aria-hidden') === 'true', tabIndex, focusable: tabIndex >= 0 && enabled },
      order: order.get(el) as number,
    };
  });

  const tables: TableSnapshot[] = Array.from(scope.querySelectorAll('table'))
    .slice(0, 20)
    .map((t) => {
      const trs = Array.from(t.querySelectorAll('tr'));
      const headRow = trs.find((tr) => tr.querySelector('th'));
      const headers = headRow ? Array.from(headRow.children).map((c) => clip(c.textContent || '', 80)) : [];
      const dataRows = trs.filter((tr) => tr !== headRow);
      const testId = t.getAttribute('data-testid') || '';
      const path = pathOf(t);
      return {
        key: keyOf(testId, t.id || '', '', '', path),
        selector: selectorOf(testId, t.id || '', path),
        headers,
        rows: dataRows.slice(0, arg.maxRows).map((tr) => Array.from(tr.children).map((c) => clip(c.textContent || '', 80))),
        rowCount: dataRows.length,
      };
    });

  return { url: location.href, elements, tables, truncated };
}
