import type { ReportModel } from './model';

/** No images; screenshot fields hold file names only (the model already strips directories). */
export function renderJson(model: ReportModel): string {
  return JSON.stringify(model, null, 2);
}
