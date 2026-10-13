const TECHNICAL_PATTERN =
  /(\bHTTP\b|\bJSON\b|\bSQL\b|Traceback|Exception|ECONNREFUSED|fetch failed|NetworkError|internal_error|invalid_request|not_found|postgresql|api\/|unexpected|TypeError|undefined is not)/i;

const ENGLISH_API_PATTERN =
  /\b(you are not|you cannot|forbidden|authentication required|order not|ticket not|conflict|provider)\b/i;

const DEV_HINT_PATTERN = /localhost|127\.0\.0\.1|8088|vite|backend-python/i;

export function logAdminApiDiagnostic(context: string, err: unknown): void {
  console.error(`[billetterie:admin:${context}]`, err);
}

/** Message affiché en UI admin uniquement — jamais de détail technique brut. */
export function toUserFacingApiMessage(_err: unknown, fallback: string): string {
  return fallback;
}

export function isTechnicalUserMessage(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (t.length > 160) return true;
  if (TECHNICAL_PATTERN.test(t)) return true;
  if (ENGLISH_API_PATTERN.test(t)) return true;
  if (DEV_HINT_PATTERN.test(t)) return true;
  if (/^Erreur HTTP \d+/.test(t)) return true;
  if (/^\{|\[/.test(t)) return true;
  if (/^[a-z0-9_.-]+$/i.test(t) && t.includes('_')) return true;
  if (/^[A-Za-z0-9\s._\-:'",!?()/]+$/.test(t) && !/[àâäéèêëïîôùûüç]/i.test(t)) {
    return true;
  }
  return false;
}
