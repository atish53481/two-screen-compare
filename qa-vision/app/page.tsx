'use client';

import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, RefreshCw, Download, Settings, AlertTriangle, CheckCircle, XCircle, Eye, Power, Plus, Trash2, Edit } from 'lucide-react';
import { format } from 'date-fns';
import type { ComparisonProfile } from '../lib/types';



interface Mismatch {
  id: string;
  timestamp: string;
  page: string;
  component: string;
  type: string;
  devValue: string;
  prodValue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  aiAnalysis?: string;
  classification?: string;
  occurrences?: number;
  stepIds?: string[];
}

interface LogEntry {
  id: string;
  timestamp: string;
  action: string;
  devResult: string;
  prodResult: string;
  status: 'match' | 'mismatch' | 'skipped' | 'info';
}

const QA_VISION = () => {
  // Dynamic Profile System
  const [profiles, setProfiles] = useState<ComparisonProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('default');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [newProfile, setNewProfile] = useState<Partial<ComparisonProfile>>({
    name: 'New Comparison Profile',
    labelA: 'DEV',
    labelB: 'PROD',
    urlA: 'https://',
    urlB: 'https://',
    safetyPolicy: 'read-only',
    safetyAllowlist: [],
    ignoreRules: ['timestamp', 'session-id', 'random'],
  });

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedMismatch, setSelectedMismatch] = useState<Mismatch | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'profiles' | 'logs' | 'report'>('profiles');
  const [status, setStatus] = useState('QA Vision Master Ready — Load or create a comparison profile');
  const [lastReportMeta, setLastReportMeta] = useState<{
    id: string;
    mismatches: number;
    logs: number;
  } | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const currentProfile = profiles.find(p => p.id === selectedProfileId) || profiles[0];

  // Load profiles from API + Socket.IO
  useEffect(() => {
    fetchProfiles();

    // Real-time Socket.IO connection
    let socket: any = null;
    const initSocket = () => {
      if (typeof window !== 'undefined' && (window as any).io) {
        socket = (window as any).io('http://localhost:3001', {
          path: '/socket.io',
          reconnection: true,
          reconnectionAttempts: 5
        });

        socket.on('connect', () => console.log('🔌 QA Vision Master connected to real-time engine'));
        socket.on('log', (data: any) => {
          if (data?.log) setLogs(prev => [data.log, ...prev].slice(0, 1000));
        });
        socket.on('mismatch', (data: any) => {
          if (data?.mismatch) setMismatches(prev => [data.mismatch, ...prev].slice(0, 500));
        });
        socket.on('mismatch-update', (data: any) => {
          const m = data?.mismatch;
          if (m?.id) setMismatches(prev => prev.map(x => (x.id === m.id ? { ...x, ...m } : x)));
        });
        socket.on('sync-state', (data: any) => {
          if (data?.outOfSync) setStatus(`⚠️ OUT OF SYNC — ${data.detail}. Use RESYNCHRONIZE BROWSERS.`);
        });
      }
    };

    const timer = setTimeout(initSocket, 800);
    return () => {
      clearTimeout(timer);
      if (socket) socket.disconnect();
    };
  }, []);

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/profiles');
      const data = await res.json();
      if (data.success) {
        setProfiles(data.profiles);
        if (data.profiles.length > 0 && !selectedProfileId) {
          setSelectedProfileId(data.profiles[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch profiles', err);
    }
  };

  // Real synchronized session with recorder
  const startComparison = async () => {
    if (isRunning || isStopping || !currentProfile) return;

    setStatus('🚀 Launching Playwright DEV + PROD browsers and installing recorder...');
    setLogs([]);
    setMismatches([]);
    setSelectedMismatch(null);
    addLog('Launching real session with recorder', 'Launching', 'Launching', 'info');

    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          devUrl: currentProfile.urlA,
          prodUrl: currentProfile.urlB,
          projectName: currentProfile.name,
          safetyPolicy: currentProfile.safetyPolicy || 'read-only',
          safetyAllowlist: currentProfile.safetyAllowlist || [],
          ignoreRules: currentProfile.ignoreRules || [],
        }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.sessionId) {
        setSessionId(data.sessionId);
        setIsRunning(true);
        setIsPaused(false);
        setMismatches([]);
        setStatus(
          '🎤 RECORDER ACTIVE — Use only the Playwright window titled "QA Vision DEV". Actions mirror to the PROD window. Do not use normal Chrome tabs.'
        );
        setActiveTab('dashboard');
      } else {
        const msg = data?.error || `HTTP ${res.status}`;
        setIsRunning(false);
        setSessionId(null);
        setStatus(`❌ Failed to start session: ${msg}`);
        addLog(`Session launch failed: ${msg}`, 'Error', 'Error', 'mismatch');
      }
    } catch (err: any) {
      console.error('Session start error:', err);
      setIsRunning(false);
      setSessionId(null);
      setStatus(`❌ Session start error: ${err?.message || 'network/API failure'}. Is Playwright installed?`);
      addLog(`Session start error: ${err?.message || 'unknown'}`, 'Error', 'Error', 'mismatch');
    }
  };

  const pauseComparison = async () => {
    if (!isRunning || isStopping) return;
    const next = !isPaused;
    setIsPaused(next);
    setStatus(next ? 'Paused — replication suspended' : 'Synchronized — monitoring DEV actions');
    try {
      if (sessionId) {
        await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause', sessionId, paused: next }),
        });
      }
    } catch (e) {
      console.warn('Pause API failed', e);
    }
  };

  const stopComparison = async () => {
    if (!isRunning || isStopping) return;

    setIsStopping(true);
    setIsPaused(false);
    setStatus('🛑 Stopping real browser sessions and cleaning up...');

    try {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', sessionId })
      });
    } catch (e) {
      console.warn('Backend stop request failed (normal if in demo)');
    }

    setIsRunning(false);
    setIsStopping(false);
    setSessionId(null);
    setStatus('✅ Session stopped. Results below are kept — click Export PDF Report for the consolidated report.');
  };

  const [isResyncing, setIsResyncing] = useState(false);
  const resync = async () => {
    if (!sessionId || isResyncing) return;
    setIsResyncing(true);
    setStatus('Resynchronizing: aligning PROD to the DEV page…');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resync', sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      setStatus(data?.ok ? `✅ ${data.message}` : `❌ Resync failed: ${data?.message || data?.error || 'HTTP ' + res.status}`);
    } catch (e: any) {
      setStatus(`❌ Resync failed: ${e?.message || 'network error'}`);
    } finally {
      setIsResyncing(false);
    }
  };

  const launchEnvironments = async () => {
    if (!currentProfile) {
      setStatus('❌ Select or create a comparison profile first');
      setActiveTab('profiles');
      return;
    }

    if (isRunning || isStopping) {
      setStatus('A session is already active. Stop it before launching again.');
      return;
    }

    const urlA = currentProfile.urlA?.trim();
    const urlB = currentProfile.urlB?.trim();

    if (!urlA || !urlB || urlA === 'https://' || urlB === 'https://') {
      setStatus('❌ Profile URLs are incomplete. Set both environment URLs in Manage Profiles.');
      setActiveTab('profiles');
      return;
    }

    await startComparison();
  };

  const loadProfile = (id: string) => {
    setSelectedProfileId(id);
    const profile = profiles.find(p => p.id === id);
    if (profile) {
      setStatus(`Loaded profile: ${profile.name} (${profile.labelA} vs ${profile.labelB})`);
    }
  };

  const saveCurrentProfile = async () => {
    if (!currentProfile) return;
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', profile: currentProfile })
      });
      const data = await res.json();
      if (data.success) {
        await fetchProfiles();
        setStatus('Profile saved successfully');
      }
    } catch (err) {
      setStatus('Failed to save profile');
    }
  };

  const createNewProfile = async () => {
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', profile: newProfile })
      });
      const data = await res.json();
      if (data.success) {
        await fetchProfiles();
        setSelectedProfileId(data.profile.id);
        setIsEditingProfile(false);
        setStatus(`New profile created: ${data.profile.name}`);
      }
    } catch (err) {
      setStatus('Failed to create profile');
    }
  };

  const deleteProfile = async (id: string) => {
    if (id === 'default') {
      setStatus('Cannot delete default profile');
      return;
    }
    try {
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id })
      });
      await fetchProfiles();
      setSelectedProfileId('default');
      setStatus('Profile deleted');
    } catch (err) {
      setStatus('Failed to delete profile');
    }
  };

  const addLog = (action: string, devResult: string, prodResult: string, status: LogEntry['status']) => {
    const newLog: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action,
      devResult,
      prodResult,
      status,
    };
    setLogs(prev => [newLog, ...prev].slice(0, 1000));
  };

  const generateReport = async () => {
    if (isGeneratingReport) return;
    setIsGeneratingReport(true);
    setActiveTab('report');
    setStatus('Generating PDF report with actual differences and evidence...');

    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          projectName: currentProfile?.name || 'QA Vision Comparison',
          devUrl: currentProfile?.urlA,
          prodUrl: currentProfile?.urlB,
          logs,
          mismatches,
        }),
      });

      const contentType = res.headers.get('Content-Type') || '';
      if (!res.ok || !contentType.includes('pdf')) {
        const errBody = await res.json().catch(async () => ({
          error: await res.text().catch(() => `HTTP ${res.status}`),
        }));
        throw new Error(errBody.error || `Report failed (HTTP ${res.status})`);
      }

      const buffer = await res.arrayBuffer();
      if (!buffer || buffer.byteLength < 100) {
        throw new Error('PDF response was empty');
      }

      const blob = new Blob([buffer], { type: 'application/pdf' });
      const reportId =
        res.headers.get('X-Report-Id') || `qa-vision-report-${Date.now()}`;
      const mismatchCount = Number(res.headers.get('X-Mismatch-Count') || mismatches.length);
      const logCount = Number(res.headers.get('X-Log-Count') || logs.length);
      const filename = `${reportId}.pdf`;

      const url = URL.createObjectURL(blob);

      // Primary: anchor download
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Fallback: open PDF in a new tab so the user can Save As if download is blocked
      window.setTimeout(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }, 250);

      setLastReportMeta({
        id: reportId,
        mismatches: mismatchCount,
        logs: logCount,
      });
      setStatus(
        `✅ PDF ready: ${filename} (${mismatchCount} differences, ${logCount} actions). Check your Downloads folder, or the new browser tab. Server copy: qa-vision/reports/${reportId}/`
      );
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ Report generation failed: ${err?.message || 'unknown error'}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const severityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-100';
      case 'high': return 'text-orange-600 bg-orange-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-blue-600 bg-blue-100';
    }
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500">
            <Eye className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">QA VISION AI</h1>
            <p className="text-xs text-zinc-400 -mt-1">DEV vs PRODUCTION COMPARISON PLATFORM</p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div className="px-4 py-1 rounded-full bg-zinc-800 text-xs font-mono text-emerald-400">
            {currentProfile ? `${currentProfile.labelA} vs ${currentProfile.labelB}` : 'No Profile Selected'}
          </div>
          <div className="px-4 py-1 rounded-full bg-zinc-800 text-xs font-mono text-zinc-400">
            {currentProfile?.name || 'QA Vision Master'}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={launchEnvironments}
            className="flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-all bg-violet-600 hover:bg-violet-500 text-white"
          >
            <Power className="h-4 w-4" />
            LAUNCH ENVIRONMENTS
          </button>

          <button
            onClick={() => setActiveTab('profiles')}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 hover:bg-zinc-800 transition-colors"
          >
            <Settings className="h-4 w-4" />
            Manage Profiles
          </button>
          <button
            onClick={generateReport}
            disabled={isGeneratingReport}
            className="flex items-center gap-2 rounded-lg bg-white text-black px-5 py-2 hover:bg-zinc-200 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download className="h-4 w-4" />
            {isGeneratingReport ? 'Generating PDF…' : 'Export PDF Report'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Controls */}
        <div className="w-80 border-r border-zinc-800 bg-zinc-900 p-6 flex flex-col">
          <div className="mb-8">
            <div className="uppercase text-xs tracking-widest text-zinc-500 mb-3">SESSION CONTROLS</div>

            <div className="space-y-3">
              {isRunning ? (
                <>
                  <div className="w-full py-3 px-4 bg-emerald-900/50 border border-emerald-500 rounded-2xl text-center text-emerald-400 text-sm font-medium">
                    {isPaused ? '⏸ SESSION PAUSED' : '🔄 REAL SYNCHRONIZED SESSION ACTIVE'}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={pauseComparison}
                      disabled={isStopping}
                      className={`flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isPaused ? 'bg-amber-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                    >
                      {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                      {isPaused ? 'RESUME' : 'PAUSE'}
                    </button>
                    <button
                      type="button"
                      onClick={stopComparison}
                      disabled={isStopping}
                      className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 py-4 rounded-2xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Square className="h-5 w-5" />
                      {isStopping ? 'STOPPING…' : 'STOP'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={resync}
                    disabled={isStopping || isPaused || isResyncing}
                    className="w-full flex items-center justify-center gap-2 border border-zinc-700 hover:bg-zinc-800 py-3.5 rounded-2xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {isResyncing ? 'RESYNCHRONIZING…' : 'RESYNCHRONIZE BROWSERS'}
                  </button>
                </>
              ) : (
                <div className="w-full py-4 px-6 bg-zinc-800/60 border border-zinc-700 rounded-2xl text-center text-zinc-400 text-sm font-medium">
                  Session idle — Launch Environments opens Playwright DEV + PROD windows (not Chrome tabs)
                </div>
              )}
            </div>
          </div>

          <div className="mb-8">
            <div className="uppercase text-xs tracking-widest text-zinc-500 mb-3">CURRENT STATUS</div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="text-xs text-zinc-400">ENV A</div>
                  <div className="font-mono text-sm text-emerald-400 truncate max-w-[180px]">
                    {currentProfile?.urlA || 'http://localhost:3002'}
                  </div>
                </div>
                <div className="px-3 py-1 text-[10px] font-mono rounded-full bg-emerald-950 text-emerald-400">PRIMARY</div>
              </div>

              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-zinc-400">ENV B</div>
                  <div className="font-mono text-sm text-rose-400 truncate max-w-[180px]">
                    {currentProfile?.urlB || 'http://localhost:3003'}
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-zinc-800 text-center">
                {isRunning && !isPaused ? (
                  <div className="inline-flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-medium bg-emerald-500/10 text-emerald-400">
                    <div className="h-2 w-2 bg-emerald-400 rounded-full animate-pulse"></div>
                    LIVE SYNCHRONIZED (DEV → PROD)
                  </div>
                ) : isRunning && isPaused ? (
                  <div className="inline-flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-medium bg-amber-500/10 text-amber-400">
                    <div className="h-2 w-2 bg-amber-400 rounded-full"></div>
                    PAUSED
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-medium bg-zinc-800 text-zinc-400">
                    <div className="h-2 w-2 bg-zinc-500 rounded-full"></div>
                    IDLE
                  </div>
                )}
                <div className="text-xs text-zinc-500 mt-3">{status}</div>
              </div>
            </div>
          </div>

          <div>
            <div className="uppercase text-xs tracking-widest text-zinc-500 mb-3">SUMMARY</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-5 text-center">
                <div className="text-4xl font-semibold text-white">{logs.length}</div>
                <div className="text-xs text-zinc-400 mt-1">ACTIONS</div>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-5 text-center">
                <div className="text-4xl font-semibold text-rose-400">{mismatches.length}</div>
                <div className="text-xs text-zinc-400 mt-1">MISMATCHES</div>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-8">
            <div className="text-[10px] text-zinc-500 leading-relaxed">
              QA VISION AI v2.1 — Phase 1 Complete<br />
              Dynamic Profiles • Real Action Recorder • Semantic Replay • Safety Policy<br />
              Master Control: Any URL A (DEV) → Any URL B (PROD)
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Navigation Tabs */}
          <div className="border-b border-zinc-800 bg-zinc-900 px-8">
            <div className="flex">
              {[
                { id: 'profiles', label: 'Profiles' },
                { id: 'dashboard', label: 'Live Comparison' },
                { id: 'logs', label: 'Execution Log' },
                { id: 'report', label: 'Reports' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-8 py-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id 
                      ? 'border-sky-500 text-white' 
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Live Dashboard View */}
          {activeTab === 'dashboard' && (
            <div className="flex-1 flex flex-col p-8 overflow-hidden">
              <div className="flex-1 grid grid-cols-2 gap-6 min-h-0">
                {/* DEV Browser Window */}
                <div className="flex flex-col border border-zinc-700 rounded-3xl overflow-hidden bg-zinc-950">
                  <div className="bg-zinc-900 px-6 py-3 flex items-center justify-between border-b border-zinc-800">
                    <div className="flex items-center gap-3">
                      <div className="text-emerald-400">
                        <span className="font-mono text-xs">DEV</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono truncate max-w-[260px]">{currentProfile?.urlA || 'http://localhost:3002'}</div>
                    </div>
                    <div className="text-[10px] px-3 py-0.5 bg-emerald-900/60 text-emerald-400 rounded">PRIMARY REFERENCE</div>
                  </div>

                  <div className="flex-1 bg-zinc-950 flex items-center justify-center relative">
                    <div className="text-center">
                      <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center mb-6">
                        <Eye className="h-8 w-8 text-white" />
                      </div>
                      <div className="text-zinc-400 text-sm">DEV Environment</div>
                      <div className="text-xs text-emerald-400 mt-1 font-mono">DEV is the Master Control Environment</div>
                      {isRunning && <div className="mt-8 text-emerald-400 text-xs flex items-center gap-2 justify-center">
                        <div className="h-1.5 w-1.5 bg-current rounded-full animate-ping"></div>
                        REAL SYNC ACTIVE — Actions performed here are replicated in PRODUCTION
                      </div>}
                    </div>

                    {/* Simulated overlay hint */}
                    {isRunning && (
                      <div className="absolute bottom-8 left-8 bg-black/80 text-[10px] px-4 py-2 rounded-2xl border border-emerald-500/30 font-mono">
                        Click anywhere in this window → replicated in PRODUCTION
                      </div>
                    )}
                  </div>

                  <div className="bg-zinc-900 px-6 py-4 text-xs text-zinc-400 flex items-center justify-between font-mono border-t border-zinc-800">
                    <div>Current URL: /dashboard</div>
                    <div className={isRunning && !isPaused ? 'text-emerald-400' : 'text-zinc-500'}>
                      {isRunning && !isPaused ? 'Synced ✓' : isPaused ? 'Paused' : 'Idle'}
                    </div>
                  </div>
                </div>

                {/* PRODUCTION Browser Window */}
                <div className="flex flex-col border border-zinc-700 rounded-3xl overflow-hidden bg-zinc-950">
                  <div className="bg-zinc-900 px-6 py-3 flex items-center justify-between border-b border-zinc-800">
                    <div className="flex items-center gap-3">
                      <div className="text-rose-400">
                        <span className="font-mono text-xs">PROD</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono truncate max-w-[260px]">{currentProfile?.urlB || 'http://localhost:3003'}</div>
                    </div>
                  </div>

                  <div className="flex-1 bg-zinc-950 flex items-center justify-center relative">
                    <div className="text-center">
                      <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-400 flex items-center justify-center mb-6">
                        <Eye className="h-8 w-8 text-white" />
                      </div>
                      <div className="text-zinc-400 text-sm">PRODUCTION Environment</div>
                      <div className="text-xs text-rose-400 mt-1 font-mono">PRODUCTION — Mirrored from DEV in real-time</div>
                    </div>
                  </div>

                  <div className="bg-zinc-900 px-6 py-4 text-xs text-zinc-400 flex items-center justify-between font-mono border-t border-zinc-800">
                    <div>Current URL: /dashboard</div>
                    <div className={isRunning && !isPaused ? 'text-emerald-400' : 'text-zinc-500'}>
                      {isRunning && !isPaused ? 'Synced ✓' : isPaused ? 'Paused' : 'Idle'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Real-time Mismatches Panel */}
              <div className="mt-8">
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                    <h3 className="font-semibold text-lg">Detected Differences (Live)</h3>
                  </div>
                  <div className="text-xs text-zinc-400 font-mono">
                    {mismatches.filter(m => m.severity === 'high' || m.severity === 'critical').length} high-severity • {mismatches.filter(m => m.severity === 'medium').length} medium
                  </div>
                </div>

                <div className="bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-800 text-left text-xs text-zinc-400">
                        <th className="py-4 px-8 font-normal">PAGE</th>
                        <th className="py-4 px-6 font-normal">COMPONENT</th>
                        <th className="py-4 px-6 font-normal">TYPE</th>
                        <th className="py-4 px-6 font-normal">DEV</th>
                        <th className="py-4 px-6 font-normal">PROD</th>
                        <th className="py-4 px-6 font-normal">SEVERITY</th>
                        <th className="py-4 px-6 font-normal w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 text-sm">
                      {mismatches.map((mismatch) => (
                        <tr 
                          key={mismatch.id}
                          onClick={() => setSelectedMismatch(mismatch)}
                          className="hover:bg-zinc-800/70 cursor-pointer transition-colors group"
                        >
                          <td className="py-5 px-8 font-mono text-xs text-zinc-400">{mismatch.page}</td>
                          <td className="py-5 px-6 font-medium">{mismatch.component}</td>
                          <td className="py-5 px-6">
                            <span className="inline-block px-3 py-1 text-xs rounded-full bg-zinc-800 text-zinc-400">{mismatch.type}</span>
                          </td>
                          <td className="py-5 px-6 font-mono text-emerald-400">{mismatch.devValue}</td>
                          <td className="py-5 px-6 font-mono text-rose-400">{mismatch.prodValue}</td>
                          <td className="py-5 px-6">
                            <span className={`inline-block px-4 py-1 text-xs font-medium rounded-2xl ${severityColor(mismatch.severity)}`}>
                              {mismatch.severity.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-5 px-6 opacity-0 group-hover:opacity-100">
                            <Eye className="h-4 w-4 text-zinc-400" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Profiles Tab - Dynamic UI (Main Feature) */}
          {activeTab === 'profiles' && (
            <div className="flex-1 p-10 overflow-auto">
              <div className="max-w-4xl mx-auto space-y-10">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <h2 className="text-3xl font-semibold mb-2">Comparison Profiles</h2>
                    <p className="text-zinc-400">
                      Manage environment pairs. URL A is the master control source; URL B is mirrored during comparison.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingProfile(true);
                      setNewProfile({
                        name: 'New Comparison Profile',
                        labelA: 'DEV',
                        labelB: 'PROD',
                        urlA: 'http://localhost:3002',
                        urlB: 'http://localhost:3003',
                        safetyPolicy: 'read-only',
                        ignoreRules: ['timestamp', 'session-id', 'random'],
                      });
                    }}
                    className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 font-medium shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                    New Profile
                  </button>
                </div>

                <div className="grid gap-4">
                  {profiles.length === 0 && (
                    <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 text-zinc-400 text-sm">
                      No profiles loaded yet. Create one or wait for the default profile to appear.
                    </div>
                  )}
                  {profiles.map((profile) => {
                    const isSelected = profile.id === (currentProfile?.id || selectedProfileId);
                    return (
                      <div
                        key={profile.id}
                        className={`rounded-3xl border p-6 transition-colors ${
                          isSelected
                            ? 'border-sky-500 bg-sky-950/30'
                            : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-xl font-semibold">{profile.name}</div>
                            <div className="text-sm text-zinc-400 mt-1">
                              {profile.labelA} → {profile.labelB} · Safety: {profile.safetyPolicy}
                            </div>
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                              <div className="rounded-2xl bg-zinc-950 border border-emerald-900/50 px-4 py-3 text-emerald-400 truncate">
                                {profile.labelA}: {profile.urlA}
                              </div>
                              <div className="rounded-2xl bg-zinc-950 border border-rose-900/50 px-4 py-3 text-rose-400 truncate">
                                {profile.labelB}: {profile.urlB}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => loadProfile(profile.id)}
                              className={`px-4 py-2 rounded-xl text-sm font-medium ${
                                isSelected
                                  ? 'bg-sky-500 text-white'
                                  : 'bg-zinc-800 hover:bg-zinc-700'
                              }`}
                            >
                              {isSelected ? 'Selected' : 'Select'}
                            </button>
                            {profile.id !== 'default' && (
                              <button
                                type="button"
                                onClick={() => deleteProfile(profile.id)}
                                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm bg-rose-950 text-rose-300 hover:bg-rose-900"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {currentProfile && (
                  <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-8 space-y-6">
                    <div className="flex items-center gap-3">
                      <Edit className="h-5 w-5 text-sky-400" />
                      <h3 className="text-xl font-semibold">Edit Selected Profile</h3>
                    </div>

                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-2 text-zinc-400">Profile Name</label>
                      <input
                        type="text"
                        value={currentProfile.name}
                        onChange={(e) =>
                          setProfiles((prev) =>
                            prev.map((p) =>
                              p.id === currentProfile.id ? { ...p, name: e.target.value } : p
                            )
                          )
                        }
                        className="w-full bg-zinc-950 border border-zinc-700 focus:border-sky-500 rounded-2xl px-6 py-4 text-lg outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-emerald-400">
                          {currentProfile.labelA || 'ENV A'} Label
                        </label>
                        <input
                          type="text"
                          value={currentProfile.labelA}
                          onChange={(e) =>
                            setProfiles((prev) =>
                              prev.map((p) =>
                                p.id === currentProfile.id ? { ...p, labelA: e.target.value } : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 border border-emerald-900 focus:border-emerald-500 rounded-2xl px-6 py-4 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-rose-400">
                          {currentProfile.labelB || 'ENV B'} Label
                        </label>
                        <input
                          type="text"
                          value={currentProfile.labelB}
                          onChange={(e) =>
                            setProfiles((prev) =>
                              prev.map((p) =>
                                p.id === currentProfile.id ? { ...p, labelB: e.target.value } : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 border border-rose-900 focus:border-rose-500 rounded-2xl px-6 py-4 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-emerald-400">
                          URL A (Primary)
                        </label>
                        <input
                          type="text"
                          value={currentProfile.urlA}
                          onChange={(e) =>
                            setProfiles((prev) =>
                              prev.map((p) =>
                                p.id === currentProfile.id ? { ...p, urlA: e.target.value } : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 border border-emerald-900 focus:border-emerald-500 rounded-2xl px-6 py-4 font-mono outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-rose-400">
                          URL B (Mirror)
                        </label>
                        <input
                          type="text"
                          value={currentProfile.urlB}
                          onChange={(e) =>
                            setProfiles((prev) =>
                              prev.map((p) =>
                                p.id === currentProfile.id ? { ...p, urlB: e.target.value } : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 border border-rose-900 focus:border-rose-500 rounded-2xl px-6 py-4 font-mono outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-amber-400">
                          {currentProfile.labelB || 'ENV B'} Safety Policy
                        </label>
                        <select
                          value={currentProfile.safetyPolicy || 'read-only'}
                          onChange={(e) =>
                            setProfiles((prev) =>
                              prev.map((p) =>
                                p.id === currentProfile.id
                                  ? { ...p, safetyPolicy: e.target.value as ComparisonProfile['safetyPolicy'] }
                                  : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 border border-amber-900 focus:border-amber-500 rounded-2xl px-6 py-4 outline-none"
                        >
                          <option value="read-only">Read-only (recommended): no submits, no writes</option>
                          <option value="allow-safe">Allow safe: block destructive actions + DELETE</option>
                          <option value="full">Full: nothing blocked (dangerous)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-amber-400">
                          Safety Allowlist (comma-separated)
                        </label>
                        <input
                          type="text"
                          placeholder='e.g. login-submit, sign in, url:/api/auth'
                          defaultValue={(currentProfile.safetyAllowlist || []).join(', ')}
                          key={currentProfile.id}
                          onBlur={(e) => {
                            const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                            setProfiles((prev) =>
                              prev.map((p) => (p.id === currentProfile.id ? { ...p, safetyAllowlist: list } : p))
                            );
                          }}
                          className="w-full bg-zinc-950 border border-amber-900 focus:border-amber-500 rounded-2xl px-6 py-4 font-mono outline-none"
                        />
                        <p className="mt-2 text-xs text-zinc-500">
                          Matches clicked element text / test id / label. Use <span className="font-mono">url:</span> for request URLs.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-2 text-sky-400">
                        Ignore Rules (comma-separated)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. timestamp, session-id, numbers, regex:v\d+, text:Environment"
                        defaultValue={(currentProfile.ignoreRules || []).join(', ')}
                        key={`ignore-${currentProfile.id}`}
                        onBlur={(e) => {
                          const list = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                          setProfiles((prev) =>
                            prev.map((p) => (p.id === currentProfile.id ? { ...p, ignoreRules: list } : p))
                          );
                        }}
                        className="w-full bg-zinc-950 border border-sky-900 focus:border-sky-500 rounded-2xl px-6 py-4 font-mono outline-none"
                      />
                      <p className="mt-2 text-xs text-zinc-500">
                        <span className="font-mono">timestamp</span>, <span className="font-mono">session-id</span>/<span className="font-mono">random</span> and <span className="font-mono">numbers</span> normalize values before comparing;{' '}
                        <span className="font-mono">regex:&lt;pattern&gt;</span> normalizes matches. Any other entry (or <span className="font-mono">text:&lt;x&gt;</span>) excludes findings containing it. Suppressed counts appear in the log.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <button
                        type="button"
                        onClick={saveCurrentProfile}
                        className="flex-1 py-4 bg-white text-black rounded-2xl font-semibold hover:bg-zinc-100 transition-all"
                      >
                        Save Profile
                      </button>
                      <button
                        type="button"
                        onClick={launchEnvironments}
                        className="flex-1 py-4 bg-violet-600 hover:bg-violet-500 rounded-2xl font-semibold transition-all"
                      >
                        Launch Environments
                      </button>
                    </div>
                  </div>
                )}

                {isEditingProfile && (
                  <div className="rounded-3xl border border-violet-500/40 bg-violet-950/20 p-8 space-y-6">
                    <h3 className="text-xl font-semibold">Create New Profile</h3>
                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-2 text-zinc-400">Name</label>
                      <input
                        type="text"
                        value={newProfile.name || ''}
                        onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-700 focus:border-violet-500 rounded-2xl px-6 py-4 outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-emerald-400">Label A</label>
                        <input
                          type="text"
                          value={newProfile.labelA || ''}
                          onChange={(e) => setNewProfile({ ...newProfile, labelA: e.target.value })}
                          className="w-full bg-zinc-950 border border-emerald-900 rounded-2xl px-6 py-4 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-rose-400">Label B</label>
                        <input
                          type="text"
                          value={newProfile.labelB || ''}
                          onChange={(e) => setNewProfile({ ...newProfile, labelB: e.target.value })}
                          className="w-full bg-zinc-950 border border-rose-900 rounded-2xl px-6 py-4 outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-emerald-400">URL A</label>
                        <input
                          type="text"
                          value={newProfile.urlA || ''}
                          onChange={(e) => setNewProfile({ ...newProfile, urlA: e.target.value })}
                          className="w-full bg-zinc-950 border border-emerald-900 rounded-2xl px-6 py-4 font-mono outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-widest mb-2 text-rose-400">URL B</label>
                        <input
                          type="text"
                          value={newProfile.urlB || ''}
                          onChange={(e) => setNewProfile({ ...newProfile, urlB: e.target.value })}
                          className="w-full bg-zinc-950 border border-rose-900 rounded-2xl px-6 py-4 font-mono outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={createNewProfile}
                        className="flex-1 py-4 bg-violet-600 hover:bg-violet-500 rounded-2xl font-semibold"
                      >
                        Create Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingProfile(false)}
                        className="px-6 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div className="flex-1 p-8 overflow-auto">
              <div className="max-w-5xl mx-auto">
                <h3 className="text-xl font-semibold mb-6 flex items-center gap-3">
                  <span>Execution Timeline</span>
                  <span className="text-xs px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 font-mono">{logs.length} steps • {mismatches.length} mismatches</span>
                </h3>

                <div className="space-y-3">
                  {logs.map((log, index) => (
                    <div key={log.id} className="flex gap-6 bg-zinc-900 border border-zinc-800 rounded-3xl px-8 py-5 items-center">
                      <div className="font-mono text-xs w-28 text-zinc-500 shrink-0">{format(new Date(log.timestamp), 'HH:mm:ss')}</div>
                      <div className="flex-1 font-medium">{log.action}</div>
                      <div className="flex gap-8 text-sm">
                        <div className="text-emerald-400 font-mono">DEV: {log.devResult}</div>
                        <div className={`font-mono ${log.status === 'mismatch' ? 'text-rose-400' : log.status === 'skipped' ? 'text-amber-400' : log.status === 'info' ? 'text-zinc-400' : 'text-emerald-400'}`}>
                          PROD: {log.prodResult}
                        </div>
                      </div>
                      <div className={`px-5 py-1 text-xs rounded-3xl font-medium ${log.status === 'match' ? 'bg-emerald-900 text-emerald-400' : log.status === 'skipped' ? 'bg-amber-900 text-amber-300' : log.status === 'info' ? 'bg-zinc-800 text-zinc-400' : 'bg-rose-900 text-rose-400'}`}>
                        {log.status.toUpperCase()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Report Tab */}
          {activeTab === 'report' && (
            <div className="p-12 overflow-auto">
              <div className="max-w-3xl mx-auto bg-zinc-900 rounded-3xl p-12 border border-zinc-700">
                <div className="text-center mb-10">
                  <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 mb-6">
                    <CheckCircle className="h-9 w-9 text-white" />
                  </div>
                  <h2 className="text-3xl font-semibold mb-2">Real PDF Difference Report</h2>
                  <p className="text-zinc-400">
                    Builds a downloadable PDF from this session’s actual logs and differences
                    (not a demo popup).
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div className="bg-black/40 rounded-3xl p-8">
                    <div className="text-emerald-400 text-sm mb-1">MATCHED ACTIONS</div>
                    <div className="text-6xl font-semibold tabular-nums">
                      {logs.filter((l) => l.status === 'match').length}
                    </div>
                  </div>
                  <div className="bg-black/40 rounded-3xl p-8 border border-rose-500/30">
                    <div className="text-rose-400 text-sm mb-1">DIFFERENCES FOUND</div>
                    <div className="text-6xl font-semibold tabular-nums text-rose-400">
                      {mismatches.length}
                    </div>
                  </div>
                </div>

                {mismatches.length === 0 && logs.length === 0 && (
                  <div className="mb-6 rounded-2xl border border-amber-600/40 bg-amber-950/30 px-5 py-4 text-sm text-amber-200">
                    No session data yet. Click <strong>Launch Environments</strong>, use the
                    Playwright DEV window, then come back here so the PDF has real differences.
                  </div>
                )}

                {lastReportMeta && (
                  <div className="mb-6 rounded-2xl border border-emerald-700/40 bg-emerald-950/40 px-5 py-4 text-sm text-emerald-300">
                    Last PDF: <span className="font-mono">{lastReportMeta.id}.pdf</span>
                    {' · '}
                    {lastReportMeta.mismatches} differences · {lastReportMeta.logs} actions
                    <div className="text-emerald-400/80 text-xs mt-1">
                      Also saved on disk under qa-vision/reports/{lastReportMeta.id}/
                    </div>
                  </div>
                )}

                <div className="text-xs text-zinc-500 mb-4 font-mono break-all">{status}</div>

                <button
                  type="button"
                  onClick={() => void generateReport()}
                  disabled={isGeneratingReport}
                  className="w-full py-6 text-lg font-semibold bg-white text-black hover:bg-zinc-100 transition-all rounded-3xl flex items-center justify-center gap-4 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Download className="h-6 w-6" />
                  {isGeneratingReport ? 'GENERATING PDF…' : 'DOWNLOAD PDF WITH ACTUAL DIFFERENCES'}
                </button>

                <p className="text-center text-xs text-zinc-500 mt-8">
                  The PDF opens in a new tab and downloads. It includes summary, each difference
                  (DEV vs PROD), severity, and visual DIFF images when the session recorded them.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Detail Sidebar */}
        {selectedMismatch && (
          <div className="w-96 border-l border-zinc-700 bg-zinc-900 p-8 overflow-auto">
            <button onClick={() => setSelectedMismatch(null)} className="float-right text-zinc-400 hover:text-white">✕</button>

            <div className="uppercase tracking-[2px] text-xs text-rose-400 mb-2">MISMATCH DETAIL</div>
            <h3 className="text-2xl font-semibold leading-tight mb-6">{selectedMismatch.component}</h3>

            <div className="space-y-8">
              <div>
                <div className="text-xs text-zinc-400 mb-3">AI ROOT CAUSE ANALYSIS</div>
                <div className="bg-zinc-950 p-6 rounded-3xl text-sm leading-relaxed border border-zinc-800">
                  {selectedMismatch.aiAnalysis}
                </div>
              </div>

              <div>
                <div className="text-xs text-zinc-400 mb-4">VISUAL EVIDENCE</div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="aspect-video bg-zinc-800 rounded-2xl flex items-center justify-center text-xs text-zinc-500 border border-dashed">DEV Screenshot</div>
                  <div className="aspect-video bg-zinc-800 rounded-2xl flex items-center justify-center text-xs text-zinc-500 border border-dashed">PROD Screenshot</div>
                </div>
              </div>

              <div className="pt-4">
                <button className="w-full py-4 bg-white text-black rounded-2xl font-medium">HIGHLIGHT IN BOTH BROWSERS</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QA_VISION;
