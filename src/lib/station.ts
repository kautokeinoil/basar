import type { AppConfig } from './types';

/** Stasjonsnøkkel, samme regel som i skift-ID-ene: «Basarbord 1» → basarbord1, «Årer» → arer. */
export function stationKey(name: string): string {
  return name.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/é/g, 'e')
    .replace(/[^a-z0-9]/g, '');
}

export function stationsOf(config: AppConfig): { key: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const s of config.shifts) seen.set(stationKey(s.station), s.station);
  return [...seen].map(([key, name]) => ({ key, name }));
}

/** Uforutsigbar lenkekode, 22 tegn (ca. 130 bit). */
export function newToken(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
