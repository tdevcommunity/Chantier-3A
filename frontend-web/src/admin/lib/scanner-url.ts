import { getAdminRoute } from '@/lib/env';

export type ScannerDeepLink = {
  mode?: 'serial' | 'name';
  suffix?: string;
  q?: string;
};

/** URL absolue du scanner web (hors layout admin). */
export function buildScannerUrl(params: ScannerDeepLink = {}): string {
  const base = getAdminRoute() || '';
  const search = new URLSearchParams();
  if (params.mode) search.set('mode', params.mode);
  if (params.suffix) search.set('suffix', params.suffix.replace(/\D/g, '').slice(-4));
  if (params.q) search.set('q', params.q.trim());
  const qs = search.toString();
  return `${base}/scanner${qs ? `?${qs}` : ''}`;
}

/** Extrait le suffixe numérique d’un serial TDEV-2026-XXXX (ou première série si plusieurs). */
export function serialSuffixFromDisplay(serial: string): string {
  const first = serial.split(',')[0]?.trim() ?? serial.trim();
  const match = first.match(/(\d{1,4})\s*$/);
  if (!match) return '';
  const raw = match[1]!;
  return raw.replace(/^0+/, '') || raw;
}