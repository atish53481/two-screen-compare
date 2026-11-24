"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.originOf = exports.DECRYPT_FAILED = exports.SecretError = void 0;
exports.getDataDir = getDataDir;
exports.loadKey = loadKey;
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.putSecretFile = putSecretFile;
exports.getSecretFile = getSecretFile;
exports.deleteSecretFile = deleteSecretFile;
exports.resolveLoginUrl = resolveLoginUrl;
exports.storeProfileSecrets = storeProfileSecrets;
exports.safeStoreProfileSecrets = safeStoreProfileSecrets;
exports.resolveSessionLogin = resolveSessionLogin;
exports.resolveProfileCredentials = resolveProfileCredentials;
// Encrypted secret store: AES-256-GCM blobs; keys from env or a local key file.
// Blobs live in <dataDir>/secrets.json (ref -> blob). Never plaintext.
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
// ---- blob persistence (secrets.json; Task 12 migrates these into the Store) ----
const secretsPath = (dataDir) => path_1.default.join(dataDir, 'secrets.json');
function readMap(dataDir) {
    try {
        return JSON.parse(fs_1.default.readFileSync(secretsPath(dataDir), 'utf-8')) || {};
    }
    catch {
        return {};
    }
}
function writeMap(dataDir, map) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
    fs_1.default.writeFileSync(secretsPath(dataDir), JSON.stringify(map, null, 2), { mode: 0o600 });
}
function putSecretFile(dataDir, ref, blob) {
    const map = readMap(dataDir);
    map[ref] = blob;
    writeMap(dataDir, map);
}
function getSecretFile(dataDir, ref) {
    const v = readMap(dataDir)[ref];
    return typeof v === 'string' ? v : null;
}
function deleteSecretFile(dataDir, ref) {
    const map = readMap(dataDir);
    if (ref in map) {
        delete map[ref];
        writeMap(dataDir, map);
    }
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
/**
 * Move any plaintext credentials{A,B}.password into the encrypted store and return a profile
 * without them (username + secretRef only). Input is not mutated. Any client-supplied secretRef
 * is ignored: the ref is always derived as profile:<id>:<side> and kept only if that blob exists.
 * Throws SecretError when the key is unusable.
 */
function storeProfileSecrets(profile, dataDir, env = process.env, existing) {
    const out = { ...profile };
    for (const side of ['A', 'B']) {
        const field = `credentials${side}`;
        const c = profile[field];
        if (!c)
            continue;
        const { password, secretRef: _ignored, ...rest } = c;
        const ref = `profile:${profile.id}:${side}`;
        // A stored password is bound to the origin it was saved for: moving the URL/login page drops it
        if (existing && sideBinding(existing, side) !== sideBinding(profile, side)) {
            deleteSecretFile(dataDir, ref);
        }
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
