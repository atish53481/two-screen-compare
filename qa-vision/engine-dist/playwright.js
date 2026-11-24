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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.comparisonEngine = void 0;
exports.validateTargetUrl = validateTargetUrl;
exports.mapDevUrlToProd = mapDevUrlToProd;
exports.compileIgnoreRules = compileIgnoreRules;
exports.persistLiveSessions = persistLiveSessions;
const playwright_1 = require("playwright");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pixelmatch_1 = __importDefault(require("pixelmatch"));
const pngjs_1 = require("pngjs");
const findings_1 = require("./engine/findings");
const extract_1 = require("./engine/extract");
const dom_diff_1 = require("./engine/dom-diff");
const css_diff_1 = require("./engine/css-diff");
const a11y_diff_1 = require("./engine/a11y-diff");
const data_rules_1 = require("./engine/data-rules");
const runtime_diff_1 = require("./engine/runtime-diff");
const secrets_1 = require("./engine/secrets");
const data_sources_1 = require("./engine/data-sources");
const store_1 = require("./engine/store");
const ai_1 = require("./engine/ai");
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
/** Map a DEV URL onto the PROD base (same relative path/query/hash). Null if outside the DEV base. */
function mapDevUrlToProd(devHref, devBase, prodBase) {
    try {
        const d = new URL(devHref);
        const db = new URL(devBase);
        const pb = new URL(prodBase);
        if (d.origin !== db.origin)
            return null;
        const devPrefix = db.pathname.replace(/\/+$/, '');
        if (devPrefix && d.pathname !== devPrefix && !d.pathname.startsWith(devPrefix + '/'))
            return null;
        const rest = d.pathname.slice(devPrefix.length);
        const prodPrefix = pb.pathname.replace(/\/+$/, '');
        return `${pb.origin}${prodPrefix}${rest || '/'}${d.search}${d.hash}`;
    }
    catch {
        return null;
    }
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
const comparisonBudgetMs = () => Number(process.env.QA_VISION_COMPARE_BUDGET_MS) || 15000;
function getEngineGlobals() {
    const g = globalThis;
    if (!g.__qaVisionEngine) {
        g.__qaVisionEngine = {
            sessions: new Map(),
            lastSnapshot: null,
            io: null,
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
    }
    /** Collects network/API and console/page-error facts (never bodies or values). Listeners never throw. */
    attachCollectors(session, side, page) {
        // Look logs up at event time: consumers may replace the arrays.
        const net = { push: (e) => (0, runtime_diff_1.pushCapped)(session.netLog[side], e) };
        const rt = { push: (e) => (0, runtime_diff_1.pushCapped)(session.runtimeLog[side], e) };
        page.on('response', async (res) => {
            try {
                const req = res.request();
                const headers = res.headers();
                const contentType = headers['content-type'] || '';
                let json;
                if (/json/i.test(contentType)) {
                    const len = Number(headers['content-length'] || 0);
                    if (!len || len <= 256 * 1024) {
                        try {
                            const body = await res.body();
                            if (body.length <= 256 * 1024)
                                json = JSON.parse(body.toString('utf8'));
                        }
                        catch {
                            /* schema stays null */
                        }
                    }
                }
                net.push((0, runtime_diff_1.toNetworkEntry)({
                    method: req.method(), url: res.url(), status: res.status(),
                    resourceType: req.resourceType(), contentType, json,
                }));
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
            headless: process.env.QA_VISION_HEADLESS === '1', // visible by default; headless for automated tests
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                `--window-size=${capture.viewport.width},${capture.viewport.height + 100}`,
            ],
            timeout: 60000,
        };
        const devBrowser = await playwright_1.chromium.launch(launchOptions);
        const prodBrowser = await playwright_1.chromium.launch(launchOptions);
        const devContext = await devBrowser.newContext({
            viewport: { ...capture.viewport },
            userAgent: 'QA-Vision-DEV',
        });
        const prodContext = await prodBrowser.newContext({
            viewport: { ...capture.viewport },
            userAgent: 'QA-Vision-PROD',
        });
        const devPage = await devContext.newPage();
        const prodPage = await prodContext.newPage();
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
        this.log(sessionId, 'Action recorder active on DEV — interact only in the QA Vision DEV window', 'Active', 'Active');
        // Baseline comparison of the landing pages (runs on the queue, does not block the API)
        this.enqueueTask(sessionId, async () => {
            await this.compareAfterAction(sessionId, ['initial']);
        });
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

  window.addEventListener('popstate', () => {
    emit({ type: 'navigate', url: window.location.href });
  });

  console.log('[QA Vision] Recorder active on this page');
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
        if (!session)
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
            if (current.pendingActions === 0 && current.uncomparedSteps.length && current.isRunning && !current.isPaused) {
                const steps = current.uncomparedSteps.splice(0);
                await this.compareAfterAction(sessionId, steps);
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
        const target = mapDevUrlToProd(devHref, session.devUrl, session.prodUrl);
        if (!target) {
            const message = `DEV is at ${urlForLog(devHref)}, outside its base URL — PROD cannot be aligned. Navigate DEV back inside ${urlForLog(session.devUrl)}.`;
            this.log(sessionId, `Resync failed: ${message}`, 'Executed', 'Error');
            return { ok: false, message };
        }
        try {
            await session.prodPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const recorderOk = await this.injectRecorderScript(session.devPage);
            this.log(sessionId, `Resynchronized: PROD navigated to ${urlForLog(target)} (DEV at ${urlForLog(devHref)}); recorder ${recorderOk ? 'active' : 'NOT active'}`, 'Synced', recorderOk ? 'Synced' : 'Error');
            this.setSyncState(sessionId, false, 'resynchronized');
            session.uncomparedSteps.push('resync');
            await this.enqueueTask(sessionId, async () => {
                const steps = session.uncomparedSteps.splice(0);
                await this.compareAfterAction(sessionId, steps.length ? steps : ['resync']);
            });
            return {
                ok: recorderOk,
                message: recorderOk
                    ? `PROD aligned to ${urlForLog(target)}. Page state such as typed values or open dialogs is not copied.`
                    : 'PROD aligned, but the DEV recorder could not be re-armed. Reload the DEV window.',
                devUrl: urlForLog(devHref),
                prodUrl: urlForLog(target),
            };
        }
        catch (err) {
            const message = `PROD navigation failed: ${String(err?.message || err).split('\n')[0]}`;
            this.log(sessionId, `Resync failed: ${message}`, 'Executed', 'Error');
            return { ok: false, message };
        }
    }
    async setPaused(sessionId, paused) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        session.isPaused = paused;
        this.log(sessionId, paused ? 'Session paused' : 'Session resumed', 'OK', 'OK');
    }
    /** Replay one DEV action on PROD. Returns true when the DEV action happened (so a comparison is due). */
    async replicateAction(sessionId, action, stepId = "manual") {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isRunning || session.isPaused)
            return false;
        const { prodPage } = session;
        const label = action.testId || action.ariaLabel || action.labelText || action.text || action.name || action.selector || action.type;
        // Checkbox/radio "change" events arrive as fill; the click event already replicates them.
        if ((action.type === 'fill' || action.type === 'input') && /^(checkbox|radio)$/.test(action.inputType || '')) {
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
                    await target.locator.click({ timeout: 5000 }); // no force: respect PROD actionability
                    this.log(sessionId, `Clicked ${label} (matched by ${target.strategy})`, 'Success', 'Success');
                    break;
                }
                case 'dblclick': {
                    const target = await this.resolveProdTarget(prodPage, action);
                    if (!target.ok)
                        return this.recordReplayFailure(sessionId, action, label, stepId, target.classification, target.detail);
                    await target.locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
                    await target.locator.dblclick({ timeout: 5000 });
                    this.log(sessionId, `Double-clicked ${label} (matched by ${target.strategy})`, 'Success', 'Success');
                    break;
                }
                case 'hover': {
                    const target = await this.resolveProdTarget(prodPage, action);
                    if (!target.ok)
                        return this.recordReplayFailure(sessionId, action, label, stepId, target.classification, target.detail);
                    await target.locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
                    await target.locator.hover({ timeout: 5000 });
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
                    await prodPage.evaluate((y) => window.scrollTo(0, y || 0), action.y || 0);
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
            const results = [];
            const seen = new Set();
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
                // Skip pure whitespace / tiny noise
                if (t.length === 1 && !/[0-9a-zA-Z]/.test(t))
                    return;
                const key = `${testId || label}|${t}`.toLowerCase();
                if (seen.has(key))
                    return;
                seen.add(key);
                results.push({
                    key: testId || label || tag,
                    label: label || tag,
                    text: t.slice(0, 500),
                    tag,
                    testId: testId || '',
                });
            };
            // Prefer stable test ids
            document.querySelectorAll('[data-testid]').forEach((el) => {
                const testId = el.getAttribute('data-testid') || '';
                push(testId, fieldText(el), el.tagName.toLowerCase(), testId);
            });
            // Headings, buttons, labels, banners, stats
            const selectors = [
                'h1',
                'h2',
                'h3',
                'button',
                'a',
                'label',
                '[role="button"]',
                'input',
                'textarea',
                'select',
                'p',
                '.dev-banner',
                '.prod-banner',
                '[class*="banner"]',
            ];
            document.querySelectorAll(selectors.join(',')).forEach((el, index) => {
                const tag = el.tagName.toLowerCase();
                const testId = el.getAttribute('data-testid') || '';
                if (testId)
                    return; // already captured
                let text = '';
                if (tag === 'input' || tag === 'textarea') {
                    const input = el;
                    text = fieldText(el) || input.name || input.type || '';
                    push(input.name || input.type || `input-${index}`, text, tag, '');
                }
                else {
                    text = el.textContent || '';
                    const label = clean(text).slice(0, 40) || `${tag}-${index}`;
                    push(label, text, tag, '');
                }
            });
            // Notable metric-like numbers near labels
            document.querySelectorAll('div, span').forEach((el) => {
                const t = clean(el.textContent || '');
                if (!t || t.length > 40)
                    return;
                if (/^\$?[\d,.]+[MkK]?$/.test(t) || /users|revenue|active/i.test(t)) {
                    push(t.slice(0, 30), t, el.tagName.toLowerCase(), '');
                }
            });
            return results.slice(0, 200);
        }, extract_1.SENSITIVE_FIELD_RE.source);
    }
    diffPageContent(devItems, prodItems) {
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
        // De-dupe by dev+prod pair
        const seen = new Set();
        return diffs.filter((d) => {
            const k = `${d.devValue}||${d.prodValue}`;
            if (seen.has(k))
                return false;
            seen.add(k);
            return true;
        }).slice(0, 40);
    }
    /** Wait until a page has a parsed document and its UI has had a moment to settle. */
    async waitForSettled(page, settleMs) {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
        // Let in-flight API calls finish so network logs are drained consistently on both sides (non-fatal)
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });
        await page.waitForTimeout(settleMs);
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
            const shoot = (page) => {
                const shotOpts = { type: 'png', mask: cap.maskSelectors.map((m) => page.locator(m)) };
                return cap.scopeSelector
                    ? page.locator(cap.scopeSelector).first().screenshot(shotOpts)
                    : page.screenshot({ ...shotOpts, fullPage: cap.fullPage });
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
            fs.writeFileSync(devPath, devScreenshot);
            fs.writeFileSync(prodPath, prodScreenshot);
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
            // 1b) Structural comparisons (DOM, CSS, layout, a11y, data, network, console) under a time budget
            const budgetStart = Date.now();
            const budgetMs = comparisonBudgetMs();
            let budgetExceeded = false;
            let structuralFailure = '';
            let timer;
            try {
                const extractArg = {
                    scopeSelector: cap.scopeSelector,
                    maxElements: 400,
                    maxRows: 50,
                    sensitiveSource: extract_1.SENSITIVE_FIELD_RE.source,
                    styleProps: [...extract_1.STYLE_PROPS],
                    attrAllowlist: [...extract_1.ATTR_ALLOWLIST],
                };
                const timeout = (p) => Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('budget')), budgetMs); })]);
                const [devSnap, prodSnap] = await timeout(Promise.all([session.devPage.evaluate(extract_1.extractPageSnapshot, extractArg), session.prodPage.evaluate(extract_1.extractPageSnapshot, extractArg)]));
                const { pairs } = (0, dom_diff_1.pairElements)(devSnap.elements, prodSnap.elements);
                // DEV runs ahead of PROD while actions are still queued: keep the logs for the comparison that follows
                const deferLogs = session.pendingActions > 0;
                const drafts = [
                    ...(0, dom_diff_1.diffDom)(devSnap.elements, prodSnap.elements),
                    ...(0, css_diff_1.diffCss)(pairs, { layoutTolerancePx: cap.layoutTolerancePx }),
                    ...(0, a11y_diff_1.diffA11y)(pairs),
                    ...(0, data_rules_1.diffData)(pairs, devSnap.tables, prodSnap.tables, session.dataRules),
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
            // 2) Visual summary
            if (ratio > cap.visualDiffRatio && textDiffs.length === 0) {
                tally(this.recordMismatch(sessionId, {
                    component: 'Viewport appearance',
                    type: 'Visual',
                    devValue: 'See DEV screenshot',
                    prodValue: `${(ratio * 100).toFixed(1)}% of pixels differ from DEV`,
                    severity: ratio > 0.1 ? 'high' : 'medium',
                    description: `Visual difference of ${(ratio * 100).toFixed(1)}% with no extractable text change. Colors, spacing, or images likely differ.`,
                    ...evidence,
                }));
            }
            else if (ratio > 0.05 && textDiffs.length > 0) {
                tally(this.recordMismatch(sessionId, {
                    component: 'Viewport (visual context)',
                    type: 'Visual',
                    devValue: 'DEV screenshot attached',
                    prodValue: `PROD screenshot attached — ${(ratio * 100).toFixed(1)}% pixels differ`,
                    severity: 'low',
                    description: 'Visual context for the text differences on this page. Use the side-by-side screenshots for layout/color comparison.',
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
        const img1 = pngjs_1.PNG.sync.read(buf1);
        const img2 = pngjs_1.PNG.sync.read(buf2);
        if (img1.width !== img2.width || img1.height !== img2.height) {
            // Still try to build side-by-side with sharp if available
            const sbs = await this.writeSideBySide(buf1, buf2, sideBySidePath);
            return { ratio: 1.0, sideBySidePath: sbs };
        }
        const diff = new pngjs_1.PNG({ width: img1.width, height: img1.height });
        const numDiffPixels = (0, pixelmatch_1.default)(img1.data, img2.data, diff.data, img1.width, img1.height, {
            threshold: pixelThreshold,
            includeAA: true,
            diffColor: [255, 0, 0],
            alpha: 0.6,
        });
        // Overlay red diff on top of a faded DEV screenshot for clearer evidence
        const overlay = new pngjs_1.PNG({ width: img1.width, height: img1.height });
        for (let i = 0; i < img1.data.length; i += 4) {
            const isDiff = diff.data[i] > 0 || diff.data[i + 1] > 0 || diff.data[i + 2] > 0;
            if (isDiff) {
                overlay.data[i] = 255;
                overlay.data[i + 1] = 40;
                overlay.data[i + 2] = 40;
                overlay.data[i + 3] = 255;
            }
            else {
                // dimmed original
                overlay.data[i] = Math.floor(img1.data[i] * 0.55);
                overlay.data[i + 1] = Math.floor(img1.data[i + 1] * 0.55);
                overlay.data[i + 2] = Math.floor(img1.data[i + 2] * 0.55);
                overlay.data[i + 3] = 255;
            }
        }
        let diffPath;
        try {
            fs.mkdirSync(path.dirname(preferredDiffPath), { recursive: true });
            fs.writeFileSync(preferredDiffPath, pngjs_1.PNG.sync.write(overlay));
            diffPath = preferredDiffPath;
        }
        catch {
            /* non-fatal */
        }
        const sbs = await this.writeSideBySide(buf1, buf2, sideBySidePath, pngjs_1.PNG.sync.write(overlay));
        return {
            ratio: numDiffPixels / (img1.width * img1.height),
            diffPath,
            sideBySidePath: sbs,
        };
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
        this.io?.emit('log', { sessionId, log: entry });
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
            this.io?.emit('mismatch-update', { sessionId, mismatch: existing });
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
        this.io?.emit('mismatch', { sessionId, mismatch: fullMismatch });
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
            this.io?.emit('mismatch-update', { sessionId: session.id, mismatch: finding });
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
                    this.io?.emit('mismatch-update', { sessionId: session.id, mismatch: stored ?? f });
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
                this.io?.emit('mismatch-update', { sessionId: session.id, mismatch: finding });
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
     * Live view: every 1000 ms, while the session runs, is not paused and at least one socket is connected, emit a
     * `frame {sessionId, side, data (base64 JPEG q50), url}` per side. A tick is skipped while the previous one is still
     * in flight. Password inputs (and the profile's mask selectors) are masked in the pixels; a frame whose masking
     * fails is dropped, never sent unmasked.
     */
    startFrameStream(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.frameTimer)
            return;
        const grab = async (page) => {
            try {
                const masks = ['input[type="password"]', ...session.capture.maskSelectors].map((sel) => page.locator(sel));
                const buf = await page.screenshot({ type: 'jpeg', quality: 50, mask: masks, maskColor: '#000000', timeout: 4000 });
                return buf.toString('base64');
            }
            catch {
                return null;
            }
        };
        session.frameTimer = setInterval(async () => {
            const io = this.io;
            if (!session.isRunning)
                return this.stopFrameStream(sessionId);
            if (session.frameBusy || session.isPaused || !io || io.sockets.sockets.size < 1)
                return;
            session.frameBusy = true;
            try {
                for (const [side, page] of [['dev', session.devPage], ['prod', session.prodPage]]) {
                    const data = await grab(page);
                    if (data && session.isRunning && !session.isPaused)
                        io.emit('frame', { sessionId, side, data, url: urlForLog(page.url()) });
                }
            }
            finally {
                session.frameBusy = false;
            }
        }, 1000);
        session.frameTimer.unref?.();
    }
    stopFrameStream(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session?.frameTimer)
            clearInterval(session.frameTimer);
        if (session)
            session.frameTimer = undefined;
    }
    async closeSession(sessionId) {
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
            this.log(sessionId, 'Session stopped by user', 'Stopped', 'Stopped');
            session.isRunning = false;
            this.archiveSession(session);
            await session.devBrowser.close().catch(() => { });
            await session.prodBrowser.close().catch(() => { });
            this.sessions.delete(sessionId);
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
