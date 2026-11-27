"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.comparisonEngine = void 0;
exports.validateTargetUrl = validateTargetUrl;
exports.mergeBaseQuery = mergeBaseQuery;
exports.mapDevUrlToProd = mapDevUrlToProd;
exports.onSharedOutsideHost = onSharedOutsideHost;
exports.urlForAddressBar = urlForAddressBar;
exports.compileIgnoreRules = compileIgnoreRules;
exports.persistLiveSessions = persistLiveSessions;
const playwright_1 = require("playwright");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const findings_1 = require("./engine/findings");
const extract_1 = require("./engine/extract");
const dom_diff_1 = require("./engine/dom-diff");
const pixel_diff_1 = require("./engine/pixel-diff");
const worker_threads_1 = require("worker_threads");
const css_diff_1 = require("./engine/css-diff");
const a11y_diff_1 = require("./engine/a11y-diff");
const data_rules_1 = require("./engine/data-rules");
const runtime_diff_1 = require("./engine/runtime-diff");
const secrets_1 = require("./engine/secrets");
const data_sources_1 = require("./engine/data-sources");
const store_1 = require("./engine/store");
const ai_1 = require("./engine/ai");
/** Copy of v with every *ScreenshotPath value reduced to its base name (socket payloads must not leak disk paths). */
function stripShotPaths(v) {
    if (Array.isArray(v))
        return v.map(stripShotPaths);
    if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [
            k,
            /ScreenshotPath$/.test(k) ? (typeof x === 'string' && x ? path.basename(x) : x) : stripShotPaths(x),
        ]));
    }
    return v;
}
const INFO_RESULTS = new Set(['Replaying', 'Info', 'Active', 'Permitted', 'Requested']);
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** How long PROD writes stay permitted after an allowlisted action is replayed. */
const ALLOWLIST_PERMIT_WINDOW_MS = 5000;
const DESTRUCTIVE_ACTION_RE = /\b(delete|remove|destroy|purge|drop|terminate|deactivate|unsubscribe|refund|purchase|buy now|pay|pay now|checkout|place order|submit order|transfer|wire|cancel (?:subscription|order|account|plan)|reset (?:password|account|data))\b/i;
const BLOCKED_HOSTS = new Set([
    '169.254.169.254',
    'metadata.google.internal',
    'metadata',
    '100.100.100.200',
    'fd00:ec2::254',
]);
/**
 * Akamai and similar WAFs block obvious automation fingerprints.
 * Prefer the system Chrome channel and a normal desktop Chrome UA (never "QA-Vision-*"
 * or "HeadlessChrome"). QA_VISION_BROWSER=chromium forces bundled Chromium.
 */
