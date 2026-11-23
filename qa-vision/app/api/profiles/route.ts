import { NextRequest, NextResponse } from 'next/server';
import { profileManager } from '../../../lib/profile-manager';
import type { ComparisonProfile } from '../../../lib/types';

export async function GET() {
  try {
    const profiles = profileManager.getAllProfiles();
    return NextResponse.json({ success: true, profiles });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to load profiles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (body.action === 'save') {
      const savedProfile = profileManager.saveProfile(body.profile);
      return NextResponse.json({ success: true, profile: savedProfile });
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
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}