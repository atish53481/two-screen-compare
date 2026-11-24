import 'server-only';
import path from 'path';
import { ComparisonProfile, ProfileCredentialsInput } from './types';
import { getDataDir, storeProfileSecrets, deleteSecretFile, deleteDbCheckSecrets } from './engine/secrets';
import { openStore } from './engine/store';

const dataDir = () => getDataDir();
// Secrets and profiles share one db; getDataDir() honours QA_VISION_DATA_DIR
const store = () => openStore(path.join(dataDir(), 'qa-vision.db'));

export class ProfileManager {
  private currentProfileId: string | null = null;

  constructor() {
    this.seedDefault();
  }

  // openStore also imports legacy profiles.json / secrets.json on first open
  private seedDefault() {
    if (store().listProfiles().length > 0) return;
    const now = new Date().toISOString();
    store().saveProfile({
      id: 'default',
      name: 'Sample DEV vs PROD',
      labelA: 'DEV',
      labelB: 'PROD',
      urlA: 'http://localhost:3002',
      urlB: 'http://localhost:3003',
      safetyPolicy: 'read-only',
      safetyAllowlist: [],
      ignoreRules: ['timestamp', 'session-id', 'random-id'],
      createdAt: now,
      updatedAt: now,
    });
  }

  getAllProfiles(): ComparisonProfile[] {
    return store().listProfiles();
  }

  getProfile(id: string): ComparisonProfile | undefined {
    return store().getProfile(id);
  }

  getCurrentProfile(): ComparisonProfile | null {
    const first = store().listProfiles()[0] || null;
    if (!this.currentProfileId) return first;
    return this.getProfile(this.currentProfileId) || first;
  }

  saveProfile(
    profile: Omit<ComparisonProfile, 'id' | 'createdAt' | 'updatedAt' | 'credentialsA' | 'credentialsB'> & {
      id?: string;
      credentialsA?: ProfileCredentialsInput;
      credentialsB?: ProfileCredentialsInput;
    }
  ): ComparisonProfile {
    const now = new Date().toISOString();
    // Encrypt any plaintext password (form input only) before it can reach profiles.json
    const id = profile.id || 'profile_' + Date.now();
    const withId: any = { ...profile, id };
    profile = storeProfileSecrets(withId, dataDir(), process.env, this.getProfile(id));

    const existing = this.getProfile(id);
    const saved: ComparisonProfile = existing
      ? { ...existing, ...(profile as any), updatedAt: now }
      : { ...(profile as any), id, createdAt: now, updatedAt: now };
    store().saveProfile(saved);
    return saved;
  }

  setCurrentProfile(id: string) {
    if (this.getProfile(id)) {
      this.currentProfileId = id;
    }
  }

  deleteProfile(id: string): boolean {
    if (id === 'default') return false; // Protect default
    const old = this.getProfile(id);
    if (!store().deleteProfile(id)) return false;
    deleteDbCheckSecrets(old, dataDir());
    deleteSecretFile(dataDir(), `profile:${id}:A`);
    deleteSecretFile(dataDir(), `profile:${id}:B`);
    return true;
  }
}

export const profileManager = new ProfileManager();
