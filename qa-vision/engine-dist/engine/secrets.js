"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbSecretPrefix = exports.originOf = exports.DECRYPT_FAILED = exports.SecretError = void 0;
exports.getDataDir = getDataDir;
exports.loadKey = loadKey;
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.putSecretFile = putSecretFile;
exports.getSecretFile = getSecretFile;
exports.deleteSecretFile = deleteSecretFile;
exports.resolveLoginUrl = resolveLoginUrl;
exports.deleteDbCheckSecrets = deleteDbCheckSecrets;
exports.storeProfileSecrets = storeProfileSecrets;
exports.safeStoreProfileSecrets = safeStoreProfileSecrets;
exports.resolveSessionLogin = resolveSessionLogin;
exports.resolveProfileCredentials = resolveProfileCredentials;
// Encrypted secret store: AES-256-GCM blobs; keys from env or a local key file.
// Blobs live in the Store's secrets table (<dataDir>/qa-vision.db). Never plaintext.
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const store_1 = require("./store");
class SecretError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SecretError';
    }
}
exports.SecretError = SecretError;
exports.DECRYPT_FAILED = 'Stored secret cannot be decrypted — re-enter it in the profile';
function getDataDir(env = process.env) {
    return env.QA_VISION_DATA_DIR ? path_1.default.resolve(env.QA_VISION_DATA_DIR) : path_1.default.join(process.cwd(), 'data');
}
function loadKey(env, dataDir) {
    const fromEnv = env.QA_VISION_SECRET_KEY;
    if (fromEnv) {
        const key = Buffer.from(fromEnv, 'base64');
        if (key.length !== 32)
            throw new SecretError('QA_VISION_SECRET_KEY must be base64 that decodes to exactly 32 bytes');
        return key;
    }
    const file = path_1.default.join(dataDir, '.secret-key');
    if (fs_1.default.existsSync(file)) {
        const key = fs_1.default.readFileSync(file);
        if (key.length !== 32)
            throw new SecretError(`${file} is not a 32-byte key`);
        return key;
    }
    fs_1.default.mkdirSync(dataDir, { recursive: true });
    const key = crypto_1.default.randomBytes(32);
    fs_1.default.writeFileSync(file, key, { mode: 0o600 });
    console.log('Generated local secret key at data/.secret-key — set QA_VISION_SECRET_KEY to manage it yourself');
    return key;
}
function encryptSecret(plain, key) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
function decryptSecret(blob, key) {
    try {
        const [v, iv, tag, ct] = String(blob).split(':');
        if (v !== 'v1' || !iv || !tag || ct === undefined)
            throw new Error('format');
        const ivBuf = Buffer.from(iv, 'base64');
        const tagBuf = Buffer.from(tag, 'base64');
        if (ivBuf.length !== 12 || tagBuf.length !== 16)
            throw new Error('length');
        const d = crypto_1.default.createDecipheriv('aes-256-gcm', key, ivBuf, { authTagLength: 16 });
        d.setAuthTag(tagBuf);
        return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
    }
    catch {
        throw new SecretError(exports.DECRYPT_FAILED);
    }
}
// ---- blob persistence (Store.secrets; legacy secrets.json is imported on first open) ----
const storeFor = (dataDir) => (0, store_1.openStore)(path_1.default.join(dataDir, 'qa-vision.db'));
function putSecretFile(dataDir, ref, blob) {
    storeFor(dataDir).putSecret(ref, blob);
}
function getSecretFile(dataDir, ref) {
    return storeFor(dataDir).getSecret(ref);
}
function deleteSecretFile(dataDir, ref) {
    storeFor(dataDir).deleteSecret(ref);
}
// ---- profile helpers ----
const originOf = (u, base) => {
    if (typeof u !== 'string')
        return null;
    try {
        return new URL(u, base).origin;
    }
    catch {
        return null;
    }
};
exports.originOf = originOf;
/** Resolve loginPath against the side's base URL; null when it resolves to a different origin (or is invalid). */
function resolveLoginUrl(loginPath, baseUrl) {
    const baseOrigin = (0, exports.originOf)(baseUrl);
    try {
        const u = new URL(loginPath || '/', baseUrl);
        return baseOrigin && u.origin === baseOrigin ? u.toString() : null;
    }
    catch {
        return null;
    }
}
/** What a side's stored password is bound to: the side URL origin and the login page origin. */
function sideBinding(profile, side) {
    const url = side === 'A' ? profile?.urlA : profile?.urlB;
    return `${(0, exports.originOf)(url)}|${(0, exports.originOf)(profile?.login?.loginPath || '/', url)}`;
}
/** All of a profile's DB connection refs start with this; the engine refuses refs outside it. */
const dbSecretPrefix = (profileId) => `profile:${profileId}:db:`;
exports.dbSecretPrefix = dbSecretPrefix;
const dbRef = (profileId, name, side) => `${(0, exports.dbSecretPrefix)(profileId)}${encodeURIComponent(name)}:${side}`;
/**
 * DB check connection strings are write-only: `devConn`/`prodConn` (plaintext, input only) are encrypted under
 * refs derived from profile id + check name; stored checks keep only devConnRef/prodConnRef, and a ref is kept
 * only if its blob exists. Client-supplied refs are ignored. Secrets of removed or renamed checks are deleted.
 */
