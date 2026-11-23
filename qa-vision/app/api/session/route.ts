import { NextRequest, NextResponse } from 'next/server';
import comparisonEngine, { validateTargetUrl } from '@/lib/playwright';
import { profileManager } from '@/lib/profile-manager';
import { getDataDir, resolveSessionLogin } from '@/lib/engine/secrets';

export async function POST(request: NextRequest) {
  try {
    // Reject cross-site "simple" form posts (text/plain etc.): only real JSON requests are accepted
    if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ success: false, error: 'Content-Type must be application/json' }, { status: 415 });
    }
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
        if (typeof profileId === 'string' && profileId) {
          const profile = profileManager.getProfile(profileId);
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
            projectName: projectName || 'QA Vision Session',
            safetyPolicy: policy,
            safetyAllowlist: allowlist,
            ignoreRules: Array.isArray(ignoreRules)
              ? ignoreRules.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 100)
              : [],
            capture: capture && typeof capture === 'object' ? capture : undefined,
            profileId: typeof profileId === 'string' ? profileId : undefined,
            login,
            loginCredentials,
          }
        );

        return NextResponse.json({
          success: true,
          sessionId: newSessionId,
          message:
            'Real synchronized session started. Use only the Playwright DEV window — actions mirror to PROD.',
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
        await comparisonEngine.setPaused(sessionId, Boolean(paused));
        return NextResponse.json({ success: true, paused: Boolean(paused) });
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

export async function GET() {
  return NextResponse.json({
    status: 'QA Vision Automation Engine Ready',
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
