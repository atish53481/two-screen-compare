'use client';

import React, { useState } from 'react';
import type { ComparisonProfile, ProfileCredentialsInput } from '../../lib/types';
import type { CaptureSettings, LoginConfig } from '../../lib/engine/types';

interface Props {
  profile: ComparisonProfile;
  onChange: (patch: Partial<ComparisonProfile>) => void;
}

const DEFAULT_CAPTURE: CaptureSettings = {
  viewport: { width: 1280, height: 800 },
  pixelThreshold: 0.1,
  visualDiffRatio: 0.01,
  fullPage: true,
  maskSelectors: [],
  scopeSelector: '',
  settleMs: 300,
  layoutTolerancePx: 2,
};
const DEFAULT_LOGIN: LoginConfig = { strategy: 'manual', loginPath: '/', usernameSelector: '', passwordSelector: '', submitSelector: '' };

const input = 'w-full bg-zinc-950 border border-zinc-700 focus:border-sky-500 rounded-xl px-3 py-2 text-sm outline-none';
const label = 'block text-xs uppercase tracking-widest mb-1 text-zinc-400';
const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : fallback);

function JsonList({ id, title, hint, value, onValid }: { id: string; title: string; hint: string; value: unknown[]; onValid: (v: any[]) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  return (
    <div>
      <label className={label} htmlFor={id}>{title}</label>
      <textarea
        id={id}
        data-testid={id}
        rows={4}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value || '[]');
            if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
            setError('');
            onValid(parsed);
          } catch (err: any) {
            setError(err?.message || 'Invalid JSON');
          }
        }}
        className={`${input} font-mono`}
      />
      <p className="text-xs text-zinc-500 mt-1">{error ? <span className="text-rose-400">{error} (not applied)</span> : hint}</p>
    </div>
  );
}

function Credentials({ side, title, creds, onChange }: { side: 'A' | 'B'; title: string; creds?: ProfileCredentialsInput; onChange: (c: ProfileCredentialsInput) => void }) {
  const c = creds || { username: '' };
  const hasNew = Boolean(c.password);
  return (
    <fieldset className="rounded-xl border border-zinc-800 p-3 space-y-2">
      <legend className="px-1 text-xs text-zinc-400">{title}</legend>
      <div>
        <label className={label} htmlFor={`cred-user-${side}`}>Username</label>
        <input id={`cred-user-${side}`} data-testid={`cred-user-${side}`} className={input} value={c.username || ''} autoComplete="off" onChange={(e) => onChange({ ...c, username: e.target.value })} />
      </div>
      <div>
        <label className={label} htmlFor={`cred-pass-${side}`}>Password (write-only)</label>
        <input
          id={`cred-pass-${side}`}
          data-testid={`cred-pass-${side}`}
          type="password"
          autoComplete="new-password"
          className={input}
          value={c.password || ''}
          placeholder={c.stored ? '•••• stored (type to replace)' : 'Enter password'}
          onChange={(e) => onChange({ ...c, password: e.target.value })}
        />
        <div data-testid={`cred-state-${side}`} className="text-xs text-zinc-500 mt-1">
          {c.stored && !hasNew ? '•••• stored' : hasNew ? 'Will be encrypted on save' : 'No password stored'}
        </div>
      </div>
    </fieldset>
  );
}

