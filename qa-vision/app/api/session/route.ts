import { NextRequest, NextResponse } from 'next/server';
import comparisonEngine, { validateTargetUrl } from '@/lib/playwright';
import { requireJson } from '@/lib/http-guards';
import { profileManager } from '@/lib/profile-manager';
import { getDataDir, resolveSessionLogin } from '@/lib/engine/secrets';

export async function POST(request: NextRequest) {
  try {
    const rejected = requireJson(request);
    if (rejected) return rejected;
    const body = await request.json();
    const {
      action,
      devUrl,
      prodUrl,
      sessionId,
      payload,
      projectName,
      safetyPolicy,
      safetyAllowlist,
      ignoreRules,
      capture,
      paused,
      profileId,
    } = body;

    switch (action) {
      case 'create': {
        // One dashboard session at a time: a second launch would pile up more browsers
        const active = comparisonEngine.listActiveSessions();
        if (active.length > 0) {
          return NextResponse.json(
            { success: false, error: 'A session is already active. Stop it before launching again.', sessionId: active[0].sessionId },
            { status: 409 }
          );
        }

        if (!devUrl || !prodUrl) {
          return NextResponse.json(
            { success: false, error: 'devUrl and prodUrl are required' },
            { status: 400 }
          );
        }

        for (const [label, url] of [['DEV', devUrl], ['PROD', prodUrl]] as const) {
          const check = validateTargetUrl(url);
          if (!check.ok) {
            return NextResponse.json(
              { success: false, error: `${label} URL rejected: ${check.error}` },
              { status: 400 }
            );
          }
        }

        const policy = ['read-only', 'allow-safe', 'full'].includes(safetyPolicy) ? safetyPolicy : 'read-only';
        const allowlist = Array.isArray(safetyAllowlist)
          ? safetyAllowlist.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 50)
          : [];

        // Secrets are resolved server-side only; they never reach the client or the logs
        let login;
        let loginCredentials;
        let profile: ReturnType<typeof profileManager.getProfile>;
        if (typeof profileId === 'string' && profileId) {
          profile = profileManager.getProfile(profileId);
          if (!profile) {
            return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
          }
          const resolved = resolveSessionLogin(profile, devUrl, prodUrl, getDataDir());
          if (!resolved.ok) {
            return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
          }
          login = resolved.login;
          loginCredentials = resolved.loginCredentials;
        }

        const newSessionId = await comparisonEngine.startSessionWithRecorder(
          devUrl,
          prodUrl,
          {
            startImmediately: false, // dashboard sessions open 'ready'; the user presses Start Comparison
            projectName: projectName || 'QA Vision Session',
            safetyPolicy: policy,
            safetyAllowlist: allowlist,
            ignoreRules: Array.isArray(ignoreRules)
              ? ignoreRules.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 100)
              : [],
            capture: capture && typeof capture === 'object' ? capture : profile?.capture,
            dataRules: Array.isArray(profile?.dataRules) ? profile.dataRules : undefined,
            apiChecks: Array.isArray(profile?.apiChecks) ? profile.apiChecks : undefined,
            dbChecks: Array.isArray(profile?.dbChecks) ? profile.dbChecks : undefined,
            profileId: typeof profileId === 'string' ? profileId : undefined,
            login,
            loginCredentials,
          }
        );

        return NextResponse.json({
          success: true,
          sessionId: newSessionId,
          phase: comparisonEngine.getPhase(newSessionId) ?? 'ready',
          message:
            'DEV and PROD windows are ready. Log in or navigate in the DEV window, then press Start Comparison.',
        });
      }

      case 'replicate': {
        if (!sessionId || !payload) {
          return NextResponse.json(
            { success: false, error: 'sessionId and payload required' },
            { status: 400 }
          );
        }
        await comparisonEngine.enqueueAction(sessionId, payload);
        return NextResponse.json({ success: true });
      }

      case 'pause': {
        if (!sessionId) {
          return NextResponse.json(
            { success: false, error: 'sessionId required' },
            { status: 400 }
          );
        }
        const r = await comparisonEngine.setPaused(sessionId, Boolean(paused));
        const status = r.ok ? 200 : r.status === 'not-found' ? 404 : 409;
        return NextResponse.json(
          { success: r.ok, error: r.ok ? undefined : r.message, message: r.message, paused: r.phase === 'paused', phase: r.phase },
          { status }
        );
      }

      case 'start': {
        if (!sessionId) {
          return NextResponse.json({ success: false, error: 'sessionId required' }, { status: 400 });
        }
        const r = await comparisonEngine.startComparison(sessionId);
        const status = r.status === 'ok' ? 200 : r.status === 'not-found' ? 404 : 409;
        return NextResponse.json({ ...r, success: r.ok, error: r.ok ? undefined : r.message }, { status });
      }

      case 'resync': {
        if (!sessionId) {
          return NextResponse.json({ success: false, error: 'sessionId required' }, { status: 400 });
        }
        const result = await comparisonEngine.resync(sessionId);
        return NextResponse.json({ ...result, success: result.ok }, { status: result.ok ? 200 : 409 });
      }

      case 'stop': {
        if (sessionId) {
          await comparisonEngine.closeSession(sessionId);
        } else {
          await comparisonEngine.closeAllSessions();
        }
        return NextResponse.json({ success: true, message: 'Session stopped' });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Unknown action' },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('Session API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const sid = request.nextUrl.searchParams.get('sessionId');
  if (sid) {
    const phase = comparisonEngine.getPhase(sid);
    if (!phase) return NextResponse.json({ success: false, error: 'Unknown session' }, { status: 404 });
    return NextResponse.json({ success: true, sessionId: sid, phase, paused: phase === 'paused' });
  }
  return NextResponse.json({
    status: 'QA Vision Automation Engine Ready',
    // Live sessions, so a reloaded dashboard can reconnect instead of orphaning their browsers
    sessions: comparisonEngine.listActiveSessions(),
    capabilities: [
      'Dual browser control (Chromium)',
      'DOM-based action replication',
      'Visual diff with pixelmatch',
      'Real-time mismatch detection',
      'Persistent recorder across navigations',
    ],
    note: 'Interact only in the Playwright DEV window opened by Launch Environments.',
  });
}