function preferSystemChrome() {
    return String(process.env.QA_VISION_BROWSER || 'chrome').toLowerCase() !== 'chromium';
}
function desktopChromeUserAgent(browserVersion) {
    const raw = String(browserVersion || '').replace(/^Chrome\//i, '').trim();
    const full = /^\d+(\.\d+){1,3}$/.test(raw) ? raw : '131.0.0.0';
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`;
}
/** Reduce common headless/automation signals sites use for bot checks. */
function attachStealth(context) {
    context.addInitScript(() => {
        try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        }
        catch {
            /* ignore */
        }
        try {
            const w = window;
            if (!w.chrome)
                w.chrome = { runtime: {} };
        }
        catch {
            /* ignore */
        }
    });
}
async function launchQaBrowser(launchOptions) {
    if (preferSystemChrome()) {
        try {
            return await playwright_1.chromium.launch({ ...launchOptions, channel: 'chrome' });
        }
        catch {
            // System Chrome missing or broken — fall back to bundled Chromium.
        }
    }
    return playwright_1.chromium.launch(launchOptions);
}
/**
 * Live Comparison shows one page per side. target=_blank / window.open would open an invisible
 * Playwright tab the user never sees. Rewrite those to same-tab navigation so the link opens
 * in the live pane (and can be mirrored to PROD).
 */
function attachSameTabLinkBehavior(context) {
    context.addInitScript(() => {
        const httpUrl = (raw) => {
            try {
                if (raw == null || raw === '')
                    return null;
                const abs = new URL(String(raw), location.href);
                if (abs.protocol !== 'http:' && abs.protocol !== 'https:')
                    return null;
                return abs.href;
            }
            catch {
                return null;
            }
        };
        const go = (raw) => {
            const href = httpUrl(raw);
            if (!href)
                return false;
            try {
                location.assign(href);
                return true;
            }
            catch {
                try {
                    location.href = href;
                    return true;
                }
                catch {
                    return false;
                }
            }
        };
        const retarget = (root) => {
            try {
                (root || document).querySelectorAll('a[target="_blank"], a[target="_new"]').forEach((node) => {
                    const a = node;
                    a.setAttribute('target', '_self');
                    a.setAttribute('data-qa-vision-same-tab', '1');
                });
            }
            catch {
                /* ignore */
            }
        };
        const boot = () => {
            retarget(document);
            try {
                const mo = new MutationObserver(() => retarget(document));
                mo.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['target'],
                });
            }
            catch {
                /* ignore */
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
        }
        else {
            boot();
        }
        // Programmatic popups (absolute or relative http(s)) → this tab
        try {
            const originalOpen = window.open.bind(window);
            window.open = function (url, target, features) {
                if (go(url ?? null))
                    return window;
                // about:blank / blob / empty — keep default (some download helpers need a real window)
                return originalOpen(url, target, features);
            };
        }
        catch {
            /* ignore */
        }
        // Capture-phase click: any gesture that would open a new tab opens in this pane instead.
        document.addEventListener('click', (e) => {
            try {
                if (e.button !== 0 && e.button !== 1)
                    return;
                const a = e.target?.closest?.('a[href]');
                if (!a)
                    return;
                const href = httpUrl(a.href);
                if (!href)
                    return;
                const t = (a.getAttribute('target') || '').toLowerCase();
                const modifierNewTab = e.ctrlKey || e.metaKey || e.button === 1;
                const attrNewTab = t === '_blank' || t === '_new';
                // Already retargeted to _self: only intercept modifier/middle clicks
                if (!attrNewTab && !modifierNewTab)
                    return;
                e.preventDefault();
                e.stopPropagation();
                go(href);
            }
            catch {
                /* ignore */
            }
        }, true);
        // Auxclick covers middle-button on some browsers
        document.addEventListener('auxclick', (e) => {
            try {
                if (e.button !== 1)
                    return;
                const a = e.target?.closest?.('a[href]');
                if (!a)
                    return;
                const href = httpUrl(a.href);
                if (!href)
                    return;
                e.preventDefault();
                e.stopPropagation();
                go(href);
            }
            catch {
                /* ignore */
            }
        }, true);
    });
}
async function newQaContext(browser, viewport) {
    const context = await browser.newContext({
        viewport: { ...viewport },
        locale: process.env.QA_VISION_LOCALE || 'en-US',
        timezoneId: process.env.QA_VISION_TZ || 'America/New_York',
        colorScheme: 'light',
        userAgent: desktopChromeUserAgent(browser.version()),
        // DEV installs a recorder init-script + exposeFunction bridge. Strict CSP / Trusted Types on
        // targets like appalpha.bruin.com can block that injection and leave the SPA on an endless
        // spinner while PROD (no recorder) loads data normally. Bypass CSP so page JS still runs.
        bypassCSP: true,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
            'Accept-Language': process.env.QA_VISION_ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
        },
    });
    attachStealth(context);
    attachSameTabLinkBehavior(context);
    return context;
}
/**
 * Keep profile query params (e.g. clientId) after SSO/redirects without a catch-all context.route.
 *
 * IMPORTANT: never hard-reload in a loop. Bruin's SPA sometimes writes clientId=0 into the URL; a
 * page.goto() fight causes endless reloads and a permanently blank main pane. Soft-fix the URL
 * (and common storage keys) at most a few times per path.
 */
function attachBaseQueryGuard(page, baseUrl) {
    let baseOrigin = '';
    let baseParams = [];
    try {
        const b = new URL(baseUrl);
        baseOrigin = b.origin;
        baseParams = [...b.searchParams.entries()];
    }
    catch {
        return;
    }
    if (!baseParams.length || !baseOrigin)
        return;
    let fixing = false;
    let lastSoftAt = 0;
    const softCountByPath = new Map();
    const maybeFix = async () => {
        if (fixing || page.isClosed())
            return;
        const now = Date.now();
        if (now - lastSoftAt < 800)
            return; // debounce SPA thrash
        let cur;
        try {
            cur = page.url();
        }
        catch {
            return;
        }
        let u;
        try {
            u = new URL(cur);
        }
        catch {
            return;
        }
        if (u.origin !== baseOrigin)
            return;
        const fixed = mergeBaseQuery(cur, baseUrl);
        if (fixed === cur)
            return;
        const pathKey = u.pathname;
        const used = softCountByPath.get(pathKey) || 0;
        if (used >= 3)
            return; // stop fighting the SPA on this route
        fixing = true;
        lastSoftAt = now;
        softCountByPath.set(pathKey, used + 1);
        try {
            await page
                .evaluate(({ href, params }) => {
                try {
                    const next = new URL(href, location.href);
                    if (next.origin !== location.origin)
                        return;
                    const dest = next.pathname + next.search + next.hash;
                    if (dest !== location.pathname + location.search + location.hash) {
                        history.replaceState(history.state, '', dest);
                    }
                    // Seed storage keys SPAs often read for tenant context
                    for (const [k, v] of params) {
                        try {
                            sessionStorage.setItem(k, v);
                            sessionStorage.setItem(k.toLowerCase(), v);
                            if (/clientid/i.test(k)) {
                                sessionStorage.setItem('clientId', v);
                                sessionStorage.setItem('selectedClientId', v);
                                localStorage.setItem('clientId', v);
                                localStorage.setItem('selectedClientId', v);
                            }
                        }
                        catch {
                            /* private mode */
                        }
                    }
                }
                catch {
                    /* ignore */
                }
            }, { href: fixed, params: baseParams })
                .catch(() => { });
        }
        finally {
            fixing = false;
        }
    };
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame())
            void maybeFix();
    });
    page.on('load', () => {
        void maybeFix();
    });
}
/** Long-lived / streaming responses: never call response.body() on these (hangs the collector). */
const SKIP_BODY_URL_RE = /longpoll|long-poll|\/stream\b|event-source|server-sent|\/sse\b|\/ws\b|websocket|notify\/wait|mercure/i;
function shouldReadJsonBody(url, contentType, contentLengthHeader) {
    if (!/json/i.test(contentType))
        return false;
    if (SKIP_BODY_URL_RE.test(url))
        return false;
    if (contentLengthHeader == null || contentLengthHeader === '')
        return false; // chunked / unknown: skip
    const len = Number(contentLengthHeader);
    return Number.isFinite(len) && len > 0 && len <= 256 * 1024;
}
/**
 * Validate a target URL before a browser is pointed at it.
 * Optional org allowlist: QA_VISION_ALLOWED_HOSTS="example.com,localhost" (suffix match).
 */
function validateTargetUrl(raw) {
    let u;
    try {
        u = new URL(String(raw || '').trim());
    }
    catch {
        return { ok: false, error: `Invalid URL: "${raw}"` };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, error: `Only http/https URLs are allowed (got ${u.protocol})` };
    }
    if (u.username || u.password) {
        return { ok: false, error: 'Credentials embedded in the URL are not allowed' };
    }
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTS.has(host) || host.startsWith('169.254.')) {
        return { ok: false, error: `Host ${host} is a cloud metadata / link-local address and is blocked` };
    }
    const allowEnv = (process.env.QA_VISION_ALLOWED_HOSTS || '').trim();
    if (allowEnv) {
        const allowed = allowEnv.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
        if (!allowed.some((a) => host === a || host.endsWith('.' + a))) {
            return { ok: false, error: `Host ${host} is not in QA_VISION_ALLOWED_HOSTS` };
        }
    }
    return { ok: true, url: u.toString() };
}
/** Auth/callback paths on the app origin (SSO return) — still map even when outside the profile path prefix. */
const APP_AUTH_PATH_RE = /\/(signin|sign-in|login|log-in|auth|oauth|callback|sso|kinde|saml)([-_/]|$)/i;
/** Query values that mean "unset" — Bruin sets clientId=0 when the SPA drops the real client. */
const EMPTY_QUERY_VALUE_RE = /^(0|null|undefined|)$/i;
function queryValueMissing(current) {
    return current == null || EMPTY_QUERY_VALUE_RE.test(String(current).trim());
}
/**
 * Merge profile query params into the current URL (e.g. keep clientId=86937).
 * Fills missing keys and replaces empty/0/null placeholders so dashboards do not load blank.
 */
function mergeBaseQuery(href, ...bases) {
    try {
        const u = new URL(href);
        let changed = false;
        for (const base of bases) {
            if (!base)
                continue;
            let b;
            try {
                b = new URL(base);
            }
            catch {
                continue;
            }
            if (b.origin !== u.origin)
                continue;
            for (const [k, v] of b.searchParams) {
                if (queryValueMissing(u.searchParams.get(k))) {
                    u.searchParams.set(k, v);
                    changed = true;
                }
            }
        }
        return changed ? u.toString() : href;
    }
    catch {
        return href;
    }
}
function searchWithBaseDefaults(current, ...bases) {
    const out = new URLSearchParams(current);
    for (const b of bases) {
        for (const [k, v] of b.searchParams) {
            if (queryValueMissing(out.get(k)))
                out.set(k, v);
        }
    }
    const s = out.toString();
    return s ? `?${s}` : '';
}
/**
 * Map a DEV URL onto the PROD base (same relative path/query/hash). Null if outside the DEV base.
 * Profile query params (e.g. clientId) are carried over when missing or placeholder (0/null).
 * When DEV/PROD bases share the same path on different hosts (Bruin appalpha vs app), any same-origin
 * app path maps 1:1 so SPA routes like /piab-dashboard still replicate.
 */
function mapDevUrlToProd(devHref, devBase, prodBase) {
    try {
        const d = new URL(devHref);
        const db = new URL(devBase);
        const pb = new URL(prodBase);
        if (d.origin !== db.origin)
            return null;
        const devPrefix = db.pathname.replace(/\/+$/, '');
        const prodPrefix = pb.pathname.replace(/\/+$/, '');
        const underPrefix = !devPrefix || d.pathname === devPrefix || d.pathname.startsWith(devPrefix + '/');
        // Same path on different hosts (e.g. both .../sdwan-dashboard): treat the whole origin as the app.
        const sameAppPath = devPrefix === prodPrefix;
        if (!underPrefix && !sameAppPath) {
            if (!APP_AUTH_PATH_RE.test(d.pathname))
                return null;
            return `${pb.origin}${d.pathname}${searchWithBaseDefaults(d.searchParams, db, pb)}${d.hash}`;
        }
        let path;
        if (sameAppPath || !devPrefix) {
            path = d.pathname || '/';
        }
        else {
            const rest = d.pathname.slice(devPrefix.length);
            path = `${prodPrefix}${rest}` || '/';
        }
        return `${pb.origin}${path}${searchWithBaseDefaults(d.searchParams, db, pb)}${d.hash}`;
    }
    catch {
        return null;
    }
}
/**
 * True when DEV is outside its base URL but PROD is on the very same origin, e.g. both apps redirected to a shared
 * SSO/login host. The two pages are then already equivalent: PROD needs no navigation, and replayed clicks/fills
 * drive it through the flow (its URLs may differ by per-session tokens, so DEV's URL is never copied over).
 */
function onSharedOutsideHost(devHref, prodHref, devBase, prodBase) {
    try {
        const d = new URL(devHref);
        const p = new URL(prodHref);
        if (!/^https?:$/.test(d.protocol) || d.origin !== p.origin)
            return false;
        return mapDevUrlToProd(devHref, devBase, prodBase) === null && d.origin !== new URL(prodBase).origin;
    }
    catch {
        return false;
    }
}
let pixelWorker = null;
let pixelWorkerBroken = false;
let pixelJobSeq = 0;
const pixelJobs = new Map();
function getPixelWorker() {
    if (pixelWorker || pixelWorkerBroken || process.env.QA_VISION_PIXEL_WORKER === '0')
        return pixelWorker;
    const file = path.join(process.cwd(), 'engine-dist', 'engine', 'pixel-worker.js');
    if (!fs.existsSync(file)) {
        pixelWorkerBroken = true;
        return null;
    }
    try {
        const w = new worker_threads_1.Worker(file);
        w.unref(); // never keeps the process alive on its own
        w.on('message', (msg) => {
            const job = pixelJobs.get(msg.id);
            if (!job)
                return;
            pixelJobs.delete(msg.id);
            if (msg.error || !msg.result)
                return job.reject(new Error(msg.error || 'pixel worker returned nothing'));
            const o = msg.result.overlayPng;
            job.resolve({ ...msg.result, overlayPng: o ? Buffer.from(o.buffer, o.byteOffset, o.byteLength) : undefined });
        });
        const fail = (err) => {
            if (pixelWorker === w)
                pixelWorker = null;
            for (const job of pixelJobs.values())
                job.reject(err);
            pixelJobs.clear();
        };
        w.on('error', (err) => fail(err));
        w.on('exit', (code) => fail(new Error(`pixel worker exited (${code})`)));
        pixelWorker = w;
    }
    catch {
        pixelWorkerBroken = true;
    }
    return pixelWorker;
}
async function diffPixelsOffThread(buf1, buf2, threshold) {
    const w = getPixelWorker();
    if (w) {
        try {
            return await new Promise((resolve, reject) => {
                const id = ++pixelJobSeq;
                pixelJobs.set(id, { resolve, reject });
                w.postMessage({ id, a: buf1, b: buf2, threshold });
            });
        }
        catch {
            /* worker died or failed on this job: do it here instead */
        }
    }
    return (0, pixel_diff_1.diffPixels)(buf1, buf2, threshold);
}
/** Strip query/hash (may carry tokens) for logging. */
function urlForLog(href) {
    try {
        const u = new URL(href);
        return `${u.origin}${u.pathname}`;
    }
    catch {
        return '(invalid url)';
    }
}
/** Query/fragment parameters whose values are credentials: masked even in the Live view's address bar. */
const SECRET_URL_PARAM_RE = /token(?!_type)|passw|secret|^code$|signature|^sig$|assertion|samlresponse|api[-_]?key|^auth$|^session/i;
/**
 * The full URL for the Live view's address bar: query and fragment included (client_id, redirect_uri, state, scope
 * and so on stay readable), with only credential values masked. Logs, reports and evidence keep urlForLog.
 */
function urlForAddressBar(href) {
    let u;
    try {
        u = new URL(href);
    }
    catch {
        return '(invalid url)';
    }
    if (!/^https?:$/.test(u.protocol))
        return href;
    const mask = (params) => {
        let changed = false;
        for (const key of new Set(params.keys())) {
            if (SECRET_URL_PARAM_RE.test(key)) {
                params.set(key, '***');
                changed = true;
            }
        }
        return changed;
    };
    u.username = '';
    u.password = '';
    if (mask(u.searchParams))
        u.search = u.searchParams.toString();
    // OAuth implicit flows put tokens in the fragment (#access_token=...): mask those too when it is key=value shaped
    const frag = u.hash.slice(1);
    if (frag.includes('=')) {
        const fp = new URLSearchParams(frag);
        if (mask(fp))
            u.hash = fp.toString();
    }
    return u.toString();
}
function redactValue(message, action) {
    let msg = String(message || '');
    if (action.value && action.value.length > 0)
        msg = msg.split(action.value).join('***');
    return msg;
}
function compileIgnoreRules(rules) {
    const replacers = [];
    const exclusions = [];
    const idRe = (s) => s
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<ID>')
        .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g, '<ID>');
    for (const raw of rules || []) {
        const rule = String(raw || '').trim();
        if (!rule)
            continue;
        const lower = rule.toLowerCase();
        if (lower === 'timestamp' || lower === 'timestamps') {
            replacers.push((s) => s
                .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/g, '<TIMESTAMP>')
                .replace(/\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/g, '<DATE>')
                .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/gi, '<TIME>'));
        }
        else if (lower === 'session-id' || lower === 'random' || lower === 'random-id') {
            replacers.push(idRe);
        }
        else if (lower === 'numbers' || lower === 'counters') {
            replacers.push((s) => s.replace(/\d[\d,.]*/g, '<N>'));
        }
        else if (lower.startsWith('regex:')) {
            try {
                const re = new RegExp(rule.slice(6), 'gi');
                replacers.push((s) => s.replace(re, '<IGNORED>'));
            }
            catch {
                /* invalid pattern: skipped (reported at session start) */
            }
        }
        else {
            exclusions.push(lower.startsWith('text:') ? lower.slice(5) : lower);
        }
    }
    return {
        active: replacers.length > 0 || exclusions.length > 0,
        normalize: (s) => replacers.reduce((acc, fn) => fn(acc), String(s ?? '')),
        exclude: (f) => {
            const hay = `${f.component || ''} ${f.devValue || ''} ${f.prodValue || ''}`.toLowerCase();
            const hit = exclusions.find((e) => e && hay.includes(e));
            return hit ? `text:${hit}` : null;
        },
    };
}
/** Max time for structural extraction plus diffs on one step. */
/**
 * Compare depth:
 * - standard (default): text + fonts + field values + images + visual pixels (what Live Comparison needs)
 * - full: also a11y/layout/network/console (QA_VISION_FULL_COMPARE=1 or QA_VISION_COMPARE_MODE=full)
 * - fast: text + visual only (QA_VISION_COMPARE_MODE=fast)
 */
function compareMode() {
    const raw = String(process.env.QA_VISION_COMPARE_MODE || '').toLowerCase().trim();
    if (raw === 'fast' || raw === 'off')
        return 'fast';
    if (raw === 'full' || process.env.QA_VISION_FULL_COMPARE === '1')
        return 'full';
    return 'standard';
}
const fullCompareEnabled = () => compareMode() === 'full';
const standardCompareEnabled = () => compareMode() !== 'fast';
/** Font-focused CSS props for standard live compare (fast enough for every step). */
const LIVE_FONT_STYLE_PROPS = [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'color',
    'text-decoration-line',
    'line-height',
];
const comparisonBudgetMs = () => {
    const n = Number(process.env.QA_VISION_COMPARE_BUDGET_MS);
    if (Number.isFinite(n) && n >= 500)
        return n;
    const mode = compareMode();
    return mode === 'full' ? 8000 : mode === 'standard' ? 5000 : 2500;
};
/** Max Live-view frames per second per pane (QA_VISION_LIVE_FPS, 1-30, default 5). */
function liveCastMinIntervalMs() {
    const fps = Number(process.env.QA_VISION_LIVE_FPS);
    return Math.round(1000 / (Number.isFinite(fps) && fps >= 1 && fps <= 30 ? fps : 5));
}
function getEngineGlobals() {
    const g = globalThis;
    if (!g.__qaVisionEngine) {
        g.__qaVisionEngine = {
            sessions: new Map(),
            lastSnapshot: null,
            io: null,
            orphanTimer: null,
        };
    }
    return g.__qaVisionEngine;
}
class QAComparisonEngine {
    // Use globalThis so Next.js route bundles share one session store (dev HMR safe)
    get sessions() {
        return getEngineGlobals().sessions;
    }
    get lastSnapshot() {
        return getEngineGlobals().lastSnapshot;
    }
    set lastSnapshot(value) {
        getEngineGlobals().lastSnapshot = value;
    }
    get io() {
        return getEngineGlobals().io;
    }
    setSocketIO(io) {
        getEngineGlobals().io = io;
        // Orphan reaper: watch dashboard connections so unwatched sessions cannot pile up browsers.
        io.on('connection', (socket) => {
            this.evaluateOrphans();
            socket.on('disconnect', () => this.evaluateOrphans());
        });
        this.evaluateOrphans();
    }
    /** QA_VISION_ORPHAN_TIMEOUT_MS (default 10 minutes); read at arm time so tests can change it. */
    orphanTimeoutMs() {
        const n = Number(process.env.QA_VISION_ORPHAN_TIMEOUT_MS);
        return Number.isFinite(n) && n > 0 ? n : 600000;
    }
    /**
     * Arms the reaper timer when sessions exist and no dashboard socket is connected; any connected
     * socket (or no sessions left) cancels it. Event-driven: called on connect, disconnect and session create.
     */
    evaluateOrphans() {
        const g = getEngineGlobals();
        const io = g.io;
        if (!io)
            return;
        const watched = io.sockets.sockets.size > 0;
        if (watched || this.sessions.size === 0) {
            if (g.orphanTimer)
                clearTimeout(g.orphanTimer);
            g.orphanTimer = null;
            return;
        }
        if (g.orphanTimer)
            return;
        const ms = this.orphanTimeoutMs();
        g.orphanTimer = setTimeout(() => {
            g.orphanTimer = null;
            if (!g.io || g.io.sockets.sockets.size > 0)
                return;
            const minutes = +(ms / 60000).toFixed(2);
            const reason = `Session closed: no dashboard connected for ${minutes} min`;
            console.warn(reason);
            void Promise.all(Array.from(this.sessions.keys()).map((id) => this.closeSession(id, reason)));
        }, ms);
        g.orphanTimer.unref?.();
    }
    /** Live sessions as the dashboard needs them to reconnect after a page reload (same data the socket emits). */
    listActiveSessions() {
        return Array.from(this.sessions.values()).map((s) => ({
            sessionId: s.id,
            phase: s.phase,
            profileId: s.profileId,
            projectName: s.projectName,
            devUrl: urlForLog(s.devUrl),
            prodUrl: urlForLog(s.prodUrl),
            startedAt: s.startedAt,
            outOfSync: s.outOfSync,
            logs: s.logs.slice(0, 1000).map((l) => stripShotPaths(l)),
            mismatches: s.mismatches.slice(0, 500).map((m) => stripShotPaths(m)),
        }));
    }
    /** Collects network/API and console/page-error facts (never bodies or values). Listeners never throw. */
    attachCollectors(session, side, page) {
        // Look logs up at event time: consumers may replace the arrays.
        const net = { push: (e) => (0, runtime_diff_1.pushCapped)(session.netLog[side], e) };
        const rt = { push: (e) => (0, runtime_diff_1.pushCapped)(session.runtimeLog[side], e) };
        const label = side === 'dev' ? 'DEV' : 'PROD';
        // Dedupe noisy block logs (same path failing repeatedly must not flood the timeline).
        const recentBlockKeys = new Map();
        const noteBlock = (text) => {
            const key = text.slice(0, 160);
            const now = Date.now();
            const prev = recentBlockKeys.get(key) || 0;
            if (now - prev < 8000)
                return;
            recentBlockKeys.set(key, now);
            if (recentBlockKeys.size > 40) {
                for (const [k, t] of recentBlockKeys)
                    if (now - t > 60000)
                        recentBlockKeys.delete(k);
            }
            this.log(session.id, `${label} blocked/failed request: ${text}`, side === 'dev' ? 'Error' : 'n/a', side === 'prod' ? 'Error' : 'n/a');
        };
        page.on('response', async (res) => {
            try {
                const req = res.request();
                const headers = res.headers();
                const contentType = headers['content-type'] || '';
                const status = res.status();
                const url = res.url();
                const method = req.method();
                let json;
                // Only sample small, finite JSON bodies. Long-poll / chunked / large bodies used to hang
                // await res.body() and could stall DEV (where SPA data APIs + longpolling run after login).
                if (shouldReadJsonBody(url, contentType, headers['content-length'])) {
                    try {
                        const body = await Promise.race([
                            res.body(),
                            new Promise((r) => setTimeout(() => r(null), 1500)),
                        ]);
                        if (body && body.length <= 256 * 1024)
                            json = JSON.parse(body.toString('utf8'));
                    }
                    catch {
                        /* schema stays null */
                    }
                }
                net.push((0, runtime_diff_1.toNetworkEntry)({
                    method, url, status,
                    resourceType: req.resourceType(), contentType, json,
                }));
                // Surface auth / gateway blocks in the session log so a blank DEV pane is explainable.
                if (status === 401 || status === 403 || status === 407 || status === 429) {
                    const path = (() => {
                        try {
                            return new URL(url).pathname;
                        }
                        catch {
                            return url.slice(0, 80);
                        }
                    })();
                    noteBlock(`${method} ${status} ${path}`);
                }
            }
            catch {
                /* ignore */
            }
        });
        page.on('requestfailed', (req) => {
            try {
                const failure = req.failure()?.errorText || 'failed';
                net.push((0, runtime_diff_1.toNetworkEntry)({
                    method: req.method(), url: req.url(), status: null,
                    resourceType: req.resourceType(), failure,
                }));
                // Safety-policy aborts on PROD are intentional; still record them. Real client blocks on DEV
                // (Akamai, extension, CSP) must show up so "data not loading" is diagnosable.
                if (failure.includes('ERR_BLOCKED') || failure.includes('ERR_ACCESS') || failure.includes('ERR_FAILED')) {
                    noteBlock(`${req.method()} ${urlForLog(req.url())} ${failure}`);
                }
                if (failure !== 'net::ERR_BLOCKED_BY_CLIENT') {
                    rt.push({ kind: 'request-failed', text: (0, runtime_diff_1.toRuntimeText)(`${req.method()} ${req.url()} ${failure}`) });
                }
            }
            catch {
                /* ignore */
            }
        });
        page.on('console', (msg) => {
            try {
                if (msg.type() === 'error')
                    rt.push({ kind: 'console-error', text: (0, runtime_diff_1.toRuntimeText)(msg.text()) });
            }
            catch {
                /* ignore */
            }
        });
        page.on('pageerror', (err) => {
            try {
                rt.push({ kind: 'page-error', text: (0, runtime_diff_1.toRuntimeText)(err?.message || String(err)) });
            }
            catch {
                /* ignore */
            }
        });
    }
    async createSession(devUrl, prodUrl, opts = {}) {
        const projectName = opts.projectName || 'QA Vision Session';
        let safetyPolicy = opts.safetyPolicy || 'read-only';
        const safetyAllowlist = opts.safetyAllowlist || [];
        const ignoreRules = opts.ignoreRules || [];
        const capture = (0, findings_1.normalizeCaptureSettings)(opts.capture);
        const startImmediately = opts.startImmediately !== false;
        const devCheck = validateTargetUrl(devUrl);
        if (!devCheck.ok)
            throw new Error(`DEV URL rejected: ${devCheck.error}`);
        const prodCheck = validateTargetUrl(prodUrl);
        if (!prodCheck.ok)
            throw new Error(`PROD URL rejected: ${prodCheck.error}`);
        devUrl = devCheck.url;
        prodUrl = prodCheck.url;
        if (!['read-only', 'allow-safe', 'full'].includes(safetyPolicy))
            safetyPolicy = 'read-only';
        const sessionId = 'sess_' + Date.now();
        const evidenceDir = path.join(process.cwd(), 'reports', 'evidence', sessionId);
        fs.mkdirSync(evidenceDir, { recursive: true });
        const launchOptions = {
            // Headless by default: the user drives DEV from the dashboard's Live view (see handleLiveInput).
            // QA_VISION_SHOW_BROWSERS=1 brings back the separate visible DEV/PROD windows.
            headless: process.env.QA_VISION_SHOW_BROWSERS !== '1' || process.env.QA_VISION_HEADLESS === '1',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                // Back/Forward must really load the page: a back/forward-cache restore fires no load event (goBack then
                // stalls until its timeout, and the move is never mirrored to PROD), and both sides should behave alike
                '--disable-back-forward-cache',
                `--window-size=${capture.viewport.width},${capture.viewport.height + 100}`,
            ],
            timeout: 60000,
        };
        // System Chrome + normal desktop UA: sites behind Akamai (e.g. app.bruin.com) deny
        // the old "QA-Vision-DEV/PROD" user agents and bare automation fingerprints.
        // DEV and PROD start in parallel: launch time is one browser start, not two
        const openSide = async () => {
            const browser = await launchQaBrowser(launchOptions);
            try {
                const context = await newQaContext(browser, capture.viewport);
                return { browser, context, page: await context.newPage() };
            }
            catch (e) {
                await browser.close().catch(() => { });
                throw e;
            }
        };
        const [devSide, prodSide] = await Promise.allSettled([openSide(), openSide()]);
        if (devSide.status === 'rejected' || prodSide.status === 'rejected') {
            // Never leave the other browser running
            for (const r of [devSide, prodSide])
                if (r.status === 'fulfilled')
                    await r.value.browser.close().catch(() => { });
            throw (devSide.status === 'rejected' ? devSide.reason : prodSide.reason);
        }
        const { browser: devBrowser, context: devContext, page: devPage } = devSide.value;
        const { browser: prodBrowser, context: prodContext, page: prodPage } = prodSide.value;
        // Preserve clientId etc. without a catch-all context.route (that broke SignalR/XHR on appalpha).
        attachBaseQueryGuard(devPage, devUrl);
        attachBaseQueryGuard(prodPage, prodUrl);
        // Safety net: if a popup still opens, fold it into the main live pane (never leave an invisible tab).
        this.attachPopupToMainPane(sessionId, 'dev', devContext);
        this.attachPopupToMainPane(sessionId, 'prod', prodContext);
        // Headless browsers show no dialogs: an unhandled alert() would look like "nothing happened". Report each one
        // in the log and on the dashboard, then answer it: alert/beforeunload are accepted, confirm/prompt dismissed
        // (the safe answer: nothing is approved on the user's behalf).
        for (const [side, page] of [['DEV', devPage], ['PROD', prodPage]]) {
            page.on('dialog', async (dialog) => {
                const kind = dialog.type();
                const accept = kind === 'alert' || kind === 'beforeunload';
                const message = dialog.message().replace(/\s+/g, ' ').trim().slice(0, 300);
                try {
                    this.log(sessionId, `${side} ${kind}: "${message}" (${accept ? 'closed' : 'dismissed'} automatically)`, side === 'DEV' ? 'Info' : '', side === 'PROD' ? 'Info' : '');
                    this.io?.emit('page-dialog', { sessionId, side, kind, message });
                }
                catch {
                    /* reporting must never leave the dialog open */
                }
                await (accept ? dialog.accept() : dialog.dismiss()).catch(() => { });
            });
        }
        // Title the windows so the user can tell them apart
        devPage.on('load', async () => {
            try {
                await devPage.evaluate(() => {
                    document.title = `QA Vision DEV — ${document.title.replace(/^QA Vision DEV — /, '')}`;
                });
            }
            catch {
                /* ignore */
            }
        });
        prodPage.on('load', async () => {
            try {
                await prodPage.evaluate(() => {
                    document.title = `QA Vision PROD — ${document.title.replace(/^QA Vision PROD — /, '')}`;
                });
            }
            catch {
                /* ignore */
            }
        });
        const session = {
            id: sessionId,
            profileId: opts.profileId,
            capture,
            projectName,
            devBrowser,
            prodBrowser,
            devContext,
            prodContext,
            devPage,
            prodPage,
            devUrl,
            prodUrl,
            isRunning: true,
            isPaused: false,
            phase: startImmediately ? 'running' : 'ready',
            logs: [],
            mismatches: [],
            safetyPolicy,
            safetyAllowlist: (safetyAllowlist || [])
                .map((s) => String(s).trim().toLowerCase())
                .filter(Boolean),
            permitMutationsUntil: 0,
            suppressCapture: false,
            ignoreRules: (ignoreRules || []).map((r) => String(r).trim()).filter(Boolean),
            ignore: compileIgnoreRules(ignoreRules || []),
            dataRules: opts.dataRules || [],
            apiChecks: opts.apiChecks || [],
            dbChecks: opts.dbChecks || [],
            actionQueue: Promise.resolve(),
            pendingActions: 0,
            stepCounter: 0,
            uncomparedSteps: [],
            findingIndex: new Map(),
            expected: new Set(this.loadExpectations(opts.profileId).map((e) => e.fingerprint)),
            outOfSync: false,
            recorderReady: false,
            startedAt: new Date().toISOString(),
            evidenceDir,
            netLog: { dev: [], prod: [] },
            runtimeLog: { dev: [], prod: [] },
        };
        this.attachCollectors(session, 'dev', devPage);
        this.attachCollectors(session, 'prod', prodPage);
        this.sessions.set(sessionId, session);
        this.evaluateOrphans();
        // Surface closed windows instead of silently failing every later action
        for (const [label, browser] of [['DEV', devBrowser], ['PROD', prodBrowser]]) {
            browser.on('disconnected', () => {
                const current = this.sessions.get(sessionId);
                if (!current || !current.isRunning)
                    return;
                this.log(sessionId, `${label} browser window was closed — replication stopped; Stop and start a new session`, label === 'DEV' ? 'Error' : 'n/a', 'Error');
                this.setSyncState(sessionId, true, `${label} browser closed`);
                // The session has effectively ended: record the run now; Stop later rewrites the same row
                this.persistRun(current);
            });
        }
        // Network-level write guard on PROD (installed before any navigation)
        await this.installProdNetworkGuard(sessionId);
        // Bind bridge + init script BEFORE first navigation so SPA loads keep the recorder
        await this.installRecorder(sessionId);
        await Promise.all([
            devPage.goto(devUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }),
            prodPage.goto(prodUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }),
        ]);
        // Ensure injection is present after first paint (React hydration)
        await this.injectRecorderScript(devPage);
        session.recorderReady = true;
        if (opts.login && opts.login.strategy === 'form') {
            for (const side of ['DEV', 'PROD']) {
                const r = side === 'DEV' ? opts.loginCredentials?.dev : opts.loginCredentials?.prod;
                await this.performLogin(sessionId, side, r?.creds ?? null, opts.login, r?.error);
            }
        }
        // Dashboard sessions run the data checks at Start Comparison instead
        if (startImmediately)
            await this.runDataChecks(sessionId);
        this.log(sessionId, 'Session initialized', 'Success', 'Success');
        this.log(sessionId, `PROD safety policy: ${safetyPolicy}` +
            (session.safetyAllowlist.length ? ` (allowlist: ${session.safetyAllowlist.join(', ')})` : ' (no allowlist)') +
            (safetyPolicy === 'full' ? ' — WARNING: PROD writes are NOT blocked' : ''), 'Info', 'Info');
        this.log(sessionId, session.ignoreRules.length ? `Ignore rules: ${session.ignoreRules.join(', ')}` : 'Ignore rules: none (all differences reported)', 'Info', 'Info');
        for (const r of session.ignoreRules.filter((x) => x.toLowerCase().startsWith('regex:'))) {
            try {
                new RegExp(r.slice(6));
            }
            catch {
                this.log(sessionId, `Ignore rule "${r}" is not a valid regular expression and was skipped`, 'Info', 'Error');
            }
        }
        this.log(sessionId, 'Action recorder active on DEV — interact in the DEV pane of Live Comparison', 'Active', 'Active');
        if (startImmediately) {
            // Baseline comparison of the landing pages (runs on the queue, does not block the API)
            this.enqueueTask(sessionId, async () => {
                await this.compareAfterAction(sessionId, ['initial']);
            });
        }
        else {
            this.log(sessionId, 'Ready — log in or navigate in the DEV pane, then press Start Comparison to begin', 'Ready', 'Ready');
            this.io?.emit('status', { sessionId, phase: session.phase, message: 'Ready' });
        }
        this.startFrameStream(sessionId);
        console.log(`✅ QA Vision session created: ${sessionId}`);
        console.log(`   DEV  → ${devUrl}`);
        console.log(`   PROD → ${prodUrl}`);
        console.log(`   Safety → ${safetyPolicy}`);
        console.log(`   Project → ${projectName}`);
        return sessionId;
    }
    /**
     * Profile auto-login (form strategy). Drives the page directly: DEV recorder events are
     * suppressed so nothing is recorded, and PROD gets a short mutation window for the login POST
     * (audited by the network guard log). The password is never logged.
     */
    async performLogin(sessionId, side, creds, cfg, unavailableReason) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        if (!creds) {
            this.log(sessionId, `Auto-login unavailable on ${side}: ${unavailableReason || 'no stored credentials'} — log in manually in the window`, 'Info', 'Info');
            return false;
        }
        const page = side === 'DEV' ? session.devPage : session.prodPage;
        const timeout = cfg.timeoutMs ?? 15000;
        // Only DEV has a recorder; PROD login must not drop real user actions made in the DEV window
        session.suppressCapture = side === 'DEV';
        try {
            const baseUrl = side === 'DEV' ? session.devUrl : session.prodUrl;
            const boundOrigin = (0, secrets_1.originOf)(baseUrl);
            const mismatch = async () => {
                this.log(sessionId, `Auto-login unavailable on ${side}: login page origin mismatch — log in manually in the window`, 'Info', 'Info');
                return false;
            };
            const target = (0, secrets_1.resolveLoginUrl)(cfg.loginPath, baseUrl);
            if (!target)
                return await mismatch();
            if (cfg.loginPath && page.url() !== target)
                await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
            // Never type a secret into a page whose origin is not the one the credentials are bound to
            const onBoundOrigin = () => (0, secrets_1.originOf)(page.url()) === boundOrigin;
            // Let client-side frameworks hydrate so typed values are not lost
            await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 5000) }).catch(() => { });
            if (!onBoundOrigin())
                return await mismatch();
            await page.locator(cfg.usernameSelector).first().fill(creds.username, { timeout });
            if (!onBoundOrigin())
                return await mismatch();
            await page.locator(cfg.passwordSelector).first().fill(creds.password, { timeout });
            if (side === 'PROD') {
                session.permitMutationsUntil = Date.now() + 5000;
                this.log(sessionId, 'PROD login submitted (profile login flow)', 'n/a', 'Info');
            }
            await page.locator(cfg.submitSelector).first().click({ timeout });
            if (cfg.successSelector) {
                await page.locator(cfg.successSelector).first().waitFor({ state: 'visible', timeout });
            }
            else {
                await page.locator(cfg.passwordSelector).first().waitFor({ state: 'hidden', timeout });
            }
            this.log(sessionId, `Logged in on ${side} as ${creds.username}`, 'Info', 'Info');
            return true;
        }
        catch (error) {
            const reason = String(error?.message || error).split(String.fromCharCode(10))[0].split(creds.password).join('***');
            this.log(sessionId, `Login on ${side} failed: ${reason}`, 'Info', 'Error');
            return false;
        }
        finally {
            if (side === 'PROD')
                session.permitMutationsUntil = 0;
            // Let any debounced recorder flush (fill timer 120ms) fire while still suppressed
            if (side === 'DEV')
                await new Promise((r) => setTimeout(r, 400));
            session.suppressCapture = false;
        }
    }
    /**
     * Abort state-changing HTTP requests issued by the PROD browser, per safety policy.
     * This is the hard guarantee: even if a replayed click triggers a JS fetch/XHR/form POST,
     * the write never leaves the PROD browser unless explicitly allowed.
     */
    async installProdNetworkGuard(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        // full = no blocking: skip the catch-all route so PROD XHR/SignalR/WebSocket are never proxied
        if (session.safetyPolicy === 'full')
            return;
        await session.prodContext.route('**/*', async (route) => {
            const req = route.request();
            const method = req.method().toUpperCase();
            const current = this.sessions.get(sessionId);
            if (!current)
                return route.continue().catch(() => { });
            const decision = this.evaluateRequest(current, method, req.url());
            if (decision.allow) {
                if (decision.audit) {
                    this.log(sessionId, `PROD write permitted (${decision.audit}): ${method} ${urlForLog(req.url())}`, 'n/a', 'Permitted');
                }
                return route.continue().catch(() => { });
            }
            this.log(sessionId, `Blocked PROD request (${current.safetyPolicy}): ${method} ${urlForLog(req.url())}`, 'n/a', 'Blocked');
            this.recordMismatch(sessionId, {
                component: `${method} ${urlForLog(req.url())}`,
                type: 'Safety',
                classification: 'SKIPPED_BY_SAFETY_POLICY',
                replayStatus: 'BLOCKED',
                devValue: 'Request allowed on DEV',
                prodValue: 'Request aborted on PROD',
                severity: 'low',
                description: `A state-changing ${method} request from PROD was aborted by the "${current.safetyPolicy}" safety policy. Add a "url:<fragment>" allowlist entry to the profile if this request is safe.`,
            });
            return route.abort('blockedbyclient').catch(() => { });
        });
    }
    evaluateRequest(session, method, url) {
        if (session.safetyPolicy === 'full')
            return { allow: true };
        if (SAFE_HTTP_METHODS.has(method))
            return { allow: true };
        const lowerUrl = url.toLowerCase();
        const urlRule = session.safetyAllowlist.find((e) => e.startsWith('url:') && e.length > 4 && lowerUrl.includes(e.slice(4)));
        if (urlRule)
            return { allow: true, audit: `allowlist ${urlRule}` };
        if (Date.now() < session.permitMutationsUntil)
            return { allow: true, audit: 'allowlisted action' };
        if (session.safetyPolicy === 'allow-safe') {
            return method === 'DELETE' ? { allow: false } : { allow: true };
        }
        return { allow: false }; // read-only
    }
    async installRecorder(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const { devPage, devContext } = session;
        // Callable from page JS on every document (survives SPA route changes)
        await devPage.exposeFunction('__qaVisionOnAction', async (action) => {
            const current = this.sessions.get(sessionId);
            if (!current || !current.isRunning || current.isPaused || current.stopRequested)
                return;
            // Ready: nothing is recorded or replicated (the single "Ready" line was logged at launch)
            if (current.phase === 'ready')
                return;
            if (current.suppressCapture) {
                this.log(sessionId, 'Action in DEV window ignored while auto-login was running', 'Info', 'Info');
                return;
            }
            // Do not await: the DEV page must not block on PROD replay. Order is kept by the queue.
            void this.enqueueAction(sessionId, action);
        });
        // Runs before page scripts on every navigation / new document
        await devContext.addInitScript({ content: this.getRecorderSource() });
    }
    getRecorderSource() {
        return `
(() => {
  if (window.__qaVisionRecorderInstalled) return;
  window.__qaVisionRecorderInstalled = true;

  let lastActionTime = 0;
  let lastFillKey = '';
  let fillTimer = null;
  let lastComparisonTime = 0;
  const debounceMs = 80;

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }

  function buildSelectors(el) {
    if (!el || el.nodeType !== 1) return [];
    const selectors = [];
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    const testId = el.getAttribute('data-testid');
    if (testId) selectors.push('[data-testid="' + testId + '"]');

    if (el.id) selectors.push('#' + cssEscape(el.id));

    const name = el.getAttribute('name');
    if (name) selectors.push(tag + '[name="' + cssEscape(name) + '"]');

    const type = el.getAttribute('type');
    if (type) selectors.push(tag + '[type="' + cssEscape(type) + '"]');

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) selectors.push(tag + '[placeholder="' + cssEscape(placeholder) + '"]');

    const aria = el.getAttribute('aria-label');
    if (aria) selectors.push(tag + '[aria-label="' + cssEscape(aria) + '"]');

    // No positional (nth-of-type) or bare-tag selectors: they match the wrong element on PROD.
    return selectors.filter((s, i, arr) => s && arr.indexOf(s) === i);
  }

  function implicitRole(el, tag, type) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button';
      if (!type || ['text', 'email', 'search', 'tel', 'url'].indexOf(type) >= 0) return 'textbox';
    }
    return '';
  }

  function labelFor(el) {
    try {
      if (el.labels && el.labels.length) return (el.labels[0].innerText || '').trim().substring(0, 80);
      const wrap = el.closest && el.closest('label');
      if (wrap) return (wrap.innerText || '').trim().substring(0, 80);
    } catch (_) {}
    return '';
  }

  function describe(el) {
    if (!el || !el.getAttribute) return {};
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const type = (el.getAttribute('type') || '').toLowerCase();
    const sensitiveHay = [el.getAttribute('name'), el.id, el.getAttribute('autocomplete')].join(' ');
    const isSubmit =
      (tag === 'button' && (type === 'submit' || (!el.hasAttribute('type') && !!el.form))) ||
      (tag === 'input' && (type === 'submit' || type === 'image'));
    const selectors = buildSelectors(el);
    return {
      tag: tag,
      inputType: type,
      placeholder: el.getAttribute('placeholder') || '',
      name: el.getAttribute('name') || '',
      testId: el.getAttribute('data-testid') || '',
      elementId: el.id || '',
      role: implicitRole(el, tag, type),
      ariaLabel: el.getAttribute('aria-label') || '',
      labelText: labelFor(el),
      href: tag === 'a' ? (el.getAttribute('href') || '') : '',
      isSubmit: isSubmit,
      isSensitive: type === 'password' || ${extract_1.SENSITIVE_FIELD_RE.toString()}.test(sensitiveHay),
      // One-time codes (2-step verification, SMS/authenticator codes) are single-use: never replayed on PROD
      isOneTimeCode: (tag === 'input' || tag === 'textarea') && (
        (el.getAttribute('autocomplete') || '').toLowerCase() === 'one-time-code' ||
        ${extract_1.ONE_TIME_CODE_RE.toString()}.test([sensitiveHay, el.getAttribute('aria-label'), el.getAttribute('placeholder'), labelFor(el)].join(' '))
      ),
      text: tag === 'input' || tag === 'textarea' || tag === 'select'
        ? ''
        : (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 60),
      selectors: selectors,
      selector: selectors[0] || '',
    };
  }

  function emit(action) {
    if (typeof window.__qaVisionOnAction !== 'function') return;
    window.__qaVisionOnAction(action);
  }

  let pendingFill = null; // { target, action }

  // Send a debounced fill immediately (before a click or when another field is edited),
  // so values are never dropped and are replayed in the order the user produced them.
  function flushFill() {
    if (fillTimer) clearTimeout(fillTimer);
    fillTimer = null;
    if (pendingFill) {
      const p = pendingFill;
      pendingFill = null;
      flushClicks();
      emit(p.action);
    }
  }

  // Plain clicks are held briefly so a following dblclick can cancel them (otherwise the
  // two click events of a double-click would be replayed as extra single clicks on PROD).
  const clickDelayMs = 250;
  let pendingClicks = []; // { target, timer, action }

  function flushClicks() {
    const list = pendingClicks;
    pendingClicks = [];
    list.forEach((p) => {
      clearTimeout(p.timer);
      emit(p.action);
    });
  }

  function clickTarget(e) {
    return e.target && e.target.closest
      ? (e.target.closest('button, a, input, select, textarea, [role="button"], [data-testid], label') || e.target)
      : e.target;
  }

  // Native controls that navigate or submit are emitted immediately (a delayed emit could be
  // lost to an unload); everything else, or anything marked as having a dblclick handler, waits.
  function shouldDelayClick(el) {
    if (!el || !el.matches) return false;
    if (el.ondblclick || el.hasAttribute('data-qa-dblclick')) return true;
    return !el.matches('button, a, input, select, textarea, summary, label, [role="button"]');
  }

  // The highlight overlay (and anything inside it) is never a user action.
  ['click', 'dblclick', 'mouseover', 'keydown', 'input', 'change'].forEach((t) => {
    document.addEventListener(t, (e) => {
      const el = e.target;
      if (el && el.closest && el.closest('[data-qa-vision-highlight]')) e.stopImmediatePropagation();
    }, true);
  });

  document.addEventListener('click', (e) => {
    flushFill();
    const now = Date.now();
    if (now - lastActionTime < debounceMs) return;
    lastActionTime = now;

    const target = clickTarget(e);
    cancelHover();

    const action = { type: 'click', ...describe(target), isMutation: true };
    flushClicks();
    if (!shouldDelayClick(target)) {
      emit(action);
      return;
    }
    const entry = { target: target, action: action, timer: null };
    entry.timer = setTimeout(() => {
      pendingClicks = pendingClicks.filter((p) => p !== entry);
      emit(action);
    }, clickDelayMs);
    pendingClicks.push(entry);
  }, true);

  document.addEventListener('dblclick', (e) => {
    flushFill();
    const target = clickTarget(e);
    // Drop the single clicks that belong to this double-click.
    pendingClicks = pendingClicks.filter((p) => {
      if (p.target !== target) return true;
      clearTimeout(p.timer);
      return false;
    });
    flushClicks();
    lastActionTime = Date.now();
    emit({ type: 'dblclick', ...describe(target), isMutation: true });
  }, true);

  // Hover: emitted after a dwell on an interactive / titled element, at most once per element per 2 s.
  const hoverDwellMs = 600;
  const hoverRepeatMs = 2000;
  const lastHover = new WeakMap();
  let hoverEl = null;
  let hoverTimer = null;

  function cancelHover() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverEl = null;
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target && e.target.closest
      ? e.target.closest('button, a, input, select, textarea, [role="button"], [title], [aria-describedby]')
      : null;
    if (el === hoverEl) return;
    cancelHover();
    if (!el) return;
    hoverEl = el;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (!el.isConnected) return;
      const last = lastHover.get(el) || 0;
      if (Date.now() - last < hoverRepeatMs) return;
      lastHover.set(el, Date.now());
      flushFill();
      flushClicks();
      emit({ type: 'hover', ...describe(el), isMutation: false });
    }, hoverDwellMs);
  }, true);
  document.addEventListener('mouseleave', cancelHover, true);

  // A click still waiting out its delay must not be lost when the page unloads.
  window.addEventListener('pagehide', flushClicks, true);
  window.addEventListener('beforeunload', flushClicks, true);

  // Keyboard: navigation / control keys and anything with a modifier. Plain typing stays 'fill'.
  const namedKeys = /^(Enter|Escape|Tab|Arrow(Up|Down|Left|Right)|PageUp|PageDown|Home|End)$/;
  const modifierOnly = /^(Control|Shift|Alt|Meta|AltGraph|CapsLock)$/;

  document.addEventListener('keydown', (e) => {
    if (modifierOnly.test(e.key) || e.isComposing) return;
    const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
    if (!namedKeys.test(e.key) && !hasModifier) return;
    // AltGr / Alt combinations that produce a typed character are typing, not shortcuts.
    const printable = e.key.length === 1;
    if (e.getModifierState && e.getModifierState('AltGraph')) return;
    if (printable && e.altKey && !e.metaKey) return;

    const active = document.activeElement;
    const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
    // Enter on a button or link already produces a click event, which is recorded on its own.
    if (e.key === 'Enter' && !hasModifier && (tag === 'button' || tag === 'a' || tag === 'summary')) return;

    flushFill();
    flushClicks();
    const info = describe(active && active !== document.body && active !== document.documentElement ? active : null);
    // Never record what is typed into a sensitive field: only named keys are kept there.
    if (info.isSensitive && !namedKeys.test(e.key)) return;
    const isFormEnter = e.key === 'Enter' && !!active && !!active.form && tag !== 'textarea';
    emit({
      type: 'key',
      ...info,
      key: e.key,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
      isSubmit: isFormEnter || (!!info.isSubmit && (e.key === 'Enter' || e.key === ' ')),
      isMutation: isFormEnter,
    });
  }, true);

  function scheduleFill(target) {
    const info = describe(target);
    const value = target.value != null ? target.value : (target.textContent || '');
    const key = (info.testId || info.name || info.inputType || info.selector || '') + '|' + value;
    if (key === lastFillKey) return;
    lastFillKey = key;

    if (pendingFill && pendingFill.target !== target) flushFill();
    if (fillTimer) clearTimeout(fillTimer);
    pendingFill = { target: target, action: { type: 'fill', ...info, value: value, isMutation: true } };
    fillTimer = setTimeout(flushFill, 120);
  }

  document.addEventListener('input', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      scheduleFill(target);
    }
  }, true);

  document.addEventListener('change', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      scheduleFill(target);
    }
  }, true);

  let lastNavHref = location.href;
  function emitNavigate() {
    try {
      const href = window.location.href;
      if (href === lastNavHref) return;
      lastNavHref = href;
      emit({ type: 'navigate', url: href });
    } catch (_) {}
  }

  window.addEventListener('popstate', emitNavigate);

  // Scroll: debounced so wheel bursts become one PROD step. Live-view wheel is also mirrored server-side.
  let scrollTimer = null;
  let lastScrollKey = '';
  window.addEventListener(
    'scroll',
    () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        try {
          const x = window.scrollX || document.documentElement.scrollLeft || 0;
          const y = window.scrollY || document.documentElement.scrollTop || 0;
          const key = Math.round(x) + '|' + Math.round(y);
          if (key === lastScrollKey) return;
          lastScrollKey = key;
          emit({ type: 'scroll', x: Math.round(x), y: Math.round(y), isMutation: false });
        } catch (_) {}
      }, 120);
    },
    { passive: true, capture: true }
  );

  // React/Vue SPAs use pushState/replaceState — without these hooks PROD never follows in-app route changes.
  try {
    const wrap = (fn) =>
      function () {
        const ret = fn.apply(this, arguments);
        emitNavigate();
        return ret;
      };
    if (!window.__qaVisionHistoryHooked) {
      window.__qaVisionHistoryHooked = true;
      history.pushState = wrap(history.pushState.bind(history));
      history.replaceState = wrap(history.replaceState.bind(history));
    }
  } catch (_) {}
})();
`;
    }
    /** (Re)install the recorder in the current document. The source is idempotent (guards on a window flag). */
    async injectRecorderScript(page) {
        try {
            await page.evaluate(this.getRecorderSource());
            return await page.evaluate(() => Boolean(window.__qaVisionRecorderInstalled));
        }
        catch (err) {
            console.warn('injectRecorderScript failed', err);
            return false;
        }
    }
    /** Run a task on the session's ordered queue (errors are contained). */
    enqueueTask(sessionId, task) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return Promise.resolve();
        session.actionQueue = session.actionQueue
            .then(task)
            .catch((err) => console.error('QA Vision queue task failed:', err?.message || err));
        return session.actionQueue;
    }
    /**
     * Queue a captured DEV action. Actions replay strictly in order. A comparison runs once the
     * queue drains, covering every step replayed since the previous comparison — so bursts of
     * actions are coalesced into one comparison, but no step is ever left without one.
     */
    enqueueAction(sessionId, action) {
        const session = this.sessions.get(sessionId);
        if (!session || session.phase === 'ready')
            return Promise.resolve();
        session.pendingActions++;
        return this.enqueueTask(sessionId, async () => {
            const current = this.sessions.get(sessionId);
            if (!current)
                return;
            const stepId = `step-${String(++current.stepCounter).padStart(4, '0')}`;
            let executed = false;
            try {
                executed = await this.replicateAction(sessionId, action, stepId);
            }
            finally {
                current.pendingActions = Math.max(0, current.pendingActions - 1);
            }
            if (executed)
                current.uncomparedSteps.push(stepId);
            const due = () => current.pendingActions === 0 && current.uncomparedSteps.length > 0 && current.isRunning && current.phase === 'running';
            if (due()) {
                // Live-view input arrives in bursts; comparing mid-typing would catch DEV ahead of PROD ("test@ac" vs "test@a").
                // If more actions get queued while we wait, the last of them runs the comparison instead.
                await this.waitForLiveInputQuiet(current);
                if (due())
                    await this.compareAfterAction(sessionId, current.uncomparedSteps.splice(0));
            }
        });
    }
    setSyncState(sessionId, outOfSync, detail) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        if (session.outOfSync === outOfSync && !outOfSync)
            return;
        session.outOfSync = outOfSync;
        this.io?.emit('sync-state', { sessionId, outOfSync, detail });
    }
    /**
     * Manual resynchronization: wait for in-flight replay, navigate PROD to the page equivalent to
     * DEV's current URL, re-arm the DEV recorder, and run a fresh comparison.
     * Note: this aligns the page/route only; in-page state (typed values, open modals,
     * client-side login state) is not transferred.
     */
    async resync(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning)
            return { ok: false, message: 'No active session' };
        if (session.phase !== 'running' || session.starting) {
            return { ok: false, message: `Resync is only available while comparing (session is ${session.starting ? 'starting' : session.phase})` };
        }
        return this.performResync(sessionId, 'resync');
    }
    /** Resync without the phase check: used by Start Comparison and Start again, which own the phase transition. */
    async performResync(sessionId, stepLabel) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning)
            return { ok: false, message: 'No active session' };
        if (!session.devBrowser.isConnected() || !session.prodBrowser.isConnected() || session.devPage.isClosed() || session.prodPage.isClosed()) {
            return { ok: false, message: 'A browser window was closed. Stop this session and start a new one.' };
        }
        this.log(sessionId, 'Manual resync requested', 'Requested', 'Requested');
        const drained = await Promise.race([
            session.actionQueue.then(() => true),
            new Promise((r) => setTimeout(() => r(false), 15000)),
        ]);
        if (!drained)
            this.log(sessionId, 'Resync: in-flight replay did not finish within 15s; continuing', 'Info', 'Info');
        const devHref = session.devPage.url();
        const prodHref = session.prodPage.url();
        const target = mapDevUrlToProd(devHref, session.devUrl, session.prodUrl);
        // Both apps on the same outside host (shared SSO/login page): already aligned, PROD stays where it is
        const shared = !target && onSharedOutsideHost(devHref, prodHref, session.devUrl, session.prodUrl);
        if (!target && !shared) {
            const message = `DEV is at ${urlForLog(devHref)}, outside its base URL, and PROD is at ${urlForLog(prodHref)} — PROD cannot be aligned. ` +
                `Navigate DEV back inside ${urlForLog(session.devUrl)}, or use the PROD pane to bring PROD to the matching page.`;
            this.log(sessionId, `Resync failed: ${message}`, 'Executed', 'Error');
            return { ok: false, message };
        }
        try {
            if (target)
                await session.prodPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const recorderOk = await this.injectRecorderScript(session.devPage);
            const where = target
                ? `PROD navigated to ${urlForLog(target)}`
                : `PROD already on the shared host ${new URL(devHref).origin} (left in place)`;
            this.log(sessionId, `Resynchronized: ${where} (DEV at ${urlForLog(devHref)}); recorder ${recorderOk ? 'active' : 'NOT active'}`, 'Synced', recorderOk ? 'Synced' : 'Error');
            this.setSyncState(sessionId, false, 'resynchronized');
            session.uncomparedSteps.push(stepLabel);
            await this.enqueueTask(sessionId, async () => {
                const steps = session.uncomparedSteps.splice(0);
                await this.compareAfterAction(sessionId, steps.length ? steps : [stepLabel]);
            });
            return {
                ok: recorderOk,
                message: recorderOk
                    ? target
                        ? `PROD aligned to ${urlForLog(target)}. Page state such as typed values or open dialogs is not copied.`
                        : `DEV and PROD are both on ${new URL(devHref).origin}; PROD left in place and DEV actions now replicate to it.`
                    : 'PROD aligned, but the DEV recorder could not be re-armed. Reload the DEV window.',
                devUrl: urlForLog(devHref),
                prodUrl: urlForLog(target ?? prodHref),
            };
        }
        catch (err) {
            const message = `PROD navigation failed: ${String(err?.message || err).split('\n')[0]}`;
            this.log(sessionId, `Resync failed: ${message}`, 'Executed', 'Error');
            return { ok: false, message };
        }
    }
    getPhase(sessionId) {
        return this.sessions.get(sessionId)?.phase;
    }
    setPhase(session, phase) {
        session.phase = phase;
        session.isPaused = phase === 'paused';
        this.io?.emit('status', { sessionId: session.id, phase, message: phase });
    }
    /**
     * Start Comparison (valid only from 'ready'): run the start-of-session data checks, align PROD to
     * DEV's current page and run the baseline comparison, then begin replicating DEV actions.
     */
    async startComparison(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning)
            return { ok: false, status: 'not-found', message: 'No active session' };
        if (session.phase !== 'ready' || session.starting) {
            return { ok: false, status: 'bad-phase', phase: session.phase, message: `Session is ${session.starting ? 'starting' : session.phase}, not ready` };
        }
        // The phase stays 'ready' (recorder events dropped) until PROD is aligned; `starting` rejects pause/start meanwhile
        session.starting = true;
        try {
            await this.drainProdLiveInput(session);
            await this.runDataChecks(sessionId);
            const r = await this.performResync(sessionId, 'initial');
            if (!r.ok)
                return { ok: false, status: 'failed', phase: session.phase, message: r.message };
            this.setPhase(session, 'running');
            this.log(sessionId, 'Comparison started', 'Started', 'Started');
            return { ok: true, status: 'ok', phase: session.phase, message: r.message };
        }
        catch (err) {
            const message = `Start failed: ${String(err?.message || err).split('\n')[0]}`;
            this.log(sessionId, message, 'Error', 'Error');
            return { ok: false, status: 'failed', phase: session.phase, message };
        }
        finally {
            session.starting = false;
        }
    }
    /**
     * Pause (running -> paused) or resume (paused -> running). Resume first resyncs PROD to DEV and
     * compares, so drift is caught; if that fails the session stays paused and ok is false.
     */
    async setPaused(sessionId, paused) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning)
            return { ok: false, status: 'not-found', message: 'No active session' };
        const bad = (message) => ({ ok: false, status: 'bad-phase', phase: session.phase, message });
        if (session.starting)
            return bad('Session is starting; wait for Start to finish');
        if (paused) {
            if (session.phase === 'paused')
                return { ok: true, status: 'ok', phase: session.phase, message: 'Already paused' };
            if (session.phase !== 'running')
                return bad(`Cannot pause a session that is ${session.phase}`);
            this.setPhase(session, 'paused');
            this.log(sessionId, 'Session paused', 'OK', 'OK');
            return { ok: true, status: 'ok', phase: session.phase, message: 'Paused' };
        }
        if (session.phase === 'running')
            return { ok: true, status: 'ok', phase: session.phase, message: 'Already running' };
        if (session.phase !== 'paused')
            return bad(`Cannot resume a session that is ${session.phase}`);
        session.starting = true; // also blocks a second resume / a pause while resyncing
        try {
            await this.drainProdLiveInput(session);
            const r = await this.performResync(sessionId, 'resume');
            if (!r.ok)
                return { ok: false, status: 'failed', phase: session.phase, message: r.message };
            this.setPhase(session, 'running');
            this.log(sessionId, 'Session resumed', 'OK', 'OK');
            return { ok: true, status: 'ok', phase: session.phase, message: r.message };
        }
        catch (err) {
            const message = `Resume failed: ${String(err?.message || err).split('\n')[0]}`;
            this.log(sessionId, message, 'Error', 'Error');
            return { ok: false, status: 'failed', phase: session.phase, message };
        }
        finally {
            session.starting = false;
        }
    }
    /**
     * Let direct PROD input that is already being applied finish (bounded) before Start/Resume aligns PROD.
     * Input still queued is skipped by handleLiveInput, since `starting` is set by then.
     */
    async drainProdLiveInput(session) {
        if (!session.prodLiveInputQueue)
            return;
        await Promise.race([session.prodLiveInputQueue, new Promise((r) => setTimeout(r, 5000))]);
    }
    /** Replay one DEV action on PROD. Returns true when the DEV action happened (so a comparison is due). */
    /**
     * After a click that SPA-navigates DEV, bring PROD to the mapped route (and restore clientId).
     * Without this, PROD stays on the old page and later clicks time out or hit the wrong screen.
     */
    async alignProdToDevRoute(sessionId, stepId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.phase !== 'running')
            return;
        await new Promise((r) => setTimeout(r, 150));
        let devHref = '';
        let prodHref = '';
        try {
            devHref = session.devPage.url();
            prodHref = session.prodPage.url();
        }
        catch {
            return;
        }
        const target = mapDevUrlToProd(devHref, session.devUrl, session.prodUrl);
        if (!target)
            return;
        try {
            const want = new URL(target);
            const have = new URL(prodHref);
            const pathDiff = want.pathname.replace(/\/+$/, '') !== have.pathname.replace(/\/+$/, '');
            // Only hard-navigate PROD when the path changed. Query-only (clientId) fixes are soft.
            if (!pathDiff)
                return;
            if (want.pathname.replace(/\/+$/, '') === have.pathname.replace(/\/+$/, ''))
                return;
            await session.prodPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
            this.log(sessionId, `[${stepId}] PROD aligned to ${urlForLog(target)} after DEV route change`, 'Success', 'Success');
        }
        catch (err) {
            this.log(sessionId, `[${stepId}] PROD route align failed: ${String(err?.message || err).split('\n')[0]}`, 'Info', 'Error');
        }
    }
    async replicateAction(sessionId, action, stepId = "manual") {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning || session.phase !== 'running')
            return false;
        const { prodPage } = session;
        const label = action.testId || action.ariaLabel || action.labelText || action.text || action.name || action.selector || action.type;
        // Checkbox/radio "change" events arrive as fill; the click event already replicates them.
        if ((action.type === 'fill' || action.type === 'input') && /^(checkbox|radio)$/.test(action.inputType || '')) {
            return false;
        }
        // A one-time code (2-step verification) is single-use: DEV has just used it, so replaying it on PROD is
        // rejected by the identity provider (and can flag the account). Pause instead, so the PROD pane unlocks and
        // the user signs PROD in with its own fresh code; Start again then resumes mirroring.
        if ((action.type === 'fill' || action.type === 'input') && action.isOneTimeCode) {
            this.setPhase(session, 'paused');
            const notice = `⏸ Paused for 2-step verification: DEV entered a one-time code, which cannot be reused on PROD. ` +
                `Enter PROD's own code in the PROD pane and finish signing in there, then press Start again.`;
            this.log(sessionId, `[${stepId}] One-time code not replayed on PROD (single-use) — session paused`, 'Captured', 'Skipped');
            this.io?.emit('status', { sessionId, phase: 'paused', message: 'paused', notice });
            return false;
        }
        try {
            const verdict = this.evaluateAction(session, action);
            if (!verdict.allow) {
                this.log(sessionId, `Skipped on PROD (${session.safetyPolicy}): ${action.type} "${label}" — ${verdict.reason}`, 'Executed', 'Blocked');
                this.recordMismatch(sessionId, {
                    component: label,
                    type: 'Safety',
                    classification: 'SKIPPED_BY_SAFETY_POLICY',
                    replayStatus: 'SKIPPED',
                    devValue: `${action.type} executed on DEV`,
                    prodValue: 'Not replayed on PROD',
                    severity: 'low',
                    stepIds: [stepId],
                    description: `Not replayed on PROD: ${verdict.reason}. Add a matching entry to the profile's safety allowlist if this action is safe to repeat in PROD.`,
                });
                return true;
            }
            if (verdict.allowlisted) {
                session.permitMutationsUntil = Date.now() + ALLOWLIST_PERMIT_WINDOW_MS;
                this.log(sessionId, `Allowlisted action "${label}" (rule: ${verdict.reason}) — PROD writes permitted for ${ALLOWLIST_PERMIT_WINDOW_MS / 1000}s`, 'Executed', 'Permitted');
            }
            this.log(sessionId, `[${stepId}] Replicating ${action.type}: ${label}`, 'Captured', 'Replaying');
            switch (action.type) {
                case 'click': {
                    const target = await this.resolveProdTarget(prodPage, action);
                    if (!target.ok)
                        return this.recordReplayFailure(sessionId, action, label, stepId, target.classification, target.detail);
                    if (!(await target.locator.isEnabled().catch(() => true))) {
                        return this.recordReplayFailure(sessionId, action, label, stepId, 'REPLAY_FAILURE', `PROD element "${label}" (matched by ${target.strategy}) is disabled; it was enabled on DEV`);
                    }
                    await target.locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
                    await target.locator.click({ timeout: 8000 }); // no force: respect PROD actionability
                    this.log(sessionId, `Clicked ${label} (matched by ${target.strategy})`, 'Success', 'Success');
                    await this.alignProdToDevRoute(sessionId, stepId);
                    break;
                }
                case 'dblclick': {
                    const target = await this.resolveProdTarget(prodPage, action);
                    if (!target.ok)
                        return this.recordReplayFailure(sessionId, action, label, stepId, target.classification, target.detail);
                    await target.locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
                    await target.locator.dblclick({ timeout: 8000 });
                    this.log(sessionId, `Double-clicked ${label} (matched by ${target.strategy})`, 'Success', 'Success');
                    await this.alignProdToDevRoute(sessionId, stepId);
                    break;
                }
                case 'hover': {
                    const target = await this.resolveProdTarget(prodPage, action);
                    if (!target.ok)
                        return this.recordReplayFailure(sessionId, action, label, stepId, target.classification, target.detail);
                    await target.locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
                    await target.locator.hover({ timeout: 8000 });
                    this.log(sessionId, `Hovered ${label} (matched by ${target.strategy})`, 'Success', 'Success');
                    break;
                }
                case 'key': {
                    const key = action.key || '';
                    if (!key)
                        break;
                    const combo = [action.ctrl && 'Control', action.alt && 'Alt', action.meta && 'Meta', action.shift && 'Shift', key]
                        .filter(Boolean)
                        .join('+');
                    const focusable = action.tag && !/^(body|html)$/.test(action.tag);
                    const target = focusable ? await this.resolveProdTarget(prodPage, action) : null;
                    if (target && !target.ok) {
                        return this.recordReplayFailure(sessionId, action, label, stepId, target.classification, target.detail);
                    }
                    if (target && target.ok) {
                        await target.locator.press(combo, { timeout: 5000 });
                        this.log(sessionId, `Pressed ${combo} on ${label} (matched by ${target.strategy})`, 'Success', 'Success');
                    }
                    else {
                        await prodPage.keyboard.press(combo);
                        this.log(sessionId, `Pressed ${combo} (page keyboard)`, 'Success', 'Success');
                    }
                    break;
                }
                case 'fill':
                case 'input': {
                    const target = await this.resolveProdTarget(prodPage, action);
                    if (!target.ok)
                        return this.recordReplayFailure(sessionId, action, label, stepId, target.classification, target.detail);
                    const value = action.value ?? '';
                    if (action.tag === 'select') {
                        await target.locator.selectOption(value, { timeout: 5000 });
                    }
                    else {
                        await target.locator.fill(value, { timeout: 5000 });
                    }
                    this.log(sessionId, `Filled ${label}${action.isSensitive ? ' (sensitive value hidden)' : ''} (matched by ${target.strategy})`, 'Success', 'Success');
                    break;
                }
                case 'navigate': {
                    if (!action.url)
                        break;
                    const prodUrl = mapDevUrlToProd(action.url, session.devUrl, session.prodUrl);
                    if (!prodUrl) {
                        // Shared outside host (SSO/login): PROD gets there itself through the replayed clicks/submits, so give
                        // its own redirect a moment to land rather than copying DEV's (token-bearing) URL over.
                        const devOrigin = (() => {
                            try {
                                return new URL(action.url).origin;
                            }
                            catch {
                                return '';
                            }
                        })();
                        const sameHost = () => onSharedOutsideHost(action.url, prodPage.url(), session.devUrl, session.prodUrl);
                        if (devOrigin && !sameHost()) {
                            await prodPage
                                .waitForURL((u) => u.origin === devOrigin, { timeout: 5000, waitUntil: 'commit' })
                                .catch(() => { });
                        }
                        if (sameHost()) {
                            this.log(sessionId, `DEV moved to ${urlForLog(action.url)} on the shared host; PROD is on the same host (followed)`, 'Success', 'Success');
                            break;
                        }
                        this.log(sessionId, `Navigation not replayed: ${urlForLog(action.url)} is outside the DEV base URL`, 'Executed', 'Skipped');
                        this.recordMismatch(sessionId, {
                            component: urlForLog(action.url),
                            type: 'Navigation',
                            classification: 'NOT_COMPARABLE',
                            replayStatus: 'SKIPPED',
                            devValue: urlForLog(action.url),
                            prodValue: '(not navigated)',
                            severity: 'low',
                            description: 'DEV navigated outside its configured base URL; PROD was not navigated (it is never sent to DEV or third-party hosts).',
                        });
                        this.setSyncState(sessionId, true, `DEV left its base URL (${urlForLog(action.url)})`);
                        return false;
                    }
                    await prodPage.goto(prodUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    this.log(sessionId, `Navigated PROD to ${urlForLog(prodUrl)}`, 'Success', 'Success');
                    break;
                }
                case 'scroll': {
                    // Prefer wheel deltas (nested SPA scrollers). Fall back to window scroll position.
                    const dx = Number(action.deltaX) || 0;
                    const dy = Number(action.deltaY) || 0;
                    if (dx || dy) {
                        const { width: vw, height: vh } = session.capture.viewport;
                        const mx = Number.isFinite(Number(action.x)) ? Math.min(Math.max(Number(action.x), 0), vw - 1) : Math.floor(vw / 2);
                        const my = Number.isFinite(Number(action.y)) ? Math.min(Math.max(Number(action.y), 0), vh - 1) : Math.floor(vh / 2);
                        await this.applyWheelAt(prodPage, mx, my, Math.max(-3000, Math.min(3000, dx)), Math.max(-3000, Math.min(3000, dy)));
                    }
                    else {
                        const y = Number(action.y) || 0;
                        const x = Number(action.x) || 0;
                        await prodPage.evaluate(({ sx, sy }) => {
                            window.scrollTo(sx, sy);
                            const se = document.scrollingElement || document.documentElement;
                            if (se && se !== document.body)
                                se.scrollTo(sx, sy);
                        }, { sx: x, sy: y });
                    }
                    this.log(sessionId, `Scrolled`, 'Success', 'Success');
                    break;
                }
                default:
                    this.log(sessionId, `Unsupported action: ${action.type}`, 'Skipped', 'Skipped');
            }
            return true;
        }
        catch (error) {
            const message = redactValue(error?.message || String(error), action).split('\n')[0];
            console.error('Action replication failed:', message);
            return this.recordReplayFailure(sessionId, action, label, stepId, 'REPLAY_FAILURE', message);
        }
    }
    recordReplayFailure(sessionId, action, label, stepId, classification, detail) {
        this.log(sessionId, `[${stepId}] Replay failed (${classification}): ${action.type} "${label}" — ${detail}`, 'Success', 'Error');
        this.recordMismatch(sessionId, {
            component: label,
            type: 'Interaction',
            classification,
            replayStatus: 'FAILED',
            devValue: `${action.type} executed`,
            prodValue: classification === 'UNMAPPED_OR_MISSING_FEATURE' ? 'No equivalent element' : 'Failed to replicate',
            severity: 'high',
            description: detail,
            stepIds: [stepId],
        });
        return true;
    }
    /** Decide whether a captured DEV action may be replayed on PROD. */
    evaluateAction(session, action) {
        if (session.safetyPolicy === 'full')
            return { allow: true, reason: 'full policy', allowlisted: false };
        // A double-click is two clicks; Enter in a form submits it. Hover and other keys never mutate.
        const mutating = action.type === 'click' || action.type === 'dblclick' || (action.type === 'key' && !!action.isSubmit);
        if (!mutating) {
            // Typing, scrolling and in-base navigation (GET) do not mutate server state;
            // any request they trigger still goes through the network guard.
            return { allow: true, reason: 'non-mutating', allowlisted: false };
        }
        const hay = [action.text, action.ariaLabel, action.labelText, action.testId, action.name, action.elementId, action.href]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        const rule = session.safetyAllowlist.find((e) => !e.startsWith('url:') && hay.includes(e));
        if (rule)
            return { allow: true, reason: rule, allowlisted: true };
        const destructive = hay.match(DESTRUCTIVE_ACTION_RE);
        if (destructive) {
            return { allow: false, reason: `destructive keyword "${destructive[0]}"`, allowlisted: false };
        }
        if (session.safetyPolicy === 'read-only' && action.isSubmit) {
            return { allow: false, reason: 'form submission is blocked in read-only mode', allowlisted: false };
        }
        return { allow: true, reason: 'safe click', allowlisted: false };
    }
    /**
     * Find the single PROD element equivalent to the DEV target.
     * Priority: test id > id > role+accessible name > label > name > placeholder > aria-label > input type.
     * A candidate is used only when it resolves to exactly one element (optionally narrowed by
     * DEV text). Ambiguous or missing matches are reported — never clicked blindly.
     */
    async resolveProdTarget(page, action) {
        const q = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const tag = action.tag && /^[a-z][a-z0-9-]*$/.test(action.tag) ? action.tag : '';
        const candidates = [];
        if (action.testId)
            candidates.push({ strategy: 'test-id', locator: page.locator(`[data-testid="${q(action.testId)}"]`) });
        if (action.elementId)
            candidates.push({ strategy: 'id', locator: page.locator(`[id="${q(action.elementId)}"]`) });
        const accName = action.ariaLabel || action.text;
        if (action.role && accName) {
            candidates.push({
                strategy: 'role+name',
                locator: page.getByRole(action.role, { name: accName, exact: true }),
            });
        }
        if (action.labelText)
            candidates.push({ strategy: 'label', locator: page.getByLabel(action.labelText, { exact: true }) });
        if (action.name)
            candidates.push({ strategy: 'name', locator: page.locator(`${tag}[name="${q(action.name)}"]`) });
        if (action.placeholder)
            candidates.push({ strategy: 'placeholder', locator: page.locator(`${tag}[placeholder="${q(action.placeholder)}"]`) });
        if (action.ariaLabel)
            candidates.push({ strategy: 'aria-label', locator: page.locator(`${tag}[aria-label="${q(action.ariaLabel)}"]`) });
        if (tag === 'input' && action.inputType && !/^(submit|button|reset|image|hidden)$/.test(action.inputType)) {
            candidates.push({ strategy: 'structural (input type)', locator: page.locator(`input[type="${q(action.inputType)}"]`) });
        }
        if (candidates.length === 0) {
            return {
                ok: false,
                classification: 'UNMAPPED_OR_MISSING_FEATURE',
                detail: 'DEV element has no stable identifier (test id, id, role+name, label, name, placeholder). Add a data-testid to both environments.',
            };
        }
        const ambiguous = [];
        for (const c of candidates) {
            let n = 0;
            try {
                n = await c.locator.count();
            }
            catch {
                continue;
            }
            if (n === 1)
                return { ok: true, locator: c.locator, strategy: c.strategy };
            if (n > 1) {
                if (action.text) {
                    const narrowed = c.locator.filter({ hasText: action.text });
                    if ((await narrowed.count().catch(() => 0)) === 1) {
                        return { ok: true, locator: narrowed, strategy: `${c.strategy}+text` };
                    }
                }
                ambiguous.push(`${c.strategy} → ${n} matches`);
            }
        }
        if (ambiguous.length) {
            return {
                ok: false,
                classification: 'REPLAY_FAILURE',
                detail: `Ambiguous match on PROD (${ambiguous.join('; ')}); not clicked. Add a unique data-testid.`,
            };
        }
        return {
            ok: false,
            classification: 'UNMAPPED_OR_MISSING_FEATURE',
            detail: `No PROD element matched (tried ${candidates.map((c) => c.strategy).join(', ')}).`,
        };
    }
    /** Extract structured, human-readable text/content from a page for exact diffs */
    async extractPageContent(page) {
        return page.evaluate((sensitiveSource) => {
            const texts = [];
            const fonts = [];
            const values = [];
            const images = [];
            const seen = new Set();
            const seenFont = new Set();
            const sensitiveRe = new RegExp(sensitiveSource, 'i');
            /** Never read the value of password / secret-looking fields into evidence. */
            const fieldText = (el) => {
                const input = el;
                const hay = [el.getAttribute('name'), el.id, el.getAttribute('autocomplete')].join(' ');
                const isField = /^(input|textarea|select)$/i.test(el.tagName);
                if (isField && ((input.type || '').toLowerCase() === 'password' || sensitiveRe.test(hay))) {
                    return input.placeholder ? `${input.placeholder} [value redacted]` : '[sensitive field — value redacted]';
                }
                if (isField)
                    return input.value || input.placeholder || '';
                return el.getAttribute('placeholder') || el.textContent || '';
            };
            const clean = (s) => (s || '')
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/(\d)([A-Za-z])/g, '$1 $2')
                .replace(/([A-Za-z])(\d)/g, '$1 $2')
                .replace(/\$/g, ' $')
                .replace(/\s+/g, ' ')
                .trim();
            const push = (label, text, tag, testId = '') => {
                const t = clean(text);
                if (!t || t.length < 1)
                    return;
                if (t.length === 1 && !/[0-9a-zA-Z]/.test(t))
                    return;
                const key = `${testId || label}|${t}`.toLowerCase();
                if (seen.has(key))
                    return;
                seen.add(key);
                texts.push({
                    key: testId || label || tag,
                    label: label || tag,
                    text: t.slice(0, 500),
                    tag,
                    testId: testId || '',
                });
            };
            document.querySelectorAll('[data-testid]').forEach((el) => {
                const testId = el.getAttribute('data-testid') || '';
                push(testId, fieldText(el), el.tagName.toLowerCase(), testId);
            });
            const selectors = [
                'h1', 'h2', 'h3', 'h4', 'button', 'a', 'label', '[role="button"]',
                'input', 'textarea', 'select', 'p', 'th', 'td', 'li',
                '.dev-banner', '.prod-banner', '[class*="banner"]',
            ];
            document.querySelectorAll(selectors.join(',')).forEach((el, index) => {
                const tag = el.tagName.toLowerCase();
                const testId = el.getAttribute('data-testid') || '';
                if (testId)
                    return;
                if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                    const input = el;
                    push(input.name || input.id || input.type || `input-${index}`, fieldText(el) || input.name || input.type || '', tag, '');
                }
                else {
                    const text = el.textContent || '';
                    push(clean(text).slice(0, 40) || `${tag}-${index}`, text, tag, '');
                }
            });
            document.querySelectorAll('div, span').forEach((el) => {
                const t = clean(el.textContent || '');
                if (!t || t.length > 40)
                    return;
                if (/^\$?[\d,.]+[MkK]?$/.test(t) || /users|revenue|active/i.test(t)) {
                    push(t.slice(0, 30), t, el.tagName.toLowerCase(), '');
                }
            });
            // Field values (explicit Value category)
            document.querySelectorAll('input, textarea, select').forEach((el, i) => {
                const input = el;
                const hay = [input.name, input.id, input.getAttribute('autocomplete')].join(' ');
                const type = (input.type || tagOf(el) || '').toLowerCase();
                const name = input.name || input.id || input.getAttribute('data-testid') || `field-${i}`;
                let value = '';
                if (type === 'password' || sensitiveRe.test(hay))
                    value = input.value ? '[redacted]' : '';
                else if (type === 'checkbox' || type === 'radio')
                    value = input.checked ? 'checked' : 'unchecked';
                else
                    value = (input.value || '').slice(0, 200);
                values.push({ key: String(name).slice(0, 80), name: String(name).slice(0, 80), value, inputType: type || 'text' });
            });
            function tagOf(el) {
                return el.tagName.toLowerCase();
            }
            // Fonts on visible headings, buttons, labels, and main text
            const fontSel = 'h1,h2,h3,h4,button,a,label,p,span,th,td,li,[role="button"],[data-testid]';
            document.querySelectorAll(fontSel).forEach((el, i) => {
                try {
                    const he = el;
                    const rect = he.getBoundingClientRect();
                    if (rect.width < 4 || rect.height < 4)
                        return;
                    const cs = getComputedStyle(he);
                    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0)
                        return;
                    const text = clean(he.innerText || he.textContent || '').slice(0, 60);
                    if (!text)
                        return;
                    const fontFamily = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
                    const fontSize = cs.fontSize || '';
                    const fontWeight = cs.fontWeight || '';
                    const color = cs.color || '';
                    const key = he.getAttribute('data-testid') ||
                        he.id ||
                        `${he.tagName.toLowerCase()}:${text.slice(0, 24)}`;
                    const sig = `${key}|${fontFamily}|${fontSize}|${fontWeight}|${color}`;
                    if (seenFont.has(sig))
                        return;
                    seenFont.add(sig);
                    fonts.push({
                        key: String(key).slice(0, 80),
                        text,
                        fontFamily,
                        fontSize,
                        fontWeight,
                        color,
                    });
                }
                catch {
                    /* ignore */
                }
            });
            // Images (src path + alt) — skip tiny icons / tracking pixels
            document.querySelectorAll('img').forEach((el, i) => {
                const img = el;
                const rect = img.getBoundingClientRect();
                if (rect.width < 12 || rect.height < 12)
                    return;
                let src = img.currentSrc || img.src || img.getAttribute('src') || '';
                try {
                    const u = new URL(src, document.baseURI);
                    src = u.pathname + (u.search ? '?…' : '');
                }
                catch {
                    src = src.split(/[?#]/)[0].slice(-120);
                }
                const alt = (img.alt || img.title || '').trim().slice(0, 120);
                const key = img.getAttribute('data-testid') || img.id || src || `img-${i}`;
                images.push({
                    key: String(key).slice(0, 100),
                    src: src.slice(0, 200),
                    alt,
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                });
            });
            return {
                texts: texts.slice(0, 200),
                fonts: fonts.slice(0, 80),
                values: values.slice(0, 80),
                images: images.slice(0, 40),
            };
        }, extract_1.SENSITIVE_FIELD_RE.source);
    }
    diffPageContent(devPackOrItems, prodPackOrItems) {
        const emptyPack = { texts: [], fonts: [], values: [], images: [] };
        const devPack = Array.isArray(devPackOrItems)
            ? { ...emptyPack, texts: devPackOrItems }
            : { ...emptyPack, ...devPackOrItems };
        const prodPack = Array.isArray(prodPackOrItems)
            ? { ...emptyPack, texts: prodPackOrItems }
            : { ...emptyPack, ...prodPackOrItems };
        const devItems = devPack.texts;
        const prodItems = prodPack.texts;
        const diffs = [];
        const normalizeKey = (item) => {
            if (item.testId)
                return `testid:${item.testId}`;
            // Group by tag + rough role so "Sign In to Development" maps near "Sign In to Production"
            const text = item.text.toLowerCase();
            if (item.tag === 'button' || item.tag === 'a') {
                if (/sign in|log in|login/.test(text))
                    return 'action:login-submit';
                if (/continue|dashboard/.test(text))
                    return 'action:continue';
                if (/report/.test(text))
                    return 'action:reports';
                if (/add user|add test|simulate/.test(text))
                    return 'action:add-user';
                if (/logout/.test(text))
                    return 'action:logout';
            }
            if (item.tag === 'input') {
                if (/email|@/.test(text) || item.key.includes('email'))
                    return 'field:email';
                if (/password|•/.test(text) || item.key.includes('password'))
                    return 'field:password';
            }
            if (/development environment|production environment/.test(text))
                return 'banner:environment';
            if (/login to/.test(text))
                return 'heading:login';
            if (/welcome/.test(text))
                return 'heading:welcome';
            if (/active users/.test(text))
                return 'label:active-users';
            if (/revenue/.test(text))
                return 'label:revenue';
            if (/^[\d,]+$/.test(text) && text.length >= 3)
                return `metric:number:${item.tag}`;
            if (/^\$[\d.]+m$/i.test(text))
                return 'metric:revenue-value';
            return `${item.tag}:${item.key}`.toLowerCase().slice(0, 80);
        };
        const devMap = new Map();
        for (const item of devItems) {
            const k = normalizeKey(item);
            if (!devMap.has(k))
                devMap.set(k, []);
            devMap.get(k).push(item);
        }
        const prodMap = new Map();
        for (const item of prodItems) {
            const k = normalizeKey(item);
            if (!prodMap.has(k))
                prodMap.set(k, []);
            prodMap.get(k).push(item);
        }
        const allKeys = new Set([...devMap.keys(), ...prodMap.keys()]);
        for (const key of allKeys) {
            const dList = devMap.get(key) || [];
            const pList = prodMap.get(key) || [];
            const dText = dList.map((x) => x.text).join(' | ');
            const pText = pList.map((x) => x.text).join(' | ');
            if (!dText && !pText)
                continue;
            if (dText === pText)
                continue;
            // Ignore pure structural empties
            if (!dText || !pText) {
                // Only report missing-on-one-side for important keys
                if (!key.startsWith('testid:') && !key.startsWith('action:') && !key.startsWith('heading:') && !key.startsWith('banner:')) {
                    continue;
                }
            }
            const component = dList[0]?.testId ||
                pList[0]?.testId ||
                dList[0]?.label ||
                pList[0]?.label ||
                key;
            let severity = 'medium';
            if (key.startsWith('banner:') || key.startsWith('heading:') || key.startsWith('action:login')) {
                severity = 'high';
            }
            if (key.startsWith('metric:') || key.includes('users')) {
                severity = 'medium';
            }
            diffs.push({
                component: String(component).slice(0, 80),
                type: 'Text',
                devValue: dText || '(missing on DEV)',
                prodValue: pText || '(missing on PROD)',
                severity,
                description: `Exact text differs for "${component}". DEV shows exactly: "${dText || '(none)'}". PROD shows exactly: "${pText || '(none)'}".`,
            });
        }
        // Also catch text present only in one environment (unique strings)
        const devOnly = new Set(devItems.map((i) => i.text));
        const prodOnly = new Set(prodItems.map((i) => i.text));
        const uniqueDev = [...devOnly].filter((t) => t.length > 8 && !prodOnly.has(t));
        const uniqueProd = [...prodOnly].filter((t) => t.length > 8 && !devOnly.has(t));
        // Pair unique strings that look related (share first word / sign-in pattern)
        const usedProd = new Set();
        for (const d of uniqueDev.slice(0, 30)) {
            // Skip if already covered by key-based diff
            if (diffs.some((x) => x.devValue.includes(d)))
                continue;
            const related = uniqueProd.find((p) => {
                if (usedProd.has(p))
                    return false;
                const dw = d.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
                const pw = p.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
                return dw === pw || (d.length > 12 && p.length > 12 && (d.includes(p.slice(0, 8)) || p.includes(d.slice(0, 8))));
            });
            if (related) {
                usedProd.add(related);
                diffs.push({
                    component: d.slice(0, 40),
                    type: 'Text',
                    devValue: d,
                    prodValue: related,
                    severity: 'high',
                    description: `Exact on-screen copy differs between environments. DEV text: "${d}". PROD text: "${related}".`,
                });
            }
        }
        // Fonts
        const fontMap = (list) => {
            const m = new Map();
            for (const f of list || [])
                if (!m.has(f.key))
                    m.set(f.key, f);
            return m;
        };
        const dFonts = fontMap(devPack.fonts);
        const pFonts = fontMap(prodPack.fonts);
        for (const key of new Set([...dFonts.keys(), ...pFonts.keys()])) {
            const d = dFonts.get(key);
            const p = pFonts.get(key);
            if (!d || !p)
                continue;
            const parts = [];
            if (d.fontFamily !== p.fontFamily)
                parts.push(`family DEV=${d.fontFamily || '(none)'} PROD=${p.fontFamily || '(none)'}`);
            if (d.fontSize !== p.fontSize)
                parts.push(`size DEV=${d.fontSize || '(none)'} PROD=${p.fontSize || '(none)'}`);
            if (d.fontWeight !== p.fontWeight)
                parts.push(`weight DEV=${d.fontWeight || '(none)'} PROD=${p.fontWeight || '(none)'}`);
            if (d.color !== p.color)
                parts.push(`color DEV=${d.color || '(none)'} PROD=${p.color || '(none)'}`);
            if (!parts.length)
                continue;
            diffs.push({
                component: (d.text || key).slice(0, 80),
                type: 'CSS',
                devValue: `${d.fontFamily} ${d.fontSize}/${d.fontWeight} ${d.color}`.trim(),
                prodValue: `${p.fontFamily} ${p.fontSize}/${p.fontWeight} ${p.color}`.trim(),
                severity: 'medium',
                description: `Font differs on "${(d.text || key).slice(0, 40)}": ${parts.join('; ')}`,
            });
        }
        // Field values
        const valMap = (list) => {
            const m = new Map();
            for (const v of list || []) {
                const k = `${v.inputType}|${v.key}`.toLowerCase();
                if (!m.has(k))
                    m.set(k, v);
            }
            return m;
        };
        const dVals = valMap(devPack.values);
        const pVals = valMap(prodPack.values);
        for (const key of new Set([...dVals.keys(), ...pVals.keys()])) {
            const d = dVals.get(key);
            const p = pVals.get(key);
            const dValue = d?.value ?? '(missing on DEV)';
            const pValue = p?.value ?? '(missing on PROD)';
            if (dValue === pValue)
                continue;
            if ((!d?.value && !p?.value) || (dValue === '[redacted]' && pValue === '[redacted]'))
                continue;
            const name = d?.name || p?.name || key;
            diffs.push({
                component: String(name).slice(0, 80),
                type: 'Data',
                devValue: dValue,
                prodValue: pValue,
                severity: 'medium',
                description: `Field value differs for "${name}" (${d?.inputType || p?.inputType || 'input'}). DEV="${dValue}". PROD="${pValue}".`,
            });
        }
        // Images
        const imgMap = (list) => {
            const m = new Map();
            for (const im of list || []) {
                const k = im.key || im.src;
                if (!m.has(k))
                    m.set(k, im);
            }
            return m;
        };
        const dImgs = imgMap(devPack.images);
        const pImgs = imgMap(prodPack.images);
        for (const key of new Set([...dImgs.keys(), ...pImgs.keys()])) {
            const d = dImgs.get(key);
            const p = pImgs.get(key);
            if (d && !p) {
                diffs.push({
                    component: (d.alt || d.src || key).slice(0, 80),
                    type: 'Visual',
                    devValue: `img ${d.src} (${d.w}x${d.h}) alt="${d.alt}"`,
                    prodValue: '(missing on PROD)',
                    severity: 'medium',
                    description: `Image present on DEV only: ${d.src || key}`,
                });
                continue;
            }
            if (p && !d) {
                diffs.push({
                    component: (p.alt || p.src || key).slice(0, 80),
                    type: 'Visual',
                    devValue: '(missing on DEV)',
                    prodValue: `img ${p.src} (${p.w}x${p.h}) alt="${p.alt}"`,
                    severity: 'medium',
                    description: `Image present on PROD only: ${p.src || key}`,
                });
                continue;
            }
            if (!d || !p)
                continue;
            if (d.src === p.src && d.alt === p.alt)
                continue;
            diffs.push({
                component: (d.alt || d.src || key).slice(0, 80),
                type: 'Visual',
                devValue: `${d.src} alt="${d.alt}" ${d.w}x${d.h}`,
                prodValue: `${p.src} alt="${p.alt}" ${p.w}x${p.h}`,
                severity: 'medium',
                description: `Image differs for "${(d.alt || key).slice(0, 40)}": DEV src/alt vs PROD src/alt.`,
            });
        }
        // De-dupe by type+dev+prod pair
        const seen = new Set();
        return diffs.filter((d) => {
            const k = `${d.type}|${d.devValue}||${d.prodValue}`;
            if (seen.has(k))
                return false;
            seen.add(k);
            return true;
        }).slice(0, 80);
    }
    /** Wait until a page has a parsed document and its UI has had a moment to settle. */
    async waitForSettled(page, settleMs) {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        // Skip networkidle by default: SPAs with long-poll/SignalR never go idle and stall every step.
        if (process.env.QA_VISION_WAIT_NETWORKIDLE === '1') {
            await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => { });
        }
        const ms = Math.min(Math.max(0, settleMs), compareMode() === "full" ? 2000 : compareMode() === "standard" ? 600 : 400);
        if (ms > 0)
            await page.waitForTimeout(ms);
    }
    /**
     * Capture and compare DEV vs PROD. `steps` lists every step this comparison covers
     * (several when actions arrived in a burst).
     */
    async compareAfterAction(sessionId, steps = ['manual']) {
        const session = this.sessions.get(sessionId);
        if (!session || session.devPage.isClosed() || session.prodPage.isClosed())
            return;
        const stepLabel = steps.length > 3 ? `${steps[0]}…${steps[steps.length - 1]} (${steps.length} steps)` : steps.join(', ');
        try {
            await Promise.all([this.waitForSettled(session.devPage, session.capture.settleMs), this.waitForSettled(session.prodPage, session.capture.settleMs)]);
            // Out-of-sync detection: PROD should be on the page equivalent to DEV's
            const expectedProd = mapDevUrlToProd(session.devPage.url(), session.devUrl, session.prodUrl);
            const normalizeUrl = (u) => (u || '').replace(/\/+$/, '').replace(/#.*$/, '');
            if (expectedProd && normalizeUrl(expectedProd) !== normalizeUrl(session.prodPage.url())) {
                if (!session.outOfSync) {
                    this.log(sessionId, `OUT OF SYNC after ${stepLabel}: DEV at ${urlForLog(session.devPage.url())}, PROD at ${urlForLog(session.prodPage.url())} — use Resynchronize`, 'Executed', 'Error');
                }
                this.setSyncState(sessionId, true, `PROD at ${urlForLog(session.prodPage.url())}, expected ${urlForLog(expectedProd)}`);
            }
            else if (expectedProd) {
                if (session.outOfSync)
                    this.log(sessionId, `Back in sync after ${stepLabel}`, 'Synced', 'Synced');
                this.setSyncState(sessionId, false, 'in sync');
            }
            const cap = session.capture;
            if (cap.scopeSelector) {
                const [devHas, prodHas] = await Promise.all([
                    session.devPage.locator(cap.scopeSelector).count().catch(() => 0),
                    session.prodPage.locator(cap.scopeSelector).count().catch(() => 0),
                ]);
                if (!devHas || !prodHas) {
                    const missing = [!devHas ? 'DEV' : '', !prodHas ? 'PROD' : ''].filter(Boolean).join(' and ');
                    this.recordMismatch(sessionId, {
                        component: `Comparison scope ${cap.scopeSelector}`,
                        type: 'Navigation',
                        devValue: devHas ? 'scope element present' : 'scope element missing',
                        prodValue: prodHas ? 'scope element present' : 'scope element missing',
                        severity: 'medium',
                        classification: 'NOT_COMPARABLE',
                        description: `Scope selector "${cap.scopeSelector}" was not found on ${missing}; this step could not be compared.`,
                    });
                    this.log(sessionId, `Compared after ${stepLabel}: scope "${cap.scopeSelector}" missing on ${missing} - NOT_COMPARABLE`, 'Captured', 'Differences');
                    return;
                }
            }
            // Viewport PNG (not fullPage): full-page shots are huge and freeze the live SPA while capturing.
            const shoot = (page) => {
                const shotOpts = {
                    type: 'png',
                    mask: cap.maskSelectors.map((m) => page.locator(m)),
                    timeout: 5000,
                    animations: 'disabled',
                };
                return cap.scopeSelector
                    ? page.locator(cap.scopeSelector).first().screenshot(shotOpts)
                    : page.screenshot({ ...shotOpts, fullPage: !!cap.fullPage && fullCompareEnabled() });
            };
            const stamp = Date.now();
            const [devScreenshot, prodScreenshot, devContent, prodContent] = await Promise.all([
                shoot(session.devPage),
                shoot(session.prodPage),
                this.extractPageContent(session.devPage),
                this.extractPageContent(session.prodPage),
            ]);
            const devPath = path.join(session.evidenceDir, `dev-${stamp}.png`);
            const prodPath = path.join(session.evidenceDir, `prod-${stamp}.png`);
            await Promise.all([fs.promises.writeFile(devPath, devScreenshot), fs.promises.writeFile(prodPath, prodScreenshot)]);
            const { ratio, diffPath, sideBySidePath } = await this.compareScreenshots(devScreenshot, prodScreenshot, path.join(session.evidenceDir, `diff-${stamp}.png`), path.join(session.evidenceDir, `side-by-side-${stamp}.png`), cap.pixelThreshold);
            const evidence = {
                devScreenshotPath: devPath,
                prodScreenshotPath: prodPath,
                diffScreenshotPath: sideBySidePath || diffPath,
                diffPercent: ratio,
                stepIds: steps,
            };
            // 1) Text differences, after the profile's ignore rules
            const rawDiffs = this.diffPageContent(devContent, prodContent);
            const suppressed = [];
            const textDiffs = rawDiffs.filter((d) => {
                if (!session.ignore.active)
                    return true;
                const excludedBy = session.ignore.exclude(d);
                if (excludedBy) {
                    suppressed.push(`${d.component} (${excludedBy})`);
                    return false;
                }
                if (session.ignore.normalize(d.devValue) === session.ignore.normalize(d.prodValue)) {
                    suppressed.push(`${d.component} (normalized)`);
                    return false;
                }
                return true;
            });
            let added = 0;
            let repeated = 0;
            const tally = (isNew) => (isNew ? added++ : repeated++);
            const counts = { Text: 0, DOM: 0, CSS: 0, Layout: 0, Accessibility: 0, Data: 0, Network: 0, Console: 0 };
            for (const td of textDiffs) {
                const isNew = this.recordMismatch(sessionId, { ...td, ...evidence });
                tally(isNew);
                if (isNew)
                    counts.Text++;
            }
            // 1b) Structural: standard (default) = DOM presence + CSS fonts; full adds a11y/data depth
            const budgetStart = Date.now();
            const budgetMs = comparisonBudgetMs();
            let budgetExceeded = false;
            let structuralFailure = '';
            let timer;
            const deferLogs = session.pendingActions > 0;
            if (!standardCompareEnabled()) {
                if (!deferLogs) {
                    for (const d of [
                        ...(0, runtime_diff_1.diffNetwork)(session.netLog.dev.splice(0), session.netLog.prod.splice(0)),
                        ...(0, runtime_diff_1.diffRuntime)(session.runtimeLog.dev.splice(0), session.runtimeLog.prod.splice(0)),
                    ]) {
                        if (session.ignore.active) {
                            const excludedBy = session.ignore.exclude(d);
                            if (excludedBy)
                                continue;
                            if (session.ignore.normalize(d.devValue) === session.ignore.normalize(d.prodValue))
                                continue;
                        }
                        const isNew = this.recordMismatch(sessionId, { ...d, ...evidence });
                        tally(isNew);
                        if (isNew)
                            counts[d.type] = (counts[d.type] || 0) + 1;
                    }
                }
            }
            else {
                try {
                    const extractArg = {
                        scopeSelector: cap.scopeSelector,
                        maxElements: fullCompareEnabled() ? 150 : 90,
                        maxRows: fullCompareEnabled() ? 30 : 15,
                        sensitiveSource: extract_1.SENSITIVE_FIELD_RE.source,
                        styleProps: fullCompareEnabled() ? [...extract_1.STYLE_PROPS] : [...LIVE_FONT_STYLE_PROPS],
                        attrAllowlist: [...extract_1.ATTR_ALLOWLIST],
                    };
                    const timeout = (p) => Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('budget')), budgetMs); })]);
                    const [devSnap, prodSnap] = await timeout(Promise.all([session.devPage.evaluate(extract_1.extractPageSnapshot, extractArg), session.prodPage.evaluate(extract_1.extractPageSnapshot, extractArg)]));
                    const { pairs } = (0, dom_diff_1.pairElements)(devSnap.elements, prodSnap.elements);
                    const drafts = [
                        ...(0, dom_diff_1.diffDom)(devSnap.elements, prodSnap.elements),
                        ...(0, css_diff_1.diffCss)(pairs, { layoutTolerancePx: cap.layoutTolerancePx }),
                        ...(fullCompareEnabled() ? (0, a11y_diff_1.diffA11y)(pairs) : []),
                        ...(fullCompareEnabled() ? (0, data_rules_1.diffData)(pairs, devSnap.tables, prodSnap.tables, session.dataRules) : []),
                        ...(deferLogs ? [] : (0, runtime_diff_1.diffNetwork)(session.netLog.dev.splice(0), session.netLog.prod.splice(0))),
                        ...(deferLogs ? [] : (0, runtime_diff_1.diffRuntime)(session.runtimeLog.dev.splice(0), session.runtimeLog.prod.splice(0))),
                    ];
                    if (Date.now() - budgetStart > budgetMs)
                        budgetExceeded = true;
                    else {
                        for (const d of drafts) {
                            if (session.ignore.active) {
                                const excludedBy = session.ignore.exclude(d);
                                if (excludedBy) {
                                    suppressed.push(`${d.component} (${excludedBy})`);
                                    continue;
                                }
                                if (session.ignore.normalize(d.devValue) === session.ignore.normalize(d.prodValue)) {
                                    suppressed.push(`${d.component} (normalized)`);
                                    continue;
                                }
                            }
                            const isNew = this.recordMismatch(sessionId, { ...d, ...evidence });
                            tally(isNew);
                            if (isNew)
                                counts[d.type] = (counts[d.type] || 0) + 1;
                        }
                    }
                }
                catch (e) {
                    if (e?.message === 'budget')
                        budgetExceeded = true;
                    else
                        structuralFailure = String(e?.message || e).split(String.fromCharCode(10))[0];
                }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
                if (budgetExceeded || structuralFailure) {
                    session.netLog.dev.splice(0);
                    session.netLog.prod.splice(0);
                    session.runtimeLog.dev.splice(0);
                    session.runtimeLog.prod.splice(0);
                    if (budgetExceeded) {
                        this.log(sessionId, `Comparison budget exceeded after ${stepLabel} (${budgetMs} ms): keeping text and visual findings only`, 'Captured', 'Error');
                    }
                    else {
                        this.log(sessionId, `Structural comparison failed after ${stepLabel}: ${structuralFailure}; keeping text and visual findings only`, 'Captured', 'Error');
                    }
                }
            }
            // 2) Image / screenshot compare — always report when pixel diff exceeds threshold
            if (ratio > cap.visualDiffRatio) {
                tally(this.recordMismatch(sessionId, {
                    component: 'Viewport image',
                    type: 'Visual',
                    devValue: 'DEV screenshot attached',
                    prodValue: `PROD screenshot — ${(ratio * 100).toFixed(1)}% pixels differ`,
                    severity: ratio > 0.12 ? 'high' : ratio > 0.05 ? 'medium' : 'low',
                    description: `Screenshot image differs by ${(ratio * 100).toFixed(1)}% of pixels. Open side-by-side evidence to compare layout, colors, charts, and graphics.`,
                    ...evidence,
                }));
            }
            try {
                await this.runDataChecks(sessionId, new URL(session.devPage.url()).pathname || '/');
            }
            catch {
                /* never fails the comparison */
            }
            this.log(sessionId, `Compared after ${stepLabel}: ${added} new (Text ${counts.Text}, DOM ${counts.DOM}, CSS ${counts.CSS}, Layout ${counts.Layout}, A11y ${counts.Accessibility}, Data ${counts.Data}, Network ${counts.Network}, Console ${counts.Console}), ${repeated} already reported, ${(ratio * 100).toFixed(1)}% pixels differ` +
                (suppressed.length ? `; ${suppressed.length} suppressed by ignore rules: ${suppressed.slice(0, 5).join(', ')}${suppressed.length > 5 ? '…' : ''}` : ''), 'Captured', added > 0 ? 'Differences' : 'Captured');
        }
        catch (e) {
            console.warn('Screenshot/text comparison failed', e);
            this.log(sessionId, `Comparison failed after ${stepLabel}: ${String(e?.message || e).split('\n')[0]}`, 'Error', 'Error');
        }
    }
    /** Decrypt a stored connection string; null on any failure. Never logs the value. */
    getSecret(ref) {
        try {
            const dir = (0, secrets_1.getDataDir)();
            const blob = (0, secrets_1.getSecretFile)(dir, ref);
            return blob ? (0, secrets_1.decryptSecret)(blob, (0, secrets_1.loadKey)(process.env, dir)) : null;
        }
        catch {
            return null;
        }
    }
    /**
     * Run the profile's API and DB checks and record their findings through the normal pipeline.
     * Session start: all checks. After a comparison (afterDevPath): API checks whose whenPathStartsWith matches.
     * PROD safety: the checks only ever call GET on each page's context.request (runApiCheck's sole method),
     * so they cannot mutate PROD; DB checks run in BEGIN READ ONLY and never touch the browser.
     */
    async runDataChecks(sessionId, afterDevPath) {
        const session = this.sessions.get(sessionId);
        if (!session || (!session.apiChecks.length && !session.dbChecks.length))
            return;
        try {
            const drafts = await (0, data_sources_1.runDataSourceChecks)({
                apiChecks: session.apiChecks,
                dbChecks: session.dbChecks,
                devCtx: session.devContext.request,
                prodCtx: session.prodContext.request,
                devBase: session.devUrl,
                prodBase: session.prodUrl,
                getSecret: (ref) => this.getSecret(ref),
                afterDevPath,
                refPrefix: session.profileId ? (0, secrets_1.dbSecretPrefix)(session.profileId) : 'no-profile:',
            });
            for (const d of drafts)
                this.recordMismatch(sessionId, d);
        }
        catch (e) {
            this.log(sessionId, `Data checks failed: ${String(e?.message || e).split(String.fromCharCode(10))[0].slice(0, 200)}`, 'Error', 'Error');
        }
    }
    async compareScreenshots(buf1, buf2, preferredDiffPath, sideBySidePath, pixelThreshold = 0.1) {
        const px = await diffPixelsOffThread(buf1, buf2, pixelThreshold);
        if (px.sizeMismatch || !px.overlayPng) {
            // Still try to build side-by-side with sharp if available
            const sbs = await this.writeSideBySide(buf1, buf2, sideBySidePath);
            return { ratio: 1.0, sideBySidePath: sbs };
        }
        let diffPath;
        try {
            await fs.promises.mkdir(path.dirname(preferredDiffPath), { recursive: true });
            await fs.promises.writeFile(preferredDiffPath, px.overlayPng);
            diffPath = preferredDiffPath;
        }
        catch {
            /* non-fatal */
        }
        const sbs = await this.writeSideBySide(buf1, buf2, sideBySidePath, px.overlayPng);
        return { ratio: px.ratio, diffPath, sideBySidePath: sbs };
    }
    async writeSideBySide(devBuf, prodBuf, outPath, diffBuf) {
        if (!outPath)
            return undefined;
        try {
            // Prefer sharp for crisp resize/composite
            const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            const targetH = 800;
            const devImg = sharp(devBuf).resize({ height: targetH, fit: 'inside' });
            const prodImg = sharp(prodBuf).resize({ height: targetH, fit: 'inside' });
            const devMeta = await devImg.metadata();
            const prodMeta = await prodImg.metadata();
            const devW = devMeta.width || 640;
            const prodW = prodMeta.width || 640;
            const gap = 16;
            const labelH = 36;
            const parts = [await devImg.png().toBuffer(), await prodImg.png().toBuffer()];
            let totalW = devW + gap + prodW;
            let diffW = 0;
            let diffPng = null;
            if (diffBuf) {
                diffPng = await sharp(diffBuf).resize({ height: targetH, fit: 'inside' }).png().toBuffer();
                const dm = await sharp(diffPng).metadata();
                diffW = dm.width || 640;
                totalW += gap + diffW;
                parts.push(diffPng);
            }
            const canvasH = targetH + labelH + 20;
            const canvas = sharp({
                create: {
                    width: totalW + 40,
                    height: canvasH,
                    channels: 3,
                    background: { r: 24, g: 24, b: 27 },
                },
            });
            const composites = [];
            let x = 20;
            const labels = diffBuf ? ['DEV', 'PROD', 'DIFF'] : ['DEV', 'PROD'];
            // label bars as small pngs
            for (let i = 0; i < parts.length; i++) {
                const meta = await sharp(parts[i]).metadata();
                const w = meta.width || 640;
                const label = await sharp({
                    create: {
                        width: w,
                        height: labelH,
                        channels: 3,
                        background: i === 0 ? { r: 16, g: 185, b: 129 } : i === 1 ? { r: 244, g: 63, b: 94 } : { r: 139, g: 92, b: 246 },
                    },
                })
                    .png()
                    .toBuffer();
                composites.push({ input: label, left: x, top: 8 });
                composites.push({ input: parts[i], left: x, top: labelH + 12 });
                x += w + gap;
            }
            await canvas.composite(composites).png().toFile(outPath);
            return outPath;
        }
        catch (err) {
            console.warn('side-by-side compose failed', err);
            // Fallback: just copy dev as placeholder path
            try {
                if (outPath) {
                    fs.writeFileSync(outPath, devBuf);
                    return outPath;
                }
            }
            catch {
                /* ignore */
            }
            return undefined;
        }
    }
    log(sessionId, action, devResult, prodResult) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const entry = {
            id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            timestamp: new Date().toISOString(),
            action,
            devResult,
            prodResult,
            // skipped = not replayed by policy/scope; info = progress/config lines (not counted as match or mismatch)
            status: prodResult === 'Blocked' || prodResult === 'Skipped'
                ? 'skipped'
                : INFO_RESULTS.has(prodResult)
                    ? 'info'
                    : devResult === prodResult && devResult !== 'Error'
                        ? 'match'
                        : 'mismatch',
        };
        session.logs.unshift(entry);
        this.io?.emit('log', { sessionId, log: stripShotPaths(entry) });
    }
    /**
     * Record a finding. A finding identical to one already reported is not added again;
     * the existing one gets its occurrence count, last-seen time and step list updated.
     * Returns true if the finding is new.
     */
    recordMismatch(sessionId, mismatch) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        let page = '/';
        try {
            page = new URL(session.devPage.url()).pathname || '/';
        }
        catch {
            /* ignore */
        }
        const now = new Date().toISOString();
        const fp = (0, findings_1.fingerprint)(page, mismatch);
        const existing = session.findingIndex.get(fp);
        if (existing) {
            existing.occurrences = (existing.occurrences || 1) + 1;
            existing.lastSeen = now;
            if (Array.isArray(mismatch.stepIds)) {
                existing.stepIds = Array.from(new Set([...(existing.stepIds || []), ...mismatch.stepIds])).slice(-100);
            }
            this.io?.emit('mismatch-update', { sessionId, mismatch: stripShotPaths(existing) });
            return false;
        }
        const fullMismatch = {
            id: 'mismatch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            timestamp: now,
            firstSeen: now,
            lastSeen: now,
            occurrences: 1,
            page,
            ...mismatch,
            fingerprint: fp,
            ...(0, findings_1.classifyFinding)(mismatch, session.expected, fp),
        };
        session.findingIndex.set(fp, fullMismatch);
        session.mismatches.unshift(fullMismatch);
        this.io?.emit('mismatch', { sessionId, mismatch: stripShotPaths(fullMismatch) });
        return true;
    }
    loadExpectations(profileId) {
        if (!profileId)
            return [];
        try {
            return (0, store_1.openStore)(path.join((0, secrets_1.getDataDir)(), 'qa-vision.db')).listExpectations(profileId);
        }
        catch (e) {
            console.error('Could not load expectations:', e.message);
            return [];
        }
    }
    /** Re-derive a finding's classification from the expectation set; preset classifications (replay failures etc.) are kept. */
    reclassify(finding, expected, note) {
        const derived = finding.classification === 'POTENTIAL_DEFECT' || finding.classification === 'EXPECTED_DIFFERENCE';
        if (!derived)
            return;
        const { classification, confidence } = (0, findings_1.classifyFinding)({ ...finding, classification: undefined }, expected, finding.fingerprint);
        finding.classification = classification;
        finding.confidence = confidence;
        if (classification === 'EXPECTED_DIFFERENCE') {
            finding.ruleApplied = 'user-expectation' + (note ? ': ' + note : '');
            finding.expectationNote = note;
        }
        else {
            finding.ruleApplied = null;
            delete finding.expectationNote;
        }
    }
    async markExpected(ref, findingId, expected, note = '') {
        const store = (0, store_1.openStore)(path.join((0, secrets_1.getDataDir)(), 'qa-vision.db'));
        const apply = (list, profileId, set) => {
            const finding = list.find((f) => f.id === findingId);
            if (!finding || !finding.fingerprint)
                return null;
            if (profileId) {
                if (expected)
                    store.addExpectation(profileId, finding.fingerprint, note);
                else
                    store.removeExpectation(profileId, finding.fingerprint);
            }
            if (expected)
                set.add(finding.fingerprint);
            else
                set.delete(finding.fingerprint);
            this.reclassify(finding, set, note);
            return finding;
        };
        if (ref.sessionId) {
            const session = this.sessions.get(ref.sessionId);
            if (!session)
                return { ok: false };
            const finding = apply(session.mismatches, session.profileId, session.expected);
            if (!finding)
                return { ok: false };
            this.io?.emit('mismatch-update', { sessionId: session.id, mismatch: stripShotPaths(finding) });
            return { ok: true, finding };
        }
        if (ref.runId) {
            const run = store.getRun(ref.runId);
            if (!run)
                return { ok: false };
            const set = new Set(this.loadExpectations(run.profileId).map((e) => e.fingerprint));
            const finding = apply(run.mismatches, run.profileId, set);
            if (!finding)
                return { ok: false };
            store.saveRun(run);
            return { ok: true, finding };
        }
        return { ok: false };
    }
    async highlightFinding(sessionId, findingId) {
        const session = this.sessions.get(sessionId);
        const finding = session?.mismatches.find((f) => f.id === findingId);
        if (!session || !finding)
            return { dev: false, prod: false, reason: 'Finding or session not found' };
        const testId = (() => {
            const c = String(finding.component ?? '');
            const m = c.match(/data-testid=["']?([\w-]+)/) || c.match(/^([\w-]+)$/);
            return m ? `[data-testid="${m[1]}"]` : '';
        })();
        const mark = async (page, selector) => {
            for (const sel of [selector, testId]) {
                if (!sel)
                    continue;
                try {
                    const ok = await page.evaluate((s) => {
                        const el = document.querySelector(s);
                        if (!el)
                            return false;
                        el.scrollIntoView({ block: 'center', inline: 'center' });
                        document.querySelectorAll('[data-qa-vision-highlight]').forEach((n) => n.remove());
                        const r = el.getBoundingClientRect();
                        const box = document.createElement('div');
                        box.setAttribute('data-qa-vision-highlight', '');
                        box.style.cssText =
                            `position:absolute;left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
                                `width:${r.width}px;height:${r.height}px;outline:3px solid #f43f5e;pointer-events:none;z-index:2147483647;`;
                        document.body.appendChild(box);
                        setTimeout(() => box.remove(), 3000);
                        return true;
                    }, sel);
                    if (ok)
                        return true;
                }
                catch {
                    /* invalid selector or navigation: try next */
                }
            }
            return false;
        };
        const dev = await mark(session.devPage, finding.devSelector);
        const prod = await mark(session.prodPage, finding.prodSelector);
        const missing = [dev ? '' : 'DEV', prod ? '' : 'PROD'].filter(Boolean);
        return { dev, prod, ...(missing.length ? { reason: `Element not found on ${missing.join(' and ')}` } : {}) };
    }
    snapshotOf(session) {
        return {
            id: session.id,
            profileId: session.profileId,
            projectName: session.projectName,
            devUrl: session.devUrl,
            prodUrl: session.prodUrl,
            startedAt: session.startedAt,
            endedAt: new Date().toISOString(),
            logs: [...session.logs],
            mismatches: [...session.mismatches],
        };
    }
    /** Idempotent (saveRun replaces by run id). A storage failure must never break session teardown. */
    persistRun(session, snap) {
        try {
            (0, store_1.openStore)(path.join((0, secrets_1.getDataDir)(), 'qa-vision.db')).saveRun(snap ?? this.snapshotOf(session));
        }
        catch (e) {
            console.error('Could not persist run history:', e.message);
        }
    }
    archiveSession(session) {
        this.lastSnapshot = this.snapshotOf(session);
        try {
            const snapPath = path.join(session.evidenceDir, 'session-snapshot.json');
            fs.writeFileSync(snapPath, JSON.stringify(this.lastSnapshot, null, 2));
        }
        catch {
            /* ignore */
        }
        this.persistRun(session, this.lastSnapshot);
        this.scheduleAiAnalysis(session);
    }
    /** Resolves the AI provider; tests may replace it with a fake. */
    aiProviderFactory = () => (0, ai_1.providerFromEnv)(process.env);
    /** Last background AI run (tests await it; never rejects). */
    aiPending = Promise.resolve();
    /** Background, fire-and-forget: must never block or throw into Stop. Advisory only; never touches classification. */
    scheduleAiAnalysis(session) {
        if (session.aiScheduled)
            return; // a second Stop must not start a second paid run
        session.aiScheduled = true;
        this.aiPending = (async () => {
            try {
                const provider = this.aiProviderFactory();
                if (!provider)
                    return;
                const findings = session.mismatches.filter((f) => !f.ai || f.ai.status !== 'ok');
                if (!findings.length)
                    return;
                const results = await (0, ai_1.analyzeFindings)(findings, provider, ai_1.DEFAULT_AI_OPTIONS);
                // Merge only `ai` into the stored run: a runId-based mark-expected may have saved newer state meanwhile.
                const store = (0, store_1.openStore)(path.join((0, secrets_1.getDataDir)(), 'qa-vision.db'));
                const run = store.getRun(session.id);
                for (const f of findings) {
                    const ai = results.get(f.id);
                    if (!ai)
                        continue;
                    f.ai = ai;
                    const stored = run?.mismatches.find((m) => m.id === f.id);
                    if (stored)
                        stored.ai = ai;
                    this.io?.emit('mismatch-update', { sessionId: session.id, mismatch: stripShotPaths(stored ?? f) });
                }
                if (run)
                    store.saveRun(run);
            }
            catch (e) {
                console.error('AI analysis failed:', e.message);
            }
        })();
    }
    async analyzeFinding(ref, findingId) {
        try {
            const provider = this.aiProviderFactory();
            const store = (0, store_1.openStore)(path.join((0, secrets_1.getDataDir)(), 'qa-vision.db'));
            const session = ref.sessionId ? this.sessions.get(ref.sessionId) : undefined;
            const run = !session && ref.runId ? store.getRun(ref.runId) : undefined;
            const list = session?.mismatches ?? run?.mismatches;
            const finding = list?.find((f) => f.id === findingId);
            if (!finding)
                return { ok: false };
            const ai = (await (0, ai_1.analyzeFindings)([finding], provider, ai_1.DEFAULT_AI_OPTIONS)).get(finding.id);
            if (!ai)
                return { ok: false };
            finding.ai = ai;
            if (session)
                this.io?.emit('mismatch-update', { sessionId: session.id, mismatch: stripShotPaths(finding) });
            else if (run)
                store.saveRun(run);
            return { ok: true, finding, ai };
        }
        catch (e) {
            console.error('AI analysis failed:', e.message);
            return { ok: false };
        }
    }
    /**
     * Live view: each side streams through a CDP screencast: Chrome pushes a JPEG on every repaint, coalesced to
     * QA_VISION_LIVE_FPS (default 8), emitted as `frame {sessionId, side, data (base64 JPEG), url, focus}`. Screenshots (1 per second) are the
     * fallback: for a side whose screencast could not start, and whenever the profile has mask selectors (screencast
     * pixels cannot be masked, and a frame is never sent unmasked). A 1 s heartbeat re-sends the last frame of an idle
     * screencast so a dashboard that (re)connects is never left blank.
     */
    startFrameStream(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.frameTimer)
            return;
        // Frames keep flowing while paused: the Live view is where the user drives DEV, so it must never freeze.
        session.frameTimer = setInterval(() => {
            if (!session.isRunning)
                return this.stopFrameStream(sessionId);
            void this.emitFrames(session, ['dev', 'prod']);
        }, 1000);
        session.frameTimer.unref?.();
        // QA_VISION_LIVE_SCREENCAST=0 forces the 1 fps screenshot path
        if (!session.capture.maskSelectors.length && process.env.QA_VISION_LIVE_SCREENCAST !== '0') {
            void this.startScreencast(session, 'dev');
            void this.startScreencast(session, 'prod');
        }
    }
    async startScreencast(session, side) {
        const page = side === 'dev' ? session.devPage : session.prodPage;
        let cdp;
        try {
            cdp = await page.context().newCDPSession(page);
        }
        catch {
            return; // not Chromium / page gone: the screenshot fallback covers this side
        }
        const cast = { cdp, lastEmitAt: 0, focus: '', focusAt: 0 };
        const { width, height } = session.capture.viewport;
        // Keep stream size equal to the Playwright viewport so click coords map 1:1. Quality/FPS stay lower for speed.
        const begin = () => cdp.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 50,
            maxWidth: width,
            maxHeight: height,
            everyNthFrame: 2,
        });
        cdp.on('Page.screencastFrame', (ev) => {
            // Ack at once: Chrome sends the next frame only after the ack (built-in back-pressure)
            cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => { });
            if (cast.stopped)
                return;
            cast.pending = ev.data;
            this.flushCast(session, side, cast);
        });
        try {
            await begin();
        }
        catch {
            cdp.detach().catch(() => { });
            return;
        }
        if (!session.isRunning || !session.frameTimer) {
            cast.stopped = true;
            cdp.detach().catch(() => { });
            return;
        }
        (session.casts ??= {})[side] = cast;
        // A main-frame navigation can swap the renderer: restart so the stream never silently stalls on the old page.
        page.on('load', () => {
            if (cast.stopped)
                return;
            cdp
                .send('Page.stopScreencast')
                .catch(() => { })
                .then(() => (cast.stopped ? undefined : begin()))
                .catch(() => { });
        });
    }
    /** Emit the newest screencast frame, at most liveCastMinIntervalMs() apart per side. */
    flushCast(session, side, cast) {
        if (cast.flushTimer)
            return;
        const wait = Math.max(0, cast.lastEmitAt + liveCastMinIntervalMs() - Date.now());
        cast.flushTimer = setTimeout(async () => {
            const data = cast.pending;
            cast.pending = undefined;
            try {
                if (!data || cast.stopped)
                    return;
                cast.last = data;
                const io = this.io;
                if (!session.isRunning || !io || io.sockets.sockets.size < 1)
                    return;
                cast.lastEmitAt = Date.now();
                const page = side === 'dev' ? session.devPage : session.prodPage;
                // Focus label is expensive (page.evaluate); refresh rarely so streaming stays cheap
                if (Date.now() - cast.focusAt > 2000) {
                    cast.focusAt = Date.now();
                    cast.focus = await this.focusLabel(page);
                }
                if (!cast.stopped && session.isRunning) {
                    const { width: vw, height: vh } = session.capture.viewport;
                    io.emit('frame', {
                        sessionId: session.id,
                        side,
                        data,
                        url: urlForAddressBar(page.url()),
                        focus: cast.focus,
                        vw,
                        vh,
                    });
                }
            }
            finally {
                cast.flushTimer = undefined;
                if (cast.pending && !cast.stopped)
                    this.flushCast(session, side, cast);
            }
        }, wait);
    }
    /** Name the focused field (both panes are drivable), so focus stays visible even on a password input. Never its value. */
    focusLabel(page) {
        // Bounded: an evaluate can wait out a navigation, and a stalled label must never hold up the frame stream
        const label = page
            .evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body || el === document.documentElement)
                return '';
            const tag = el.tagName.toLowerCase();
            const type = el.getAttribute('type');
            const name = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || el.id ||
                (tag === 'button' || tag === 'a' ? (el.innerText || '').trim().slice(0, 40) : ''); // never editable content
            return `${tag}${type ? `[${type}]` : ''}${name ? ` "${name}"` : ''}`.slice(0, 80);
        })
            .catch(() => '');
        let timer;
        const timeout = new Promise((r) => (timer = setTimeout(() => r(''), 500)));
        return Promise.race([label, timeout]).finally(() => clearTimeout(timer));
    }
    /** One frame per requested side (skipped while a previous grab is in flight or nobody is watching). */
    async emitFrames(session, sides, urgent = false) {
        const io = this.io;
        if (!session.isRunning || !io || io.sockets.sockets.size < 1)
            return;
        // Screencast sides push their own frames; an idle one (nothing repainted for 1 s) re-sends its last frame
        sides = sides.filter((side) => {
            const cast = session.casts?.[side];
            if (!cast || cast.stopped)
                return true;
            if (!urgent && cast.last && !cast.pending && !cast.flushTimer && Date.now() - cast.lastEmitAt >= 1000) {
                cast.pending = cast.last;
                this.flushCast(session, side, cast);
            }
            return false;
        });
        if (!sides.length)
            return;
        if (session.frameBusy) {
            // Input feedback must not be dropped: refresh the requested side(s) right after the grab in flight
            if (urgent)
                for (const s of sides)
                    (session.frameAgain ??= new Set()).add(s);
            return;
        }
        const grab = async (page) => {
            try {
                // Password inputs already render as dots, so they stay visible (the user must see typing land there), as in
                // evidence screenshots. The profile's mask selectors are still blacked out.
                const masks = session.capture.maskSelectors.map((sel) => page.locator(sel));
                // caret: 'initial' keeps the text cursor visible, so the user can see which field has focus
                const buf = await page.screenshot({ type: 'jpeg', quality: 50, mask: masks, maskColor: '#000000', caret: 'initial', timeout: 4000 });
                return buf.toString('base64');
            }
            catch {
                return null;
            }
        };
        session.frameBusy = true;
        try {
            for (const side of sides) {
                const page = side === 'dev' ? session.devPage : session.prodPage;
                const data = await grab(page);
                const focus = await this.focusLabel(page);
                if (data && session.isRunning) {
                    const { width: vw, height: vh } = session.capture.viewport;
                    io.emit('frame', { sessionId: session.id, side, data, url: urlForAddressBar(page.url()), focus, vw, vh });
                }
            }
        }
        finally {
            session.frameBusy = false;
        }
        if (session.frameAgain?.size) {
            const again = [...session.frameAgain];
            session.frameAgain.clear();
            void this.emitFrames(session, again);
        }
    }
    /**
     * Wait (max 4 s) until no Live-view input arrived for 700 ms (longer than the recorder's 120 ms fill debounce).
     * Ends early when another action gets queued: that action's task runs the comparison, so replays never stall here.
     */
    async waitForLiveInputQuiet(session) {
        // Longer quiet window batches more steps into one comparison (faster feel, less SPA thrash).
        const quietMs = fullCompareEnabled() ? 700 : 1100;
        const maxWait = fullCompareEnabled() ? 4000 : 2500;
        const start = Date.now();
        while (Date.now() - start < maxWait &&
            session.pendingActions === 0 &&
            session.lastLiveInputAt &&
            Date.now() - session.lastLiveInputAt < quietMs) {
            await new Promise((r) => setTimeout(r, 80));
        }
    }
    /**
     * If a target=_blank / window.open popup still appears, navigate the main live pane to that URL
     * and close the popup. Live Comparison only streams one page per side.
     */
    attachPopupToMainPane(sessionId, side, context) {
        context.on('page', async (popup) => {
            const session = this.sessions.get(sessionId);
            if (!session || !session.isRunning) {
                await popup.close().catch(() => { });
                return;
            }
            const main = side === 'dev' ? session.devPage : session.prodPage;
            if (popup === main)
                return;
            const readHref = async () => {
                for (let i = 0; i < 20; i++) {
                    let href = '';
                    try {
                        href = popup.url();
                    }
                    catch {
                        return '';
                    }
                    if (href && href !== 'about:blank' && !href.startsWith('blob:'))
                        return href;
                    await new Promise((r) => setTimeout(r, 100));
                }
                try {
                    return popup.url();
                }
                catch {
                    return '';
                }
            };
            try {
                await popup.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => { });
                const href = await readHref();
                if (!href || href === 'about:blank' || href.startsWith('blob:')) {
                    await popup.close().catch(() => { });
                    return;
                }
                const check = validateTargetUrl(href);
                if (!check.ok) {
                    this.log(sessionId, `${side.toUpperCase()} blocked popup to unsafe URL: ${check.error}`, side === 'dev' ? 'Error' : 'n/a', side === 'prod' ? 'Error' : 'n/a');
                    await popup.close().catch(() => { });
                    return;
                }
                let mainUrl = '';
                try {
                    mainUrl = main.url();
                }
                catch {
                    mainUrl = '';
                }
                if (mainUrl !== check.url) {
                    await main.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => {
                        this.log(sessionId, `${side.toUpperCase()} could not open link in live pane: ${String(e?.message || e).split('\n')[0]}`, side === 'dev' ? 'Error' : 'n/a', side === 'prod' ? 'Error' : 'n/a');
                    });
                    this.log(sessionId, `${side.toUpperCase()} opened link in live pane: ${urlForLog(check.url)}`, side === 'dev' ? 'Success' : 'n/a', side === 'prod' ? 'Success' : 'n/a');
                    if (side === 'dev' && session.phase === 'running' && !session.isPaused) {
                        const prodTarget = mapDevUrlToProd(check.url, session.devUrl, session.prodUrl);
                        if (prodTarget) {
                            await session.prodPage
                                .goto(prodTarget, { waitUntil: 'domcontentloaded', timeout: 45000 })
                                .catch(() => { });
                            this.log(sessionId, `PROD followed DEV link to ${urlForLog(prodTarget)}`, 'Success', 'Success');
                        }
                    }
                    setTimeout(() => void this.emitFrames(session, side === 'dev' ? ['dev', 'prod'] : [side], true), 100);
                }
            }
            finally {
                await popup.close().catch(() => { });
            }
        });
    }
    /**
     * Scroll at a point: try the nearest overflow container (SPA panels), then mouse.wheel as fallback.
     * Used for live-view wheel on DEV and the PROD mirror while comparing.
     */
    async applyWheelAt(page, x, y, dx, dy) {
        await page.mouse.move(x, y).catch(() => { });
        const scrolled = await page
            .evaluate(({ px, py, ddx, ddy }) => {
            const root = document.elementFromPoint(px, py);
            let el = root;
            while (el && el !== document.body && el !== document.documentElement) {
                const st = window.getComputedStyle(el);
                const oy = st.overflowY;
                const ox = st.overflowX;
                const canY = (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 2;
                const canX = (ox === 'auto' || ox === 'scroll' || ox === 'overlay') && el.scrollWidth > el.clientWidth + 2;
                if (canY || canX) {
                    const beforeTop = el.scrollTop;
                    const beforeLeft = el.scrollLeft;
                    if (canY)
                        el.scrollTop += ddy;
                    if (canX)
                        el.scrollLeft += ddx;
                    if (el.scrollTop !== beforeTop || el.scrollLeft !== beforeLeft)
                        return true;
                }
                el = el.parentElement;
            }
            const se = (document.scrollingElement || document.documentElement);
            const beforeY = se.scrollTop;
            const beforeX = se.scrollLeft;
            se.scrollTop += ddy;
            se.scrollLeft += ddx;
            window.scrollBy(ddx, ddy);
            return se.scrollTop !== beforeY || se.scrollLeft !== beforeX;
        }, { px: x, py: y, ddx: dx, ddy: dy })
            .catch(() => false);
        // Always also send a wheel event so listeners / virtual lists that ignore scrollTop still move
        await page.mouse.wheel(dx, dy).catch(() => { });
        if (!scrolled) {
            /* wheel already attempted */
        }
    }
    /**
     * Live-view input: the dashboard's DEV pane forwards mouse/keyboard input here, and it is dispatched as real
     * input on the DEV page. The DEV recorder therefore captures it exactly as if the user had used a DEV window,
     * and PROD mirrors it through the normal replay path. Coordinates are CSS pixels in the DEV viewport (the
     * frame is a viewport screenshot). Inputs apply one at a time, in arrival order; bad input is ignored.
     *
     * `side: 'prod'` drives the PROD page directly instead (e.g. to log in there or fix drift). That input is not
     * recorded, not mirrored and not compared, and is accepted only while the session is 'ready' or 'paused', so it
     * never races a replay. PROD's network guard still applies, so the safety policy holds for direct input too.
     */
    handleLiveInput(sessionId, input) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning || session.stopRequested || !input || typeof input !== 'object')
            return;
        const i = input;
        const side = i.side === 'prod' ? 'prod' : 'dev';
        const prodAllowed = () => !session.starting && (session.phase === 'ready' || session.phase === 'paused');
        if (side === 'prod' && !prodAllowed())
            return;
        const { width, height } = session.capture.viewport;
        const coord = (v, max) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.min(Math.max(n, 0), max - 1) : null;
        };
        const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
        if (side === 'dev' && i.kind !== 'move')
            session.lastLiveInputAt = Date.now();
        const apply = async () => {
            if (!session.isRunning || session.stopRequested)
                return;
            if (side === 'dev' && session.suppressCapture)
                return;
            if (side === 'prod' && !prodAllowed())
                return; // a Start/Resume began while this input was queued
            const page = side === 'prod' ? session.prodPage : session.devPage;
            const mouse = page.mouse;
            switch (i.kind) {
                case 'move':
                case 'click':
                case 'down':
                case 'up':
                case 'wheel': {
                    const x = coord(i.x, width);
                    const y = coord(i.y, height);
                    if (x === null || y === null)
                        return;
                    await mouse.move(x, y);
                    const button = i.button === 'right' ? 'right' : 'left';
                    const clickCount = i.count === 3 ? 3 : i.count === 2 ? 2 : 1; // 2 = word, 3 = line selection
                    if (i.kind === 'click') {
                        await mouse.down({ button, clickCount });
                        await mouse.up({ button, clickCount });
                    }
                    else if (i.kind === 'down') {
                        await mouse.down({ button, clickCount }); // separate down/move/up: drag-to-select works
                    }
                    else if (i.kind === 'up') {
                        await mouse.up({ button, clickCount });
                    }
                    else if (i.kind === 'wheel') {
                        const dy = Math.max(-3000, Math.min(3000, Number(i.deltaY) || 0));
                        const dx = Math.max(-3000, Math.min(3000, Number(i.deltaX) || 0));
                        if (dx || dy) {
                            await this.applyWheelAt(page, x, y, dx, dy);
                            // Live-view wheel is CDP input: the page recorder never sees it. While comparing,
                            // mirror the same wheel onto PROD so nested SPA scrollers stay in sync.
                            if (side === 'dev' && session.phase === 'running' && !session.isPaused) {
                                try {
                                    await this.applyWheelAt(session.prodPage, x, y, dx, dy);
                                    setTimeout(() => void this.emitFrames(session, ['prod'], true), 50);
                                }
                                catch {
                                    /* PROD page may be navigating */
                                }
                            }
                        }
                    }
                    break;
                }
                case 'key': {
                    // Playwright key names, optionally with modifiers: "Enter", "Shift+Tab", "Control+a"
                    const key = str(i.key, 40);
                    if (key && /^[\x20-\x7e]+$/.test(key))
                        await page.keyboard.press(key);
                    break;
                }
                case 'text': {
                    // Printable characters typed into the pane; pasted text arrives here too
                    const text = str(i.text, 5000);
                    if (text)
                        await page.keyboard.type(text);
                    break;
                }
                default:
                    return;
            }
            // Refresh the driven pane now (mouse moves excluded) so it responds without waiting for the 1 s tick
            if (i.kind !== 'move') {
                if (side === 'dev')
                    session.lastLiveInputAt = Date.now(); // the quiet gap starts once the input is applied
                setTimeout(() => void this.emitFrames(session, [side], true), 80);
            }
        };
        const run = (q) => (q ?? Promise.resolve())
            .then(() => Promise.race([apply(), new Promise((r) => setTimeout(r, 5000))]))
            .catch((e) => console.error(`Live input (${side}) failed:`, e.message));
        if (side === 'prod')
            session.prodLiveInputQueue = run(session.prodLiveInputQueue);
        else
            session.liveInputQueue = run(session.liveInputQueue);
    }
    /**
     * Live-view browser controls: type a URL (goto), Back, Forward or Reload in either pane. Runs on that side's input
     * queue, so it keeps its order with clicks and typing.
     *
     * DEV: allowed whenever the session is open (not while Start is aligning PROD). While comparing, a full-document
     * DEV navigation is mirrored to PROD as a `navigate` step (PROD goes to the equivalent PROD URL and is compared).
     * A same-document one (SPA history, hash) is already reported by the recorder's popstate hook, so it is not sent
     * twice. PROD: same rules as direct PROD input (ready / paused only, never mirrored). URLs pass validateTargetUrl,
     * and PROD's network guard still applies.
     */
    liveNavigate(sessionId, sideRaw, opRaw, urlRaw) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning || session.stopRequested)
            return Promise.resolve({ ok: false, message: 'No active session' });
        const side = sideRaw === 'prod' ? 'prod' : 'dev';
        const op = opRaw === 'back' || opRaw === 'forward' || opRaw === 'reload' || opRaw === 'goto' ? opRaw : null;
        if (!op)
            return Promise.resolve({ ok: false, message: 'Unknown navigation' });
        const label = side === 'prod' ? 'PROD' : 'DEV';
        const allowed = () => !session.starting && (side === 'dev' ? !session.suppressCapture : session.phase === 'ready' || session.phase === 'paused');
        const refused = () => side === 'prod'
            ? 'PROD can be navigated only while the session is Ready or Paused (press Pause first).'
            : 'DEV cannot be navigated right now (Start or auto-login is running).';
        if (!allowed())
            return Promise.resolve({ ok: false, message: refused() });
        let target;
        if (op === 'goto') {
            let raw = typeof urlRaw === 'string' ? urlRaw.trim() : '';
            if (raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw))
                raw = `https://${raw}`; // "app.example.com/x" like a browser
            const check = validateTargetUrl(raw);
            if (!check.ok)
                return Promise.resolve({ ok: false, message: `${label} URL rejected: ${check.error}` });
            target = check.url;
        }
        const apply = async () => {
            if (!session.isRunning || session.stopRequested)
                return { ok: false, message: 'No active session' };
            if (!allowed())
                return { ok: false, message: refused() };
            const page = side === 'prod' ? session.prodPage : session.devPage;
            const before = page.url();
            const opts = { waitUntil: 'domcontentloaded', timeout: 30000 };
            // Identifies the document: it changes on a full load (including a back/forward-cache restore), not on a
            // same-document (SPA history / hash) change, which the recorder's popstate hook already reports.
            const docId = () => page.evaluate(() => performance.timeOrigin).catch(() => NaN);
            const beforeDoc = await docId();
            let response;
            try {
                if (op === 'goto')
                    response = await page.goto(target, opts);
                else if (op === 'back')
                    response = await page.goBack(opts);
                else if (op === 'forward')
                    response = await page.goForward(opts);
                else
                    response = await page.reload(opts);
            }
            catch (err) {
                const message = `${label} ${op} failed: ${String(err?.message || err).split('\n')[0]}`;
                this.log(sessionId, message, 'Executed', 'Error');
                setTimeout(() => void this.emitFrames(session, [side], true), 80);
                return { ok: false, message };
            }
            if ((op === 'back' || op === 'forward') && !response && page.url() === before) {
                // Right after another load, Chrome can apply the history move a moment after goBack/goForward returned
                await page.waitForURL((u) => u.href !== before, { timeout: 3000, waitUntil: 'commit' }).catch(() => { });
            }
            const after = page.url();
            const afterDoc = after === before && !response ? beforeDoc : await docId();
            const newDocument = Boolean(response) || (Number.isFinite(beforeDoc) && Number.isFinite(afterDoc) && afterDoc !== beforeDoc);
            if ((op === 'back' || op === 'forward') && !response && after === before) {
                return { ok: false, message: `${label}: no ${op === 'back' ? 'previous' : 'next'} page` };
            }
            this.log(sessionId, `${label} ${op === 'goto' ? 'address bar' : op}: ${urlForLog(after)}`, 'Executed', 'Info');
            if (side === 'dev') {
                session.lastLiveInputAt = Date.now();
                // A full-document load is invisible to the recorder: mirror it (same-document changes come via popstate)
                if (newDocument && session.phase === 'running')
                    void this.enqueueAction(sessionId, { type: 'navigate', url: after });
            }
            setTimeout(() => void this.emitFrames(session, [side], true), 80);
            return { ok: true, message: `${label} at ${urlForLog(after)}`, url: urlForAddressBar(after) };
        };
        const prev = (side === 'prod' ? session.prodLiveInputQueue : session.liveInputQueue) ?? Promise.resolve();
        const result = prev.then(apply, apply);
        const settled = result.then(() => undefined, (e) => console.error(`Live navigation (${side}) failed:`, e.message));
        if (side === 'prod')
            session.prodLiveInputQueue = settled;
        else
            session.liveInputQueue = settled;
        return result.catch((e) => ({ ok: false, message: `${label} ${op} failed: ${e.message}` }));
    }
    stopFrameStream(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session?.frameTimer) {
            clearInterval(session.frameTimer);
            session.frameTimer = undefined;
        }
        if (session?.casts) {
            for (const cast of [session.casts.dev, session.casts.prod]) {
                if (!cast)
                    continue;
                cast.stopped = true;
                if (cast.flushTimer)
                    clearTimeout(cast.flushTimer);
                cast.cdp
                    .send('Page.stopScreencast')
                    .catch(() => { })
                    .finally(() => cast.cdp.detach().catch(() => { }));
            }
            session.casts = undefined;
        }
        if (session) {
            session.frameBusy = false;
            if (session.frameAgain) {
                session.frameAgain.clear();
                session.frameAgain = undefined;
            }
        }
    }
    async closeSession(sessionId, reason) {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.stopFrameStream(sessionId);
            // Stop accepting new DEV actions, let queued replays/comparisons finish (bounded), then archive.
            session.stopRequested = true;
            const drained = await Promise.race([
                session.actionQueue.then(() => true),
                new Promise((r) => setTimeout(() => r(false), 10000)),
            ]);
            if (!drained)
                this.log(sessionId, 'Stop: in-flight work did not finish within 10s and was cancelled', 'Info', 'Info');
            this.log(sessionId, reason ?? 'Session stopped by user', 'Stopped', 'Stopped');
            session.isRunning = false;
            this.archiveSession(session);
            await session.devBrowser.close().catch(() => { });
            await session.prodBrowser.close().catch(() => { });
            this.sessions.delete(sessionId);
            this.evaluateOrphans();
            console.log(`Session ${sessionId} closed`);
        }
    }
    /** Synchronous: persist every live session's run (used on process shutdown; safe inside 'exit'). */
    persistAllSessions() {
        for (const s of this.sessions.values())
            if (s.isRunning)
                this.persistRun(s);
    }
    async closeAllSessions() {
        const ids = Array.from(this.sessions.keys());
        await Promise.all(ids.map((id) => this.closeSession(id)));
        console.log(`Closed ${ids.length} QA Vision session(s)`);
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * Snapshot of why a pane may look empty: URL, visible text, console/page errors, recent failed
     * network calls, and iframe count. Used to debug blank DEV shells (e.g. appalpha SD-WAN).
     */
    async diagnoseSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning)
            return { ok: false, error: 'No active session' };
        const snap = async (side) => {
            const page = side === 'dev' ? session.devPage : session.prodPage;
            const net = session.netLog[side] || [];
            const rt = session.runtimeLog[side] || [];
            let url = '';
            let title = '';
            let bodyText = '';
            let bodyHtmlLen = 0;
            let iframeCount = 0;
            let rootChildCount = 0;
            let errors = [];
            try {
                url = page.url();
                title = await page.title().catch(() => '');
                const info = await page
                    .evaluate(() => {
                    const root = document.querySelector('#root, #app, [data-reactroot], main') || document.body;
                    return {
                        bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800),
                        bodyHtmlLen: (document.body?.innerHTML || '').length,
                        iframeCount: document.querySelectorAll('iframe').length,
                        rootChildCount: root ? root.children.length : 0,
                        rootTag: root ? root.tagName : '',
                    };
                })
                    .catch(() => ({
                    bodyText: '',
                    bodyHtmlLen: 0,
                    iframeCount: 0,
                    rootChildCount: 0,
                    rootTag: '',
                }));
                bodyText = info.bodyText;
                bodyHtmlLen = info.bodyHtmlLen;
                iframeCount = info.iframeCount;
                rootChildCount = info.rootChildCount;
                errors = rt
                    .filter((e) => e.kind === 'console-error' || e.kind === 'page-error' || e.kind === 'request-failed')
                    .slice(-20)
                    .map((e) => `${e.kind}: ${e.text}`);
            }
            catch (e) {
                errors.push(String(e?.message || e));
            }
            const failedNet = net
                .filter((e) => e.failure || (e.status != null && e.status >= 400))
                .slice(-30)
                .map((e) => ({
                method: e.method,
                path: e.path,
                status: e.status,
                failure: e.failure,
            }));
            return {
                url,
                title,
                bodyText,
                bodyHtmlLen,
                iframeCount,
                rootChildCount,
                errors,
                failedNet,
                blankLooking: bodyHtmlLen < 5000 && bodyText.length < 80,
            };
        };
        const [dev, prod] = await Promise.all([snap('dev'), snap('prod')]);
        this.log(sessionId, `Diagnose: DEV blank=${dev.blankLooking} html=${dev.bodyHtmlLen} text=${dev.bodyText.length} | PROD blank=${prod.blankLooking} html=${prod.bodyHtmlLen} text=${prod.bodyText.length}`, 'Info', 'Info');
        return { ok: true, dev, prod };
    }
    getLastSnapshot() {
        return this.lastSnapshot;
    }
    /** Active session first, else last closed snapshot, else null */
    getReportSource(sessionId) {
        if (sessionId && this.sessions.has(sessionId)) {
            const s = this.sessions.get(sessionId);
            return {
                id: s.id,
                projectName: s.projectName,
                devUrl: s.devUrl,
                prodUrl: s.prodUrl,
                startedAt: s.startedAt,
                logs: [...s.logs],
                mismatches: [...s.mismatches],
            };
        }
        const active = this.sessions.values().next().value;
        if (active) {
            return {
                id: active.id,
                projectName: active.projectName,
                devUrl: active.devUrl,
                prodUrl: active.prodUrl,
                startedAt: active.startedAt,
                logs: [...active.logs],
                mismatches: [...active.mismatches],
            };
        }
        return this.lastSnapshot;
    }
    async startSessionWithRecorder(devUrl, prodUrl, opts = {}) {
        return this.createSession(devUrl, prodUrl, opts);
    }
}
exports.comparisonEngine = new QAComparisonEngine();
exports.default = exports.comparisonEngine;
const shutdownGlobals = globalThis;
shutdownGlobals.__qaVisionLiveEngine = exports.comparisonEngine;
function persistLiveSessions() {
    shutdownGlobals.__qaVisionLiveEngine?.persistAllSessions();
}
if (!shutdownGlobals.__qaVisionShutdownHook) {
    shutdownGlobals.__qaVisionShutdownHook = true;
    for (const ev of ['beforeExit', 'exit'])
        process.on(ev, persistLiveSessions);
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
        process.on(sig, () => {
            persistLiveSessions();
            // Only restore default termination when nobody else handles the signal
            if (process.listenerCount(sig) <= 1)
                process.exit(code);
        });
    }
}
