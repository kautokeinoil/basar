// Tildelingsregler, se spesifikasjonen «Modul 1: Vakter → Tildeling».
// Ren funksjon uten Firebase, slik at den kan testes alene.
import type { Shift, TimePref } from './types';

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Tidsvalget vurderes på STARTtid (valg B). */
export function matchesPref(s: Shift, pref: TimePref): boolean {
  if (s.day === 'opprigg' || pref === 'hele') return true;
  const start = toMin(s.start);
  return pref === 'for18' ? start < 18 * 60 : start >= 18 * 60;
}

export function overlaps(a: Shift, b: Shift): boolean {
  return a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
}

export interface PickInput {
  dayShifts: Shift[];              // alle skift for dagen
  counts: Record<string, number>;  // påmeldte per skift-ID
  pref: TimePref;
  existing: Shift[];               // personens vakter fra før (samme telefon)
  rng?: () => number;
}

/** Returnerer skiftet personen skal ha, eller null = venteliste. */
export function pickShift({ dayShifts, counts, pref, existing, rng = Math.random }: PickInput): Shift | null {
  const used = (s: Shift) => counts[s.id] ?? 0;
  const candidates = dayShifts.filter(
    (s) =>
      matchesPref(s, pref) &&
      !existing.some((e) => e.id === s.id || overlaps(e, s)) &&
      used(s) < s.base + s.extra,
  );
  if (candidates.length === 0) return null;

  const randomOf = (list: Shift[]) => list[Math.floor(rng() * list.length)];

  // Fase 1: ledig grunnplass → helt tilfeldig, prioritet brukes ikke
  const phase1 = candidates.filter((s) => used(s) < s.base);
  if (phase1.length > 0) return randomOf(phase1);

  // Fase 2: ekstra plasser, laveste prioritetstall først
  const best = Math.min(...candidates.map((s) => s.priority));
  return randomOf(candidates.filter((s) => s.priority === best));
}
