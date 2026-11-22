import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { pickShift } from './assign';
import { stationKey } from './station';
import type { AppConfig, Assignment, DayId, TimePref } from './types';

/** publicName = samtykke til at navnet vises på den offentlige vaktlisten */
export interface Person { name: string; phone: string; email?: string; publicName?: boolean }

/**
 * Tildeler én vakt for én dag i én transaksjon:
 * påmelding + telling + personindeks skrives samtidig, og reglene
 * avviser alt som går over kapasiteten. Ved kollisjon prøver Firestore på nytt.
 */
export async function signUpForDay(
  db: Firestore,
  config: AppConfig,
  person: Person,
  day: DayId,
  pref: TimePref,
  rng: () => number = Math.random,
): Promise<Assignment> {
  const dayShifts = config.shifts.filter((s) => s.day === day);

  return runTransaction(db, async (tx) => {
    const personRef = doc(db, 'people', person.phone);
    const personSnap = await tx.get(personRef);
    const owned: Record<string, boolean> = personSnap.exists() ? personSnap.data().shifts ?? {} : {};
    const existing = config.shifts.filter((s) => owned[s.id]);

    const counts: Record<string, number> = {};
    const maxes: Record<string, number> = {};
    for (const s of dayShifts) {
      const snap = await tx.get(doc(db, 'shiftCounts', s.id));
      // Skift uten teller er ikke åpnet av admin ennå
      counts[s.id] = snap.exists() ? snap.data().count : Number.POSITIVE_INFINITY;
      maxes[s.id] = snap.exists() ? snap.data().max : 0;
    }
    // Telleren i databasen er fasit for kapasitet
    const open = dayShifts.map((s) => {
      const base = Math.min(s.base, maxes[s.id]);
      return { ...s, base, extra: Math.max(0, maxes[s.id] - base) };
    });
    const shift = pickShift({ dayShifts: open, counts, pref, existing, rng });
    const chosen = shift ? config.shifts.find((s) => s.id === shift.id)! : null;

    // Ingen ledig vakt, men det FINNES ledige vakter som bare kolliderer med personens egne:
    // da er personen opptatt, ikke på venteliste. Ingenting lagres.
    if (!chosen && pickShift({ dayShifts: open, counts, pref, existing: [], rng })) {
      return { day, shift: null, status: 'opptatt' };
    }

    const signupRef = doc(collection(db, 'signups'));
    const base = {
      name: person.name,
      phone: person.phone,
      email: '',
      day,
      timePref: pref,
      source: 'app',
      publicName: !!person.publicName,
      attended: false,
      createdAt: serverTimestamp(),
    };

    if (!chosen) {
      tx.set(signupRef, { ...base, shiftId: null, stationKey: '', status: 'venteliste' });
      return { day, shift: null, status: 'venteliste' };
    }

    tx.set(signupRef, { ...base, shiftId: chosen.id, stationKey: stationKey(chosen.station), status: 'aktiv' });
    // Offentlig vaktliste: bare navn og skift, og bare med samtykke
    if (person.publicName) tx.set(doc(db, 'publicRoster', signupRef.id), { name: person.name, shiftId: chosen.id });
    tx.update(doc(db, 'shiftCounts', chosen.id), { count: counts[chosen.id] + 1, lastSignup: signupRef.id });
    tx.set(personRef, { shifts: { ...owned, [chosen.id]: true } });
    return { day, shift: chosen, status: 'tildelt' };
  });
}
