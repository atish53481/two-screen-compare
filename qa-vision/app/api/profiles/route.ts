import { NextRequest, NextResponse } from 'next/server';
import { profileManager } from '../../../lib/profile-manager';
import { requireJson } from '../../../lib/http-guards';
import { SecretError } from '../../../lib/engine/secrets';

/** Client view of a profile: secret references and passwords never leave the server, only a `stored` flag. */
function toClient(profile: any) {
  const out: any = { ...profile };
  for (const f of ['credentialsA', 'credentialsB']) {
    if (out[f] && typeof out[f] === 'object') {
      const { secretRef, password: _p, ...rest } = out[f];
      out[f] = { ...rest, stored: Boolean(secretRef) };
    }
  }
  if (Array.isArray(out.dbChecks)) {
    out.dbChecks = out.dbChecks.map((c: any) => {
      const { devConnRef, prodConnRef, devConn: _a, prodConn: _b, ...rest } = c || {};
      return { ...rest, devStored: Boolean(devConnRef), prodStored: Boolean(prodConnRef) };
    });
  }
  return out;
}

/** Inbound profile: drop the client-only `stored` flag and any client-supplied secretRef. */
function fromClient(profile: any) {
  const out: any = { ...profile };
  for (const f of ['credentialsA', 'credentialsB']) {
    if (out[f] && typeof out[f] === 'object') {
      const { stored: _s, secretRef: _r, ...rest } = out[f];
      out[f] = rest;
    }
  }
  if (Array.isArray(out.dbChecks)) {
    out.dbChecks = out.dbChecks.map((c: any) => {
      const { devConnRef: _d, prodConnRef: _p, devStored: _ds, prodStored: _ps, ...rest } = c || {};
      return rest;
    });
  }
  return out;
}

export async function GET() {
  try {
    const profiles = profileManager.getAllProfiles().map(toClient);
    return NextResponse.json({ success: true, profiles });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to load profiles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rejected = requireJson(request);
    if (rejected) return rejected;
    const body = await request.json();
    
    if (body.action === 'save') {
      const savedProfile = profileManager.saveProfile(fromClient(body.profile));
      return NextResponse.json({ success: true, profile: toClient(savedProfile) });
    }
    
    if (body.action === 'delete') {
      const success = profileManager.deleteProfile(body.id);
      return NextResponse.json({ success });
    }
    
    if (body.action === 'setCurrent') {
      profileManager.setCurrentProfile(body.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error instanceof SecretError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}