function storeDbCheckSecrets(profile, dataDir, env, existing) {
    const checks = profile.dbChecks;
    if (!Array.isArray(checks))
        return undefined;
    const seen = new Set();
    const out = checks.map((raw) => {
        const { devConn, prodConn, devConnRef: _d, prodConnRef: _p, devStored: _ds, prodStored: _ps, ...rest } = raw || {};
        const name = typeof rest.name === 'string' ? rest.name.trim() : '';
        if (!name)
            throw new SecretError('Every DB check needs a name');
        if (seen.has(name))
            throw new SecretError(`Duplicate DB check name: ${name}`);
        seen.add(name);
        const refs = {};
        for (const [side, plain] of [['dev', devConn], ['prod', prodConn]]) {
            const ref = dbRef(profile.id, name, side);
            if (typeof plain === 'string' && plain.length > 0)
                putSecretFile(dataDir, ref, encryptSecret(plain, loadKey(env, dataDir)));
            refs[`${side}ConnRef`] = getSecretFile(dataDir, ref) ? ref : '';
        }
        return { ...rest, name, ...refs };
    });
    const keep = new Set(out.flatMap((c) => [c.devConnRef, c.prodConnRef]));
    for (const old of Array.isArray(existing?.dbChecks) ? existing.dbChecks : []) {
        for (const r of [old?.devConnRef, old?.prodConnRef]) {
            if (typeof r === 'string' && r.startsWith((0, exports.dbSecretPrefix)(profile.id)) && !keep.has(r))
                deleteSecretFile(dataDir, r);
        }
    }
    return out;
}
/** Remove every stored DB connection secret of a profile (profile deletion). */
function deleteDbCheckSecrets(profile, dataDir) {
    if (!profile)
        return;
    for (const c of profile.dbChecks || []) {
        for (const r of [c?.devConnRef, c?.prodConnRef]) {
            if (typeof r === 'string' && r.startsWith((0, exports.dbSecretPrefix)(profile.id)))
                deleteSecretFile(dataDir, r);
        }
    }
}
/**
 * Move any plaintext credentials{A,B}.password into the encrypted store and return a profile
 * without them (username + secretRef only). Input is not mutated. Any client-supplied secretRef
 * is ignored: the ref is always derived as profile:<id>:<side> and kept only if that blob exists.
 * Throws SecretError when the key is unusable.
 */
