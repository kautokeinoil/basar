/** Normaliserer norsk mobilnummer til 8 siffer, eller null hvis ugyldig. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('47')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('0047')) d = d.slice(4);
  return /^\d{8}$/.test(d) ? d : null;
}
