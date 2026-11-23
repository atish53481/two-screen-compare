import 'server-only';
import fs from 'fs';
import path from 'path';
import { ComparisonProfile } from './types';

const PROFILES_FILE = path.join(process.cwd(), 'data', 'profiles.json');

export class ProfileManager {
  private profiles: ComparisonProfile[] = [];
  private currentProfileId: string | null = null;

  constructor() {
    this.loadProfiles();
  }

  private ensureDataDir() {
    const dir = path.dirname(PROFILES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadProfiles() {
    this.ensureDataDir();
    if (fs.existsSync(PROFILES_FILE)) {
      try {
        this.profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
      } catch (e) {
        this.profiles = [];
      }
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
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(this.profiles, null, 2));
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

  saveProfile(profile: Omit<ComparisonProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): ComparisonProfile {
    const now = new Date().toISOString();
    
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
    this.saveProfiles();
    return true;
  }
}

export const profileManager = new ProfileManager();