function storeProfileSecrets(profile, dataDir, env = process.env, existing) {
    const out = { ...profile };
    const dbChecks = storeDbCheckSecrets(profile, dataDir, env, existing);
    if (dbChecks)
        out.dbChecks = dbChecks;
    for (const side of ['A', 'B']) {
        const field = `credentials${side}`;
        const c = profile[field];
        const ref = `profile:${profile.id}:${side}`;
        // A stored password is bound to the origin it was saved for: moving the URL/login page drops it,
        // even when this save omits the credentials (the caller's merge would otherwise keep the old ref)
        const moved = !!existing && sideBinding(existing, side) !== sideBinding(profile, side);
        if (moved)
            deleteSecretFile(dataDir, ref);
        if (!c) {
            const old = existing?.[field];
            if (moved && old) {
                const { password: _p, secretRef: _r, ...oldRest } = old;
                out[field] = oldRest;
            }
            continue;
        }
        const { password, secretRef: _ignored, ...rest } = c;
        if (typeof password === 'string' && password.length > 0) {
            putSecretFile(dataDir, ref, encryptSecret(password, loadKey(env, dataDir)));
            out[field] = { ...rest, secretRef: ref };
        }
        else if (getSecretFile(dataDir, ref)) {
            out[field] = { ...rest, secretRef: ref };
        }
        else {
            out[field] = rest;
        }
    }
    return out;
}
/** Like storeProfileSecrets but never throws: on failure plaintext is stripped (never kept) and `error` is set. */
function safeStoreProfileSecrets(profile, dataDir, env = process.env) {
    try {
        return { profile: storeProfileSecrets(profile, dataDir, env) };
    }
    catch (e) {
        const out = { ...profile };
        for (const f of ['credentialsA', 'credentialsB']) {
            if (out[f]) {
                const { password: _p, secretRef: _r, ...rest } = out[f];
                out[f] = rest;
            }
        }
        if (Array.isArray(out.dbChecks)) {
            out.dbChecks = out.dbChecks.map((c) => {
                const { devConn: _a, prodConn: _b, devConnRef: _c, prodConnRef: _d, ...rest } = c || {};
                return { ...rest, devConnRef: '', prodConnRef: '' };
            });
        }
        return { profile: out, error: e instanceof SecretError ? e.message : 'Could not store secret' };
    }
}
/**
 * Server-side: decide whether a profile's stored credentials may be used for a session. Credentials are
 * only released when the session's DEV/PROD origins equal the profile's urlA/urlB origins (fail closed).
 */
function resolveSessionLogin(profile, devUrl, prodUrl, dataDir, env = process.env) {
    if (!profile.login || profile.login.strategy !== 'form')
        return { ok: true };
    const pairs = [[devUrl, profile.urlA], [prodUrl, profile.urlB]];
    for (const [given, expected] of pairs) {
        const o = (0, exports.originOf)(given);
        if (!o || o !== (0, exports.originOf)(expected)) {
            return { ok: false, error: 'Session URLs do not match the profile origins — refusing to use stored credentials' };
        }
    }
    return {
        ok: true,
        login: profile.login,
        loginCredentials: {
            dev: resolveProfileCredentials(profile, 'A', dataDir, env),
            prod: resolveProfileCredentials(profile, 'B', dataDir, env),
        },
    };
}
/** Server-side only: decrypt a profile side's credentials. Failures come back as `error`, never throw. */
function resolveProfileCredentials(profile, side, dataDir, env = process.env) {
    const c = profile[`credentials${side}`];
    if (!c || !c.username || !c.secretRef)
        return { creds: null };
    try {
        const blob = getSecretFile(dataDir, c.secretRef);
        if (!blob)
            return { creds: null, error: 'No stored secret for this profile — re-enter it in the profile' };
        return { creds: { username: c.username, password: decryptSecret(blob, loadKey(env, dataDir)) } };
    }
    catch (e) {
        return { creds: null, error: e instanceof SecretError ? e.message : exports.DECRYPT_FAILED };
    }
}
