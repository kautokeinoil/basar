import {
  collection, deleteDoc, doc, endAt, getDocs, orderBy, query, serverTimestamp, startAt, writeBatch, type Firestore,
} from 'firebase/firestore';
import { SEED_CONFIG } from '../config/seed';
import type { AppConfig, CakeType, CakeTypeId } from './types';

export interface CakeLine {
  type: CakeTypeId | '';
  variant: string;
  glutenFree: boolean;
  lactoseFree: boolean;
  allergens: string;
  deliveryDay: 'd1' | 'd2' | '';
}

export const emptyLine = (): CakeLine => ({ type: '', variant: '', glutenFree: false, lactoseFree: false, allergens: '', deliveryDay: '' });

export const cakeTypesOf = (config: AppConfig): CakeType[] => config.cakeTypes ?? SEED_CONFIG.cakeTypes!;
export const cakeLimitsOf = (config: AppConfig) => config.cakeLimits ?? SEED_CONFIG.cakeLimits!;

/**
 * Kvoter: hver plass er et eget dokument cakeSlots/{type}_{dag}_{nr}, f.eks. flotekake_d1_3.
 * Et dokument kan bare opprettes én gang, så to som melder seg samtidig kan ikke ta samme plass,
 * og reglene stopper nr over grensen. Plassene inneholder ingen personopplysninger.
 */
export interface Availability { used: Record<string, number>; gf: Record<string, number>; taken: Set<string> }

export const slotKey = (type: string, day: string) => `${type}_${day}`;

export async function cakeAvailability(db: Firestore): Promise<Availability> {
  const snap = await getDocs(collection(db, 'cakeSlots'));
  const used: Record<string, number> = {}, gf: Record<string, number> = {};
  const taken = new Set<string>();
  snap.forEach((d) => {
    taken.add(d.id);
    const k = d.id.replace(/_\d+$/, '');
    used[k] = (used[k] ?? 0) + 1;
    if (d.data().gf) gf[k] = (gf[k] ?? 0) + 1;
  });
  return { used, gf, taken };
}

export class FullError extends Error {
  constructor(public type: string, public day: string) { super(`Fullt: ${type} ${day}`); }
}

/** Én registrering = ett dokument per bakverk. Bakverk med kvote får en ledig plass i samme skriving. */
export async function registerCakes(
  db: Firestore, config: AppConfig, person: { name: string; phone: string }, lines: CakeLine[],
): Promise<string> {
  const limits = cakeLimitsOf(config);
  for (let attempt = 0; ; attempt++) {
    const taken = new Set<string>();
    for (const k of new Set(lines.filter((l) => limits[l.type as CakeTypeId]).map((l) => slotKey(l.type, l.deliveryDay)))) {
      const s = await getDocs(query(collection(db, 'cakeSlots'), orderBy('__name__'), startAt(`${k}_`), endAt(`${k}_`)));
      s.forEach((d) => taken.add(d.id));
    }
    const batch = writeBatch(db);
    const regId = doc(collection(db, 'cakes')).id;
    for (const l of lines) {
      const ref = doc(collection(db, 'cakes'));
      const max = limits[l.type as CakeTypeId];
      let slot = '';
      if (max) {
        for (let n = 1; n <= max; n++) {
          const id = `${slotKey(l.type, l.deliveryDay)}_${n}`;
          if (!taken.has(id)) { slot = id; taken.add(id); break; }
        }
        if (!slot) throw new FullError(l.type, l.deliveryDay);
        batch.set(doc(db, 'cakeSlots', slot), { cake: ref.id, gf: l.glutenFree });
      }
      batch.set(ref, {
        regId, name: person.name, phone: person.phone, type: l.type, variant: l.variant.trim(),
        glutenFree: l.glutenFree, lactoseFree: l.lactoseFree, allergens: l.allergens.trim(),
        deliveryDay: l.deliveryDay, slot, delivered: false, source: 'app', createdAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
      return regId;
    } catch (e) {
      if (attempt >= 2) throw e; // noen tok samme plass samtidig: les på nytt og prøv igjen
    }
  }
}

/** Admin: sletter et bakverk og frigjør plassen. */
export async function deleteCake(db: Firestore, cake: { id: string; slot?: string }): Promise<void> {
  if (cake.slot) await deleteDoc(doc(db, 'cakeSlots', cake.slot));
  await deleteDoc(doc(db, 'cakes', cake.id));
}
