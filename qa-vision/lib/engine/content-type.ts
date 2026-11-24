/** True only when the Content-Type media type is application/json (parameters like charset allowed). */
export function isJsonContentType(header: string | null | undefined): boolean {
  return /^application\/json(\s*;|$)/i.test((header || '').trim());
}
