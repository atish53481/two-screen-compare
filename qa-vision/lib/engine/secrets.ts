// Encrypted secret store: AES-256-GCM blobs; keys from env or a local key file.
// Blobs live in <dataDir>/secrets.json (ref -> blob). Never plaintext.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

export const DECRYPT_FAILED = 'Stored secret cannot be decrypted — re-enter it in the profile';

export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.QA_VISION_DATA_DIR ? path.resolve(env.QA_VISION_DATA_DIR) : path.join(process.cwd(), 'data');
}

export function loadKey(env: NodeJS.ProcessEnv, dataDir: string): Buffer {
  const fromEnv = env.QA_VISION_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new SecretError('QA_VISION_SECRET_KEY must be base64 that decodes to exactly 32 bytes');
    return key;
  }
  const file = path.join(dataDir, '.secret-key');
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new SecretError(`${file} is not a 32-byte key`);
    return key;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key, { mode: 0o600 });
  console.log('Generated local secret key at data/.secret-key — set QA_VISION_SECRET_KEY to manage it yourself');
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(blob: string, key: Buffer): string {
  try {
    const [v, iv, tag, ct] = String(blob).split(':');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('format');
    const ivBuf = Buffer.from(iv, 'base64');
    const tagBuf = Buffer.from(tag, 'base64');
    if (ivBuf.length !== 12 || tagBuf.length !== 16) throw new Error('length');
    const d = crypto.createDecipheriv('aes-256-gcm', key, ivBuf, { authTagLength: 16 });
    d.setAuthTag(tagBuf);
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new SecretError(DECRYPT_FAILED);
  }
}

// ---- blob persistence (secrets.json; Task 12 migrates these into the Store) ----

const secretsPath = (dataDir: string) => path.join(dataDir, 'secrets.json');

function readMap(dataDir: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(secretsPath(dataDir), 'utf-8')) || {};
  } catch {
    return {};
  }
}

function writeMap(dataDir: string, map: Record<string, string>) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretsPath(dataDir), JSON.stringify(map, null, 2), { mode: 0o600 });
}

export function putSecretFile(dataDir: string, ref: string, blob: string) {
  const map = readMap(dataDir);
  map[ref] = blob;
  writeMap(dataDir, map);
}

export function getSecretFile(dataDir: string, ref: string): string | null {
  const v = readMap(dataDir)[ref];
  return typeof v === 'string' ? v : null;
}

export function deleteSecretFile(dataDir: string, ref: string) {
  const map = readMap(dataDir);
  if (ref in map) {
    delete map[ref];
    writeMap(dataDir, map);
  }
}

// ---- profile helpers ----

export interface LoginCreds {
  username: string;
  password: string;
}

/**
 * Move any plaintext credentials{A,B}.password into the encrypted store and return a profile
 * without them (username + secretRef only). Input is not mutated. Any client-supplied secretRef
 * is ignored: the ref is always derived as profile:<id>:<side> and kept only if that blob exists.
 * Throws SecretError when the key is unusable.
 */
export function storeProfileSecrets<T extends { id: string; credentialsA?: any; credentialsB?: any }>(
  profile: T,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): T {
  const out: any = { ...profile };
  for (const side of ['A', 'B'] as const) {
    const field = `credentials${side}`;
    const c = (profile as any)[field];
    if (!c) continue;
    const { password, secretRef: _ignored, ...rest } = c;
    const ref = `profile:${profile.id}:${side}`;
    if (typeof password === 'string' && password.length > 0) {
      putSecretFile(dataDir, ref, encryptSecret(password, loadKey(env, dataDir)));
      out[field] = { ...rest, secretRef: ref };
    } else if (getSecretFile(dataDir, ref)) {
      out[field] = { ...rest, secretRef: ref };
    } else {
      out[field] = rest;
    }
  }
  return out;
}

/** Like storeProfileSecrets but never throws: on failure plaintext is stripped (never kept) and `error` is set. */
export function safeStoreProfileSecrets<T extends { id: string; credentialsA?: any; credentialsB?: any }>(
  profile: T,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): { profile: T; error?: string } {
  try {
    return { profile: storeProfileSecrets(profile, dataDir, env) };
  } catch (e: any) {
    const out: any = { ...profile };
    for (const f of ['credentialsA', 'credentialsB']) {
      if (out[f]) {
        const { password: _p, secretRef: _r, ...rest } = out[f];
        out[f] = rest;
      }
    }
    return { profile: out, error: e instanceof SecretError ? e.message : 'Could not store secret' };
  }
}

const originOf = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

export type SessionLoginResolution =
  | { ok: true; login?: any; loginCredentials?: { dev: ReturnType<typeof resolveProfileCredentials>; prod: ReturnType<typeof resolveProfileCredentials> } }
  | { ok: false; error: string };

/**
 * Server-side: decide whether a profile's stored credentials may be used for a session. Credentials are
 * only released when the session's DEV/PROD origins equal the profile's urlA/urlB origins (fail closed).
 */
export function resolveSessionLogin(
  profile: { urlA: string; urlB: string; login?: any; credentialsA?: any; credentialsB?: any },
  devUrl: string,
  prodUrl: string,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): SessionLoginResolution {
  if (!profile.login || profile.login.strategy !== 'form') return { ok: true };
  const pairs: Array<[string, string]> = [[devUrl, profile.urlA], [prodUrl, profile.urlB]];
  for (const [given, expected] of pairs) {
    const o = originOf(given);
    if (!o || o !== originOf(expected)) {
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
export function resolveProfileCredentials(
  profile: { credentialsA?: any; credentialsB?: any },
  side: 'A' | 'B',
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): { creds: LoginCreds | null; error?: string } {
  const c = (profile as any)[`credentials${side}`];
  if (!c || !c.username || !c.secretRef) return { creds: null };
  try {
    const blob = getSecretFile(dataDir, c.secretRef);
    if (!blob) return { creds: null, error: 'No stored secret for this profile — re-enter it in the profile' };
    return { creds: { username: c.username, password: decryptSecret(blob, loadKey(env, dataDir)) } };
  } catch (e: any) {
    return { creds: null, error: e instanceof SecretError ? e.message : DECRYPT_FAILED };
  }
}
