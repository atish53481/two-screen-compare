import 'server-only';
import fs from 'fs';
import path from 'path';
import { ComparisonProfile, ProfileCredentialsInput } from './types';
import { getDataDir, storeProfileSecrets, safeStoreProfileSecrets, deleteSecretFile } from './engine/secrets';

const dataDir = () => getDataDir();
const profilesFile = () => path.join(dataDir(), 'profiles.json');

export class ProfileManager {
  private profiles: ComparisonProfile[] = [];
  private currentProfileId: string | null = null;

  constructor() {
    this.loadProfiles();
  }

  private ensureDataDir() {
    const dir = dataDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadProfiles() {
    this.ensureDataDir();
    if (fs.existsSync(profilesFile())) {
      try {
        this.profiles = JSON.parse(fs.readFileSync(profilesFile(), 'utf-8'));
      } catch (e) {
        this.profiles = [];
      }
      // Migrate any legacy plaintext passwords into the encrypted store
      let migrated = false;
      this.profiles = this.profiles.map((p) => {
        const hasPlain = [(p as any).credentialsA, (p as any).credentialsB].some((c) => c && 'password' in c);
        if (!hasPlain) return p;
        migrated = true;
        const r = safeStoreProfileSecrets(p, dataDir());
        if (r.error) console.error(`Profile "${p.id}": could not encrypt legacy password (${r.error}); it was removed from profiles.json`);
        return r.profile;
      });
      if (migrated) this.saveProfiles();
    } else {
      // Create default profile
      this.profiles = [{
        id: 'default',
        name: 'Sample DEV vs PROD',
        labelA: 'DEV',
        labelB: 'PROD',
        urlA: 'http://localhost:3002',
        urlB: 'http://localhost:3003',
        safetyPolicy: 'read-only',
        safetyAllowlist: [],
        ignoreRules: ['timestamp', 'session-id', 'random-id'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }];
      this.saveProfiles();
    }
  }

  private saveProfiles() {
    this.ensureDataDir();
    fs.writeFileSync(profilesFile(), JSON.stringify(this.profiles, null, 2));
  }

  getAllProfiles(): ComparisonProfile[] {
    return this.profiles;
  }

  getProfile(id: string): ComparisonProfile | undefined {
    return this.profiles.find(p => p.id === id);
  }

  getCurrentProfile(): ComparisonProfile | null {
    if (!this.currentProfileId) return this.profiles[0] || null;
    return this.getProfile(this.currentProfileId) || this.profiles[0] || null;
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
    profile = storeProfileSecrets(withId, dataDir());

    if (profile.id && this.getProfile(profile.id)) {
      // Update existing
      const index = this.profiles.findIndex(p => p.id === profile.id);
      this.profiles[index] = {
        ...this.profiles[index],
        ...profile,
        updatedAt: now,
      };
    } else {
      // Create new
      const newProfile: ComparisonProfile = {
        ...profile as any,
        id: profile.id || 'profile_' + Date.now(),
        createdAt: now,
        updatedAt: now,
      };
      this.profiles.push(newProfile);
    }
    
    this.saveProfiles();
    return this.getProfile(profile.id || this.profiles[this.profiles.length - 1].id)!;
  }

  setCurrentProfile(id: string) {
    if (this.getProfile(id)) {
      this.currentProfileId = id;
    }
  }

  deleteProfile(id: string): boolean {
    if (id === 'default') return false; // Protect default
    const index = this.profiles.findIndex(p => p.id === id);
    if (index === -1) return false;
    this.profiles.splice(index, 1);
    deleteSecretFile(dataDir(), `profile:${id}:A`);
    deleteSecretFile(dataDir(), `profile:${id}:B`);
    this.saveProfiles();
    return true;
  }
}

export const profileManager = new ProfileManager();
