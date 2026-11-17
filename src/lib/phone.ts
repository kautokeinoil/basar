// Telefonnummer lagres i internasjonalt format (E.164), f.eks. +4741234567.
// Det er personnøkkelen som kobler vakter, kaker og lodd.

export type Country = 'NO' | 'SE' | 'FI' | 'ANNET';

export const COUNTRIES: { id: Country; label: string; code: string }[] = [
  { id: 'NO', label: 'Norge (+47)', code: '47' },
  { id: 'SE', label: 'Sverige (+46)', code: '46' },
  { id: 'FI', label: 'Finland (+358)', code: '358' },
  { id: 'ANNET', label: 'Annet land', code: '' },
];

export function normalizePhone(input: string, country: Country = 'NO'): string | null {
  const raw = input.trim();
  let d = raw.replace(/\D/g, '');
  // Skrevet med landskode (+46… eller 0046…) gjelder uansett valgt land
  if (raw.startsWith('+')) return valid(d);
  if (d.startsWith('00')) return valid(d.slice(2));

  switch (country) {
    case 'NO':
      if (d.length === 10 && d.startsWith('47')) d = d.slice(2);
      return /^\d{8}$/.test(d) ? `+47${d}` : null;
    case 'SE':
      if (d.startsWith('46') && d.length >= 10) d = d.slice(2);
      d = d.replace(/^0/, '');
      return /^\d{7,9}$/.test(d) ? `+46${d}` : null;
    case 'FI':
      if (d.startsWith('358') && d.length >= 9) d = d.slice(3);
      d = d.replace(/^0/, '');
      return /^\d{6,10}$/.test(d) ? `+358${d}` : null;
    default:
      return null; // annet land: må skrives med landskode
  }
}

const valid = (digits: string) => (/^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null);

/** Til visning: +47 412 34 567 → «412 34 567», andre land beholder landskoden. */
export function displayPhone(e164: string): string {
  return e164.startsWith('+47') ? e164.slice(3) : e164;
}
