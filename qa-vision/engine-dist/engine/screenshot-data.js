"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normText = normText;
exports.parseNumber = parseNumber;
exports.parseValue = parseValue;
exports.valuesEqual = valuesEqual;
exports.buildRows = buildRows;
exports.diffData = diffData;
// ---------------------------------------------------------------- geometry
function union(rs) {
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y };
}
function median(ns) {
    if (!ns.length)
        return 0;
    const s = [...ns].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}
const xOverlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
const inside = (r, px, py) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
// ---------------------------------------------------------------- text normalization
const CURRENCY = { $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY', rs: 'INR', 'rs.': 'INR' };
const CODES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SGD', 'AED'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function clean(s) {
    return s.normalize('NFKC').replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
}
function normText(s, caseSensitive = false) {
    const t = clean(s).replace(/[.,;:]+$/, '');
    return caseSensitive ? t : t.toLowerCase();
}
/** Parse a localized number: "1,250.50", "1.250,50", "(1,250)", "-12". Returns null when not a number. */
function parseNumber(raw) {
    let s = clean(raw).replace(/\s/g, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) {
        neg = true;
        s = s.slice(1, -1);
    }
    if (/^[-+]/.test(s)) {
        neg = s[0] === '-';
        s = s.slice(1);
    }
    if (!/^\d[\d.,]*$/.test(s) || /[.,]{2}/.test(s))
        return null;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    let n;
    if (lastDot >= 0 && lastComma >= 0) {
        const dec = lastDot > lastComma ? '.' : ',';
        const thou = dec === '.' ? ',' : '.';
        n = Number(s.split(thou).join('').replace(dec, '.'));
    }
    else if (lastComma >= 0) {
        n = /^\d{1,3}(,\d{3})+$/.test(s) ? Number(s.replace(/,/g, '')) : Number(s.replace(',', '.'));
    }
    else if (lastDot >= 0) {
        n = /^\d{1,3}(\.\d{3}){2,}$/.test(s) ? Number(s.replace(/\./g, '')) : Number(s);
    }
    else
        n = Number(s);
    if (!Number.isFinite(n))
        return null;
    return neg ? -n : n;
}
function isoDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200)
        return undefined;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function parseValue(raw) {
    const s = clean(raw);
    if (!s)
        return { type: 'text' };
    // currency: symbol/code before or after the amount
    let m = s.match(/^([$€£₹¥]|rs\.?|[A-Z]{3})\s?([-+(]?[\d][\d.,]*\)?)$/i) || null;
    if (m && (CURRENCY[m[1].toLowerCase()] || CURRENCY[m[1]] || CODES.includes(m[1].toUpperCase()))) {
        const n = parseNumber(m[2]);
        if (n !== null)
            return { type: 'currency', num: n, unit: CURRENCY[m[1]] || CURRENCY[m[1].toLowerCase()] || m[1].toUpperCase() };
    }
    m = s.match(/^([-+(]?[\d][\d.,]*\)?)\s?([$€£₹¥]|[A-Z]{3})$/i);
    if (m && (CURRENCY[m[2]] || CODES.includes(m[2].toUpperCase()))) {
        const n = parseNumber(m[1]);
        if (n !== null)
            return { type: 'currency', num: n, unit: CURRENCY[m[2]] || m[2].toUpperCase() };
    }
    m = s.match(/^([-+]?[\d][\d.,]*)\s?%$/);
    if (m) {
        const n = parseNumber(m[1]);
        if (n !== null)
            return { type: 'percent', num: n };
    }
    const n = parseNumber(s);
    if (n !== null)
        return { type: 'number', num: n };
    // dates
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
    if (m)
        return { type: 'date', iso: isoDate(+m[1], +m[2], +m[3]) };
    m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/);
    if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase()))
        return { type: 'date', iso: isoDate(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]) };
    m = s.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/);
    if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase()))
        return { type: 'date', iso: isoDate(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]) };
    if (/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(s))
        return { type: 'date' }; // day/month order is ambiguous: text compare
    if (/^\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i.test(s))
        return { type: 'date' };
    // identifiers: INV-101, #12345, AB12CD, user_42
    if (/^#\d+$/.test(s) || (/^[A-Za-z][\w-]*\d[\w-]*$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s) && !s.includes(' ')))
        return { type: 'identifier' };
    return { type: 'text' };
}
const NUMERIC = ['number', 'currency', 'percent'];
function valuesEqual(a, b, opts) {
    if (opts.matching === 'strict') {
        const ca = clean(a), cb = clean(b);
        return opts.caseSensitive ? ca === cb : ca.toLowerCase() === cb.toLowerCase();
    }
    const pa = parseValue(a), pb = parseValue(b);
    if (NUMERIC.includes(pa.type) && NUMERIC.includes(pb.type)) {
        if ((pa.type === 'percent') !== (pb.type === 'percent'))
            return false;
        if (pa.unit && pb.unit && pa.unit !== pb.unit)
            return false;
        if ((pa.type === 'currency') !== (pb.type === 'currency') && (pa.unit || pb.unit))
            return false;
        return Math.abs(pa.num - pb.num) <= Math.max(0, opts.numericTolerance) + 1e-9;
    }
    if (pa.type === 'date' && pb.type === 'date' && pa.iso && pb.iso)
        return pa.iso === pb.iso;
    const na = normText(a, opts.caseSensitive), nb = normText(b, opts.caseSensitive);
    if (na === nb)
        return true;
    // OCR word-spacing noise ("AddUser" / "Add User") is not a visible data difference; numbers never get here
    return na.replace(/\s/g, '') === nb.replace(/\s/g, '');
}
// ---------------------------------------------------------------- rows and segments
const LABEL_RE = /^([^\d:]{1,40}?)\s*:\s*(.+)$/;
const hasDigit = (s) => /\d/.test(s);
function makeSeg(words) {
    const text = words.map((w) => w.text).join(' ');
    const m = text.match(LABEL_RE);
    const labeled = m && /\p{L}/u.test(m[1]);
    return {
        text,
        label: labeled ? clean(m[1]) : null,
        value: labeled ? clean(m[2]) : text,
        words,
        bbox: union(words.map((w) => w.bbox)),
        conf: Math.min(...words.map((w) => w.conf)),
        field: null,
        labelOnly: /:$/.test(text) && !hasDigit(text),
    };
}
/** Group OCR lines into visual rows and split rows into cells at wide gaps. */
function buildRows(lines) {
    const allH = median(lines.flatMap((l) => l.words.map((w) => w.bbox.height))) || 10;
    // merge lines at the same height (Tesseract emits separate cards/columns as separate blocks)
    const sorted = lines
        .filter((l) => l.words.length)
        .map((l) => ({ words: [...l.words].sort((a, b) => a.bbox.x - b.bbox.x), box: union(l.words.map((w) => w.bbox)) }))
        .sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2));
    const groups = [];
    for (const l of sorted) {
        const g = groups[groups.length - 1];
        const cy = l.box.y + l.box.height / 2;
        if (g && Math.abs(cy - (g.box.y + g.box.height / 2)) < Math.max(4, Math.min(l.box.height, g.box.height) * 0.45)) {
            g.words.push(...l.words);
            g.box = union([g.box, l.box]);
        }
        else
            groups.push({ words: [...l.words], box: l.box });
    }
    const rows = [];
    for (const g of groups) {
        const words = g.words.sort((a, b) => a.bbox.x - b.bbox.x);
        const h = median(words.map((w) => w.bbox.height)) || allH;
        const segs = [];
        let cur = [words[0]];
        for (let i = 1; i < words.length; i++) {
            const prev = cur[cur.length - 1];
            const gap = words[i].bbox.x - (prev.bbox.x + prev.bbox.width);
            if (gap > Math.max(0.8 * h, 6)) {
                segs.push(makeSeg(cur));
                cur = [words[i]];
            }
            else
                cur.push(words[i]);
        }
        segs.push(makeSeg(cur));
        // "Status:" | "Approved" -> the label cell names the next cell
        for (let i = 0; i < segs.length - 1; i++)
            if (segs[i].labelOnly && !segs[i + 1].label)
                segs[i + 1].label = segs[i].text.replace(/:$/, '').trim();
        rows.push({ segs, bbox: union(segs.map((s) => s.bbox)), key: null });
    }
    // row key: a stable visible identifier, else the first cell (tables and lists)
    for (const r of rows) {
        if (r.segs.length < 2)
            continue;
        const id = r.segs.find((s) => parseValue(s.value).type === 'identifier');
        const first = r.segs[0];
        // numbers/amounts change between environments: never use them as a record key
        r.key = id ? id.value : parseValue(first.value).type === 'text' ? first.value : null;
    }
    assignFields(rows, allH);
    return rows;
}
/** Field name for each cell: own "Label:", else the label/header cell above it in the same visual block. */
function assignFields(rows, lineH) {
    const labelRow = (r) => r.segs.every((s) => !hasDigit(s.text));
    rows.forEach((row, ri) => {
        for (const s of row.segs) {
            if (s.label) {
                s.field = s.label;
                continue;
            }
            let top = row.bbox.y;
            let best = null;
            for (let j = ri - 1; j >= 0; j--) {
                const r = rows[j];
                if (top - (r.bbox.y + r.bbox.height) > 2.5 * lineH)
                    break;
                top = r.bbox.y;
                if (!labelRow(r) || (r.segs.length === 1 && row.segs.length > 1))
                    continue;
                const h = r.segs.find((c) => xOverlap(c.bbox, s.bbox) >= 0.3 * Math.min(c.bbox.width, s.bbox.width));
                if (h)
                    best = h; // keep walking: the topmost label row of the block is the header
            }
            if (best && best !== s)
                s.field = best.text.replace(/:$/, '').trim();
        }
    });
}
// ---------------------------------------------------------------- matching
function ruleMatches(rule, s) {
    if (!s)
        return false;
    const re = rule.match(/^\/(.+)\/([a-z]*)$/);
    if (re) {
        try {
            return new RegExp(re[1], re[2]).test(s);
        }
        catch {
            return false;
        }
    }
    return s.toLowerCase().includes(rule.toLowerCase());
}
function typeOf(seg, row) {
    const t = parseValue(seg.value).type;
    if (t !== 'text')
        return t;
    const short = seg.value.length <= 24 && seg.value.split(' ').length <= 3 && !hasDigit(seg.value);
    const isValue = !!seg.label || (!!seg.field && seg.field !== seg.text) || (row.segs.length > 1 && row.segs[0] !== seg);
    return short && isValue ? 'status' : 'text';
}
const TYPE_LABEL = {
    number: 'number', currency: 'amount', percent: 'percentage', date: 'date/time', identifier: 'identifier', status: 'status', text: 'text',
};
function diffData(input) {
    const { opts } = input;
    const noise = input.pixelUnchanged || (() => false);
    const ignoredByRegion = new Array(Math.max(input.ignoreDev?.length || 0, input.ignoreProd?.length || 0)).fill(0);
    const prepare = (side, regions) => {
        const lines = side.lines
            .map((l) => ({
            words: l.words.filter((w) => {
                const cx = w.bbox.x + w.bbox.width / 2, cy = w.bbox.y + w.bbox.height / 2;
                const k = (regions || []).findIndex((r) => inside(r, cx, cy));
                if (k >= 0) {
                    ignoredByRegion[k]++;
                    return false;
                }
                return true;
            }),
        }))
            .filter((l) => l.words.length);
        return buildRows(lines);
    };
    const devRows0 = prepare(input.dev, input.ignoreDev);
    const prodRows0 = prepare(input.prod, input.ignoreProd);
    // ignored fields
    const rules = (opts.ignoreFields || []).map((r) => r.trim()).filter(Boolean).slice(0, 50);
    const ignoredFields = rules.map((rule) => ({ rule, devItems: [], prodItems: [] }));
    const ignoredBoxes = { dev: [], prod: [] };
    const applyRules = (rows, side) => rows
        .map((r) => {
        const segs = r.segs.filter((s) => {
            const k = rules.findIndex((rule) => ruleMatches(rule, s.text) || ruleMatches(rule, s.label) || ruleMatches(rule, s.field));
            if (k >= 0) {
                ignoredFields[k][side].push(s.text);
                ignoredBoxes[side === 'devItems' ? 'dev' : 'prod'].push(s.bbox);
                return false;
            }
            return true;
        });
        return { ...r, segs, bbox: segs.length ? union(segs.map((s) => s.bbox)) : r.bbox };
    })
        .filter((r) => r.segs.length);
    const devRows = applyRules(devRows0, 'devItems');
    const prodRows = applyRules(prodRows0, 'prodItems');
    const medianConf = (side) => median(side.lines.flatMap((l) => l.words.map((w) => w.conf)));
    const words = (side) => side.lines.reduce((n, l) => n + l.words.length, 0);
    const qd = input.dev.lines.length ? medianConf(input.dev) : 100, qp = input.prod.lines.length ? medianConf(input.prod) : 100;
    const wd = words(input.dev), wp = words(input.prod);
    const quality = {
        dev: qd,
        prod: qp,
        devUnreadable: qd < opts.minConfidence || (wp >= 8 && wd < 0.5 * wp && qd < 85),
        prodUnreadable: qp < opts.minConfidence || (wd >= 8 && wp < 0.5 * wd && qp < 85),
    };
    const anyUnreadable = quality.devUnreadable || quality.prodUnreadable;
    const STRONG = ['number', 'currency', 'percent', 'date', 'identifier'];
    let lowConfFragments = 0;
    const items = [];
    let matched = 0;
    let noiseSuppressed = 0;
    const key = (s) => normText(s.text, opts.caseSensitive);
    // --- row matching by content
    const sim = (a, b) => {
        const bag = new Map();
        for (const s of b.segs)
            bag.set(key(s), (bag.get(key(s)) || 0) + 1);
        let common = 0;
        for (const s of a.segs) {
            const k = key(s), n = bag.get(k) || 0;
            if (n > 0) {
                common++;
                bag.set(k, n - 1);
            }
        }
        let v = (2 * common) / (a.segs.length + b.segs.length);
        if (a.key && b.key && a.segs.length > 1 && b.segs.length > 1) {
            if (normText(a.key) === normText(b.key))
                v = Math.max(v, 0.75);
            else if (parseValue(a.key).type === 'identifier' && parseValue(b.key).type === 'identifier')
                v *= 0.6;
        }
        return v;
    };
    const relY = (r, side) => (r.bbox.y + r.bbox.height / 2) / Math.max(1, side.height);
    const cand = [];
    devRows.forEach((a, i) => prodRows.forEach((b, j) => {
        const s = sim(a, b);
        if (s >= 0.5)
            cand.push({ i, j, s, dy: Math.abs(relY(a, input.dev) - relY(b, input.prod)) });
    }));
    cand.sort((x, y) => y.s - x.s || x.dy - y.dy);
    const mD = new Array(devRows.length).fill(-1), mP = new Array(prodRows.length).fill(-1);
    for (const c of cand)
        if (mD[c.i] < 0 && mP[c.j] < 0) {
            mD[c.i] = c.j;
            mP[c.j] = c.i;
        }
    // --- positional pairing of fully changed rows, only between matched neighbours that keep their order
    for (let i = 0; i < devRows.length;) {
        if (mD[i] >= 0) {
            i++;
            continue;
        }
        let e = i;
        while (e < devRows.length && mD[e] < 0)
            e++;
        const p0 = i > 0 ? mD[i - 1] : -1;
        const p1 = e < devRows.length ? mD[e] : prodRows.length;
        if (p0 < p1) {
            const gapProd = [];
            for (let j = p0 + 1; j < p1; j++)
                if (mP[j] < 0)
                    gapProd.push(j);
            let k = 0;
            for (let d = i; d < e && k < gapProd.length; d++) {
                const j = gapProd[k];
                if (Math.abs(devRows[d].segs.length - prodRows[j].segs.length) <= 1) {
                    mD[d] = j;
                    mP[j] = d;
                    k++;
                }
            }
        }
        i = e;
    }
    const section = (s, r) => [r.key && normText(r.key) !== normText(s.value) ? `Row “${r.key}”` : null, s.field ? `“${s.field}”` : null].filter(Boolean).join(' / ') || null;
    const confOf = (...ss) => Math.min(...ss.map((s) => s.conf)) / 100;
    const single = (s, r, side, record) => {
        const box = record ? r.bbox : s.bbox;
        if (side === 'dev' ? noise(box, null) : noise(null, box)) {
            noiseSuppressed++;
            return;
        }
        const text = record ? r.segs.map((x) => x.text).join(' | ') : s.text;
        const conf = record ? confOf(...r.segs) : confOf(s);
        // "absent on the other side" is only claimed when the other side is readable where the item should be
        const from = side === 'dev' ? input.dev : input.prod, other = side === 'dev' ? input.prod : input.dev;
        const otherUnreadable = side === 'dev' ? quality.prodUnreadable : quality.devUnreadable;
        const sx = other.width / Math.max(1, from.width), sy = other.height / Math.max(1, from.height);
        const m = { x: box.x * sx - 6, y: box.y * sy - 6, width: box.width * sx + 12, height: box.height * sy + 12 };
        const garbledThere = other.lines.some((l) => l.words.some((w) => w.conf < opts.minConfidence && inside(m, w.bbox.x + w.bbox.width / 2, w.bbox.y + w.bbox.height / 2)));
        const lowSelf = conf * 100 < opts.minConfidence;
        const low = lowSelf || otherUnreadable || garbledThere;
        // a tiny, barely legible fragment seen on one side only says nothing either way: count it, don't report it
        if (!record && conf < 0.4 && text.replace(/\s/g, '').length <= 6) {
            lowConfFragments++;
            return;
        }
        const what = record ? `record${r.key ? ` “${r.key}”` : ''}` : `${TYPE_LABEL[typeOf(s, r)]}${s.field ? ` “${s.field}”` : ''}`;
        items.push({
            kind: low ? 'uncertain' : side === 'dev' ? 'extra-in-dev' : 'missing-in-dev',
            valueType: record ? (r.segs.some((x) => hasDigit(x.text)) ? 'identifier' : 'text') : typeOf(s, r),
            field: record ? r.key : s.field,
            section: record ? (r.key ? `Row “${r.key}”` : null) : section(s, r),
            devValue: side === 'dev' ? text : null,
            prodValue: side === 'prod' ? text : null,
            devBox: side === 'dev' ? box : null,
            prodBox: side === 'prod' ? box : null,
            confidence: conf,
            record,
            explanation: lowSelf
                ? `Text read only in ${side === 'dev' ? 'DEV' : 'PROD'} with low OCR confidence (${Math.round(conf * 100)}%): it may be unreadable on the other side rather than absent.`
                : low
                    ? `Read in ${side === 'dev' ? 'DEV' : 'PROD'} (“${text}”), but the ${side === 'dev' ? 'PROD' : 'DEV'} screenshot is unreadable at this position (low OCR confidence), so absence cannot be confirmed.`
                    : side === 'dev'
                        ? `Visible ${what} appears in DEV but no corresponding item was found in PROD.`
                        : `Visible ${what} appears in PROD but no corresponding item was found in DEV.`,
        });
    };
    // --- cell comparison inside matched rows
    devRows.forEach((dr, i) => {
        const j = mD[i];
        if (j < 0)
            return;
        const pr = prodRows[j];
        const A = dr.segs, B = pr.segs;
        const eq = (a, b) => valuesEqual(a.text, b.text, opts) || (!!a.label && a.label === b.label && valuesEqual(a.value, b.value, opts));
        // LCS
        const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
        for (let x = A.length - 1; x >= 0; x--)
            for (let y = B.length - 1; y >= 0; y--)
                L[x][y] = eq(A[x], B[y]) ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
        const anchors = [];
        for (let x = 0, y = 0; x < A.length && y < B.length;) {
            if (eq(A[x], B[y])) {
                anchors.push([x, y]);
                x++;
                y++;
            }
            else if (L[x + 1][y] >= L[x][y + 1])
                x++;
            else
                y++;
        }
        matched += anchors.length;
        const bounds = [[-1, -1], ...anchors, [A.length, B.length]];
        for (let k = 0; k < bounds.length - 1; k++) {
            const as = A.slice(bounds[k][0] + 1, bounds[k + 1][0]);
            const bs = B.slice(bounds[k][1] + 1, bounds[k + 1][1]);
            const usedB = new Set();
            const pairs = [];
            const leftA = [];
            const cx = (s, side) => (s.bbox.x + s.bbox.width / 2) / Math.max(1, side.width);
            if (as.length === bs.length) {
                // same number of differing cells between two equal anchors: same columns, pair in order
                as.forEach((a, n) => { usedB.add(bs[n]); pairs.push([a, bs[n]]); });
            }
            else {
                for (const a of as) {
                    const free = bs.filter((b) => !usedB.has(b));
                    let b = a.field ? free.find((c) => c.field && normText(c.field) === normText(a.field)) : undefined;
                    if (!b) {
                        const near = free.map((c) => ({ c, d: Math.abs(cx(a, input.dev) - cx(c, input.prod)) })).sort((p, q) => p.d - q.d)[0];
                        if (near && near.d < 0.15)
                            b = near.c;
                    }
                    if (b) {
                        usedB.add(b);
                        pairs.push([a, b]);
                    }
                    else
                        leftA.push(a);
                }
            }
            for (const [a, b] of pairs) {
                if (noise(a.bbox, b.bbox)) {
                    noiseSuppressed++;
                    matched++;
                    continue;
                }
                const sameLabel = !!a.label && !!b.label && normText(a.label) === normText(b.label);
                const dv = sameLabel ? a.value : a.text, pv = sameLabel ? b.value : b.text;
                const conf = confOf(a, b);
                const tP = typeOf(b, pr), tD = typeOf(a, dr);
                const vt = tP !== 'text' ? tP : tD;
                // a number/amount/date/ID on one side read as letters without digits on the other is far more often an
                // unreadable value than a real change: never claim it as a mismatch
                const typeClash = STRONG.includes(tP) !== STRONG.includes(tD) && (!hasDigit(dv) || !hasDigit(pv));
                const lowConf = conf * 100 < opts.minConfidence;
                const low = lowConf || anyUnreadable || typeClash;
                const field = a.field || b.field || (sameLabel ? a.label : null);
                items.push({
                    kind: low ? 'uncertain' : 'mismatch',
                    valueType: vt,
                    field,
                    section: section(b, pr) || section(a, dr),
                    devValue: dv,
                    prodValue: pv,
                    devBox: a.bbox,
                    prodBox: b.bbox,
                    confidence: conf,
                    record: false,
                    explanation: lowConf
                        ? `Low OCR confidence (${Math.round(conf * 100)}%): DEV reads “${dv}”, PROD reads “${pv}”. Verify visually before treating it as a mismatch.`
                        : typeClash
                            ? `${STRONG.includes(tP) ? `PROD shows a ${TYPE_LABEL[tP]} (“${pv}”) but DEV reads “${dv}”` : `DEV shows a ${TYPE_LABEL[tD]} (“${dv}”) but PROD reads “${pv}”`}, which does not look like one: probably unreadable or a different format. Verify visually.`
                            : low
                                ? `DEV reads “${dv}”, PROD reads “${pv}”, but one screenshot is largely unreadable, so this is not claimed as a mismatch. Verify visually.`
                                : `Visible ${TYPE_LABEL[vt]}${field ? ` for “${field}”` : ''} differs: PROD shows “${pv}”, DEV shows “${dv}”.`,
                });
            }
            for (const a of leftA)
                single(a, dr, 'dev', false);
            for (const b of bs)
                if (!usedB.has(b))
                    single(b, pr, 'prod', false);
        }
    });
    devRows.forEach((r, i) => { if (mD[i] < 0)
        single(r.segs[0], r, 'dev', r.segs.length > 1); });
    prodRows.forEach((r, j) => { if (mP[j] < 0)
        single(r.segs[0], r, 'prod', r.segs.length > 1); });
    return {
        items,
        matched,
        noiseSuppressed,
        devItems: devRows.reduce((s, r) => s + r.segs.length, 0),
        prodItems: prodRows.reduce((s, r) => s + r.segs.length, 0),
        ignoredFields, // every rule is logged, including rules that matched nothing
        ignoredByRegion,
        ignoredBoxes,
        quality,
        lowConfFragments,
        devSegs: devRows.flatMap((r) => r.segs),
        prodSegs: prodRows.flatMap((r) => r.segs),
    };
}
