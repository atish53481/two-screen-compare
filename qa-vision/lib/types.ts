import type { LoginConfig } from './engine/types';

export interface ProfileCredentials {
  username: string;
  secretRef?: string;
}

/** Accepted on save only; encrypted and stripped before persisting. */
export type ProfileCredentialsInput = ProfileCredentials & { password?: string };

export interface ComparisonProfile {
  id: string;
  name: string;
  labelA: string;        // e.g. "DEV" or "Stage"
  labelB: string;        // e.g. "PROD" or "Production"
  urlA: string;
  urlB: string;
  /** Passwords are never stored here: they are encrypted into the secret store, referenced by secretRef. */
  credentialsA?: ProfileCredentials;
  credentialsB?: ProfileCredentials;
  login?: LoginConfig;
  safetyPolicy: 'read-only' | 'allow-safe' | 'full';
  /**
   * Actions/requests allowed on PROD despite the safety policy.
   * Plain entries match the clicked element's text / test id / label (e.g. "login-submit", "sign in").
   * "url:<fragment>" entries match request URLs (e.g. "url:/api/auth/login").
   */
  safetyAllowlist?: string[];
  ignoreRules: string[]; // e.g. ["timestamp", "session-id", "random"]
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonSession {
  id: string;
  profileId: string;
  profile: ComparisonProfile;
  isRunning: boolean;
  status: string;
  logs: any[];
  mismatches: any[];
  devBrowser?: any;
  prodBrowser?: any;
  devPage?: any;
  prodPage?: any;
}