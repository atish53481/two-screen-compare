import fs from 'fs';
import path from 'path';
import type { ReportModel } from './model';

/** Total base64 budget for images embedded in one HTML report. */
export const EMBED_BUDGET_BYTES = 25 * 1024 * 1024;

export function evidenceRoot(cwd: string = process.cwd()): string {
  return path.resolve(cwd, 'reports', 'evidence');
}

/** Evidence directory of a session; null when the id could escape the evidence root. */
export function evidenceDirFor(id: string, cwd: string = process.cwd()): string | null {
  if (!id || /[\\/:]/.test(id) || id === '.' || id === '..') return null;
  const root = evidenceRoot(cwd);
  const dir = path.resolve(root, id);
  return path.dirname(dir) === root ? dir : null;
}

/**
 * Resolves a screenshot reference to a real file directly inside `dir`. Only the base name is honoured, and the
 * real (symlink-resolved) location must still be inside the real evidence dir. Otherwise, or if missing: undefined.
 */
export function safeEvidencePath(dir: string | null, p: unknown): string | undefined {
  if (!dir || typeof p !== 'string' || !p) return undefined;
  const name = p.split(/[\\/]/).pop() as string;
  if (!name || name === '.' || name === '..' || /:/.test(name)) return undefined;
  try {
    const full = path.resolve(dir, name);
    if (path.dirname(full) !== path.resolve(dir) || !fs.existsSync(full)) return undefined;
    const realDir = fs.realpathSync(dir);
    const realFile = fs.realpathSync(full);
    return path.dirname(realFile) === realDir && fs.statSync(realFile).isFile() ? full : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the model's screenshots from `evidenceDir` only, downscaled to <= 1200 px wide and re-encoded as JPEG q80
 * (flattened on white). Returns file name -> base64 JPEG. Without sharp nothing is embedded (never full-size originals).
 * Stops adding images once the total budget is reached; missing/unreadable images never fail the report.
 */
export async function loadEvidenceImages(
  evidenceDir: string,
  model: ReportModel,
  budgetBytes: number = EMBED_BUDGET_BYTES
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let sharp: any;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return out;
  }
  const names = new Set<string>();
  for (const f of model.findings) for (const n of [f.devScreenshotPath, f.prodScreenshotPath, f.diffScreenshotPath]) if (n) names.add(n);
  let used = 0;
  for (const name of names) {
    const full = safeEvidencePath(evidenceDir, name);
    if (!full) continue;
    try {
      const bytes: Buffer = await sharp(fs.readFileSync(full))
        .resize({ width: 1200, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 80 })
        .toBuffer();
      const b64 = bytes.toString('base64');
      if (used + b64.length > budgetBytes) continue;
      used += b64.length;
      out.set(name, b64);
    } catch {
      /* skip */
    }
  }
  return out;
}
