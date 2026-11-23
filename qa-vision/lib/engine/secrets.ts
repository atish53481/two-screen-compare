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
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
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
 * without them (username + secretRef only). Input is not mutated.
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
    const { password, ...rest } = c;
    if (typeof password === 'string' && password.length > 0) {
      const ref = `profile:${profile.id}:${side}`;
      putSecretFile(dataDir, ref, encryptSecret(password, loadKey(env, dataDir)));
      out[field] = { ...rest, secretRef: ref };
    } else {
      out[field] = rest;
    }
  }
  return out;
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