export default function ProfileSettings({ profile, onChange }: Props) {
  const capture: CaptureSettings = { ...DEFAULT_CAPTURE, ...(profile.capture as Partial<CaptureSettings>), viewport: { ...DEFAULT_CAPTURE.viewport, ...profile.capture?.viewport } };
  const login: LoginConfig = { ...DEFAULT_LOGIN, ...profile.login };
  const setCapture = (p: Partial<CaptureSettings>) => onChange({ capture: { ...capture, ...p } });
  const setLogin = (p: Partial<LoginConfig>) => onChange({ login: { ...login, ...p } });
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  return (
    <div data-testid="profile-settings" className="space-y-6 border-t border-zinc-800 pt-6">
      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-zinc-200">Capture settings</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className={label}>Viewport width</label><input type="number" className={input} value={capture.viewport.width} onChange={(e) => setCapture({ viewport: { ...capture.viewport, width: num(e.target.value, 1280) } })} /></div>
          <div><label className={label}>Viewport height</label><input type="number" className={input} value={capture.viewport.height} onChange={(e) => setCapture({ viewport: { ...capture.viewport, height: num(e.target.value, 800) } })} /></div>
          <div><label className={label}>Pixel threshold</label><input type="number" step="0.01" min="0" max="1" className={input} value={capture.pixelThreshold} onChange={(e) => setCapture({ pixelThreshold: num(e.target.value, 0.1) })} /></div>
          <div><label className={label}>Visual diff ratio</label><input type="number" step="0.001" min="0" max="1" className={input} value={capture.visualDiffRatio} onChange={(e) => setCapture({ visualDiffRatio: num(e.target.value, 0.01) })} /></div>
          <div><label className={label}>Settle (ms)</label><input type="number" className={input} value={capture.settleMs} onChange={(e) => setCapture({ settleMs: num(e.target.value, 300) })} /></div>
          <div><label className={label}>Layout tolerance (px)</label><input type="number" className={input} value={capture.layoutTolerancePx} onChange={(e) => setCapture({ layoutTolerancePx: num(e.target.value, 2) })} /></div>
          <div><label className={label}>Scope selector</label><input className={`${input} font-mono`} placeholder="whole page" value={capture.scopeSelector} onChange={(e) => setCapture({ scopeSelector: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 mt-6"><input type="checkbox" checked={capture.fullPage} onChange={(e) => setCapture({ fullPage: e.target.checked })} /> Full page</label>
        </div>
        <div>
          <label className={label}>Mask selectors (one per line)</label>
          <textarea rows={2} className={`${input} font-mono`} defaultValue={capture.maskSelectors.join('\n')} key={`mask-${profile.id}`} onBlur={(e) => setCapture({ maskSelectors: lines(e.target.value) })} />
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-zinc-200">Login</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={label}>Strategy</label>
            <select data-testid="login-strategy" className={input} value={login.strategy} onChange={(e) => setLogin({ strategy: e.target.value as LoginConfig['strategy'] })}>
              <option value="manual">Manual (log in yourself)</option>
              <option value="form">Form (auto-login with stored credentials)</option>
            </select>
          </div>
          <div><label className={label}>Login path</label><input className={`${input} font-mono`} value={login.loginPath} onChange={(e) => setLogin({ loginPath: e.target.value })} /></div>
          <div><label className={label}>Timeout (ms)</label><input type="number" className={input} value={login.timeoutMs ?? 15000} onChange={(e) => setLogin({ timeoutMs: num(e.target.value, 15000) })} /></div>
          <div><label className={label}>Username selector</label><input className={`${input} font-mono`} value={login.usernameSelector} onChange={(e) => setLogin({ usernameSelector: e.target.value })} /></div>
          <div><label className={label}>Password selector</label><input className={`${input} font-mono`} value={login.passwordSelector} onChange={(e) => setLogin({ passwordSelector: e.target.value })} /></div>
          <div><label className={label}>Submit selector</label><input className={`${input} font-mono`} value={login.submitSelector} onChange={(e) => setLogin({ submitSelector: e.target.value })} /></div>
          <div><label className={label}>Success selector</label><input className={`${input} font-mono`} value={login.successSelector || ''} onChange={(e) => setLogin({ successSelector: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Credentials side="A" title={`${profile.labelA || 'A'} credentials`} creds={profile.credentialsA} onChange={(c) => onChange({ credentialsA: c })} />
          <Credentials side="B" title={`${profile.labelB || 'B'} credentials`} creds={profile.credentialsB} onChange={(c) => onChange({ credentialsB: c })} />
        </div>
        <p className="text-xs text-zinc-500">Passwords are encrypted server-side on save and never shown again. A duplicated profile does not inherit them.</p>
      </section>

      <section className="space-y-4">
        <h4 className="text-sm font-semibold text-zinc-200">Data rules, API checks and DB checks</h4>
        <JsonList key={`dr-${profile.id}`} id="data-rules-json" title="Data rules" hint='e.g. [{"target":"tid:stat-active-users","mode":"tolerance","tolerance":5}]' value={profile.dataRules || []} onValid={(v) => onChange({ dataRules: v })} />
        <JsonList key={`api-${profile.id}`} id="api-checks-json" title="API checks" hint='e.g. [{"name":"stats","path":"/api/stats"}] (executed by a later release)' value={profile.apiChecks || []} onValid={(v) => onChange({ apiChecks: v })} />
        <JsonList key={`db-${profile.id}`} id="db-checks-json" title="DB checks" hint='e.g. [{"name":"user count"}] (executed by a later release)' value={profile.dbChecks || []} onValid={(v) => onChange({ dbChecks: v })} />
      </section>
    </div>
  );
}
