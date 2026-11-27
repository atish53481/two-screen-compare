import { NextRequest, NextResponse } from 'next/server';
import {
  alignedPair,
  compareScreenshots,
  ScreenshotInputError,
  sanitizeIgnoreRegions,
  sanitizeScope,
  sanitizeTextOptions,
  type CompareShotOptions,
} from '@/lib/engine/screenshot-compare';
import { explainWithAi, screenshotAiStatus } from '@/lib/engine/screenshot-ai';
import { ocrStatus } from '@/lib/engine/screenshot-ocr';
import { DEFAULT_SHOT_SCOPE, SHOT_LIMITS, SHOT_SCOPES } from '@/lib/engine/screenshot-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Two Screen Comparison (screenshot vs screenshot). Stateless: images live only for this request, nothing is
 * written to disk or the database. No live website is contacted.
 *
 * POST multipart/form-data: devImage, prodImage (files), options (JSON string, optional):
 *   { scope: ['data_text'|'images_diagrams'|'css_styling'|'alignment_layout'|'form_states'] (default ['data_text'];
 *       an empty list is rejected),
 *     text: { matching: 'normalized'|'strict', caseSensitive, numericTolerance, minConfidence, ignoreFields: string[] },
 *     sensitivity, pixelThreshold, alignment: 'none'|'top-left'|'scale', ignoreRegions: [{label,x,y,width,height}],
 *     pageName, devLabel, prodLabel, expectedNotes, devId, prodId, aiConsent: boolean }
 */
async function fileBuffer(entry: FormDataEntryValue | null): Promise<Buffer | null> {
  if (!entry || typeof entry === 'string') return null;
  // Content is validated by decoding (magic bytes), not by the client-supplied MIME type
  return Buffer.from(await (entry as File).arrayBuffer());
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ success: false, code: 'bad-request', error: 'Expected multipart/form-data with devImage and prodImage.' }, { status: 400 });
  }
  const devBuf = await fileBuffer(form.get('devImage'));
  const prodBuf = await fileBuffer(form.get('prodImage'));
  if (!devBuf || !prodBuf) {
    return NextResponse.json(
      { success: false, code: 'missing-image', error: `Both screenshots are required: ${!devBuf ? 'DEV' : ''}${!devBuf && !prodBuf ? ' and ' : ''}${!prodBuf ? 'PROD' : ''} missing.` },
      { status: 400 }
    );
  }

  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(form.get('options') || '{}'));
    raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return NextResponse.json({ success: false, code: 'bad-options', error: 'options must be a JSON object.' }, { status: 400 });
  }
  const scope = sanitizeScope(raw.scope);
  if (!scope.length) {
    return NextResponse.json(
      { success: false, code: 'no-scope', error: 'Select at least one comparison category (Data & Text, Images & Diagrams, CSS & Visual Styling, Alignment & Layout, Form Elements & States).' },
      { status: 400 }
    );
  }
  const opts: CompareShotOptions = {
    scope,
    text: sanitizeTextOptions(raw.text),
    sensitivity: raw.sensitivity === 'strict' || raw.sensitivity === 'relaxed' ? raw.sensitivity : 'normal',
    pixelThreshold: typeof raw.pixelThreshold === 'number' ? raw.pixelThreshold : undefined,
    alignment: raw.alignment === 'top-left' || raw.alignment === 'scale' ? raw.alignment : 'none',
    ignoreRegions: sanitizeIgnoreRegions(raw.ignoreRegions),
    pageName: typeof raw.pageName === 'string' ? raw.pageName : undefined,
    devLabel: typeof raw.devLabel === 'string' ? raw.devLabel : undefined,
    prodLabel: typeof raw.prodLabel === 'string' ? raw.prodLabel : undefined,
    expectedNotes: typeof raw.expectedNotes === 'string' ? raw.expectedNotes : undefined,
    devId: typeof raw.devId === 'string' ? raw.devId.slice(0, 80) : undefined,
    prodId: typeof raw.prodId === 'string' ? raw.prodId.slice(0, 80) : undefined,
  };

  try {
    const result = await compareScreenshots(devBuf, prodBuf, opts);
    if (raw.aiConsent === true && result.status === 'compared') {
      const { dev, prod } = await alignedPair(devBuf, prodBuf, result);
      await explainWithAi(result, dev, prod);
    } else if (raw.aiConsent === true) {
      result.ai = { requested: true, used: false, provider: null, model: null, note: 'Nothing for AI to explain.' };
    }
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    if (error instanceof ScreenshotInputError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 400 });
    }
    console.error('screenshot-compare error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, code: 'internal', error: 'Screenshot comparison failed on the server. Try again or re-save the images as PNG.' }, { status: 500 });
  }
}

export async function GET() {
  const ai = screenshotAiStatus();
  return NextResponse.json({
    ok: true,
    endpoint: '/api/screenshot-compare',
    method: 'POST',
    accepts: 'multipart/form-data with devImage + prodImage (+ options JSON)',
    limits: { maxBytes: SHOT_LIMITS.maxBytes, maxPixels: SHOT_LIMITS.maxPixels, maxEdge: SHOT_LIMITS.maxEdge, formats: SHOT_LIMITS.formats },
    scopes: SHOT_SCOPES,
    defaultScope: DEFAULT_SHOT_SCOPE,
    ocr: ocrStatus(),
    ai: { configured: ai.configured, visionCapable: ai.visionCapable, provider: ai.provider, model: ai.model, note: ai.note },
  });
}
