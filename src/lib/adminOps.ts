// Admin-operasjoner på vakter. Hver operasjon er én transaksjon, slik at
// påmelding, telling og personindeks alltid stemmer med hverandre.
// Admin kan gå over kapasiteten; appen viser advarsel i stedet for å stoppe.
import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { matchesPref } from './assign';
import type { AppConfig, Shift, TimePref } from './types';

export interface SignupRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  day: string;
  shiftId: string | null;
  status: 'aktiv' | 'venteliste' | 'avmeldt';
  timePref: TimePref;
  attended: boolean;
  source: string;
}

const shiftOf = (config: AppConfig, id: string | null) => config.shifts.find((s) => s.id === id) ?? null;

export async function addManual(
  db: Firestore, config: AppConfig,
  person: { name: string; phone: string; email?: string }, shiftId: string, attendedNow: boolean,
): Promise<string> {
  const shift = shiftOf(config, shiftId);
  if (!shift) throw new Error('Ukjent skift');
  return runTransaction(db, async (tx) => {
    const counterRef = doc(db, 'shiftCounts', shiftId);
    const personRef = doc(db, 'people', person.phone);
    const counter = await tx.get(counterRef);
    const p = await tx.get(personRef);
    const ref = doc(collection(db, 'signups'));
    tx.set(ref, {
      name: person.name, phone: person.phone, email: person.email ?? '', day: shift.day, timePref: 'hele',
      source: 'manuell', attended: attendedNow, createdAt: serverTimestamp(), shiftId, status: 'aktiv',
    });
    tx.update(counterRef, { count: (counter.data()?.count ?? 0) + 1, lastSignup: ref.id });
    tx.set(personRef, { shifts: { ...(p.data()?.shifts ?? {}), [shiftId]: true } });
    return ref.id;
  });
}

/** Flytter en påmelding (aktiv, venteliste eller avmeldt) til et nytt skift. */
export async function moveSignup(db: Firestore, config: AppConfig, signupId: string, newShiftId: string): Promise<void> {
  const target = shiftOf(config, newShiftId);
  if (!target) throw new Error('Ukjent skift');
  await runTransaction(db, async (tx) => {
    const sRef = doc(db, 'signups', signupId);
    const s = (await tx.get(sRef)).data() as SignupRow | undefined;
    if (!s) throw new Error('Fant ikke påmeldingen');
    if (s.status === 'aktiv' && s.shiftId === newShiftId) return;
    const wasActive = s.status === 'aktiv' && s.shiftId;
    const oldRef = wasActive ? doc(db, 'shiftCounts', s.shiftId!) : null;
    const newRef = doc(db, 'shiftCounts', newShiftId);
    const pRef = doc(db, 'people', s.phone);
    const oldC = oldRef ? await tx.get(oldRef) : null;
    const newC = await tx.get(newRef);
    const p = await tx.get(pRef);

    const shifts = { ...(p.data()?.shifts ?? {}) };
    if (wasActive) delete shifts[s.shiftId!];
    shifts[newShiftId] = true;

    if (oldRef && oldC) tx.update(oldRef, { count: Math.max(0, (oldC.data()?.count ?? 1) - 1) });
    tx.update(newRef, { count: (newC.data()?.count ?? 0) + 1, lastSignup: signupId });
    tx.update(sRef, { shiftId: newShiftId, day: target.day, status: 'aktiv' });
    tx.set(pRef, { shifts });
  });
}

/** Melder av: frigjør plassen, raden blir stående med status avmeldt. */
export async function cancelSignup(db: Firestore, signupId: string): Promise<string | null> {
  return runTransaction(db, async (tx) => {
    const sRef = doc(db, 'signups', signupId);
    const s = (await tx.get(sRef)).data() as SignupRow | undefined;
    if (!s || s.status === 'avmeldt') return null;
    const freed = s.status === 'aktiv' ? s.shiftId : null;
    const cRef = freed ? doc(db, 'shiftCounts', freed) : null;
    const pRef = doc(db, 'people', s.phone);
    const c = cRef ? await tx.get(cRef) : null;
    const p = await tx.get(pRef);
    if (cRef && c) tx.update(cRef, { count: Math.max(0, (c.data()?.count ?? 1) - 1) });
    if (freed && p.exists()) {
      const shifts = { ...(p.data().shifts ?? {}) };
      delete shifts[freed];
      tx.set(pRef, { shifts });
    }
    tx.update(sRef, { status: 'avmeldt', attended: false });
    return freed;
  });
}

export async function setAttended(db: Firestore, signupId: string, attended: boolean): Promise<void> {
  await runTransaction(db, async (tx) => {
    tx.update(doc(db, 'signups', signupId), { attended });
  });
}

/** Ventelistede som passer et ledig skift (samme dag, tidsvalg passer), eldste først. */
export function waitlistFor(shift: Shift, signups: SignupRow[]): SignupRow[] {
  return signups.filter((s) => s.status === 'venteliste' && s.day === shift.day && matchesPref(shift, s.timePref));
}
