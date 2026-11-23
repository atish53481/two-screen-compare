"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECRYPT_FAILED = exports.SecretError = void 0;
exports.getDataDir = getDataDir;
exports.loadKey = loadKey;
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.putSecretFile = putSecretFile;
exports.getSecretFile = getSecretFile;
exports.deleteSecretFile = deleteSecretFile;
exports.storeProfileSecrets = storeProfileSecrets;
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
        const d = crypto_1.default.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
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
/**
 * Move any plaintext credentials{A,B}.password into the encrypted store and return a profile
 * without them (username + secretRef only). Input is not mutated.
 */
function storeProfileSecrets(profile, dataDir, env = process.env) {
    const out = { ...profile };
    for (const side of ['A', 'B']) {
        const field = `credentials${side}`;
        const c = profile[field];
        if (!c)
            continue;
        const { password, ...rest } = c;
        if (typeof password === 'string' && password.length > 0) {
            const ref = `profile:${profile.id}:${side}`;
            putSecretFile(dataDir, ref, encryptSecret(password, loadKey(env, dataDir)));
            out[field] = { ...rest, secretRef: ref };
        }
        else {
            out[field] = rest;
        }
    }
    return out;
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
