export interface ComparisonProfile {
  id: string;
  name: string;
  labelA: string;        // e.g. "DEV" or "Stage"
  labelB: string;        // e.g. "PROD" or "Production"
  urlA: string;
  urlB: string;
  credentialsA?: {
    username: string;
    password: string;
  };
  credentialsB?: {
    username: string;
    password: string;
  };
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