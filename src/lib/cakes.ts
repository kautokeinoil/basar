import { collection, deleteDoc, doc, getDocs, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';
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
export const cakeLimitsOf = (config: AppConfig): Record<string, number> => config.cakeLimits ?? SEED_CONFIG.cakeLimits!;
const baseTotalOf = (config: AppConfig) => config.cakeBaseTotal ?? SEED_CONFIG.cakeBaseTotal!;
const noExtraOf = (config: AppConfig) => new Set(config.cakeNoExtra ?? SEED_CONFIG.cakeNoExtra!);

/**
 * Kvoter: hver plass er et eget dokument i cakeSlots. Et dokument kan bare opprettes én gang,
 * så to som melder seg samtidig kan ikke ta samme plass, og reglene stopper nr over grensen.
 *  - {type}_{dag}_{nr}: plass i typens kvote (f.eks. blotekake_d1_2)
 *  - base_{dag}_{nr}:   dagsplass, én per vanlig kake (1–24). Når base_{dag}_24 finnes, er dagen full.
 *  - ekstra_{dag}_{nr}: ekstrakake etter at dagen er full (grense i oppsettet, 0 = ingen)
 * Vaffelrøre o.l. (cakeNoExtra) har bare typeplass. Plassene inneholder ingen personopplysninger.
 */
export interface Availability { used: Record<string, number>; gf: Record<string, number>; taken: Set<string> }

export const slotKey = (type: string, day: string) => `${type}_${day}`;
export const EXTRA = 'ekstra';
export const BASE = 'base';

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

/** Er alle kakeplassene for dagen tatt? Da er ekstraplassene åpne. */
export function baseFull(config: AppConfig, used: Record<string, number>, day: string): boolean {
  return (used[slotKey(BASE, day)] ?? 0) >= baseTotalOf(config);
}

/** Ekstraplasser igjen for dagen (Infinity = ingen grense), eller 0 hvis dagen ikke er full ennå. */
export function extraLeft(config: AppConfig, used: Record<string, number>, day: string): number {
  if (!baseFull(config, used, day)) return 0;
  const cap = config.cakeExtraPerDay ?? 0;
  return cap > 0 ? cap - (used[slotKey(EXTRA, day)] ?? 0) : Infinity;
}

/** Glutenfrie kaker så langt (uten vaffelrøre): [glutenfrie, totalt]. */
export function glutenShare(config: AppConfig, a: Availability): [number, number] {
  const skip = noExtraOf(config);
  let gf = 0, total = 0;
  for (const [k, n] of Object.entries(a.used)) {
    const prefix = k.split('_')[0];
    if (prefix === BASE || skip.has(prefix)) continue; // dagsplassene ville telt dobbelt
    total += n;
    gf += a.gf[k] ?? 0;
  }
  return [gf, total];
}

export class FullError extends Error {
  /** saved = hvor mange bakverk som allerede ble lagret før det ble fullt */
  constructor(public type: string, public day: string, public saved = 0) { super(`Fullt: ${type} ${day}`); }
}

/**
 * Én registrering = ett dokument per bakverk, med plassene i samme skriving.
 * Reglene tåler bare ~20 oppslag per skriving, så bakverkene lagres to og to.
 */
export async function registerCakes(
  db: Firestore, config: AppConfig, person: { name: string; phone: string }, lines: CakeLine[],
): Promise<string> {
  const limits = cakeLimitsOf(config);
  const noExtra = noExtraOf(config);
  const cap = config.cakeExtraPerDay ?? 0;
  const regId = doc(collection(db, 'cakes')).id;
  const CHUNK = 2;

  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK);
    for (let attempt = 0; ; attempt++) {
      const { taken, used } = await cakeAvailability(db);
      const batch = writeBatch(db);
      const freeSlot = (prefix: string, max: number) => {
        for (let n = 1; n <= max; n++) {
          const id = `${prefix}_${n}`;
          if (!taken.has(id)) { taken.add(id); used[prefix] = (used[prefix] ?? 0) + 1; return id; }
        }
        return '';
      };
      for (const [j, l] of chunk.entries()) {
        const ref = doc(collection(db, 'cakes'));
        const day = l.deliveryDay;
        let slot = freeSlot(slotKey(l.type, day), limits[l.type] ?? 0);
        let daySlot = '';
        if (slot && !noExtra.has(l.type)) {
          daySlot = freeSlot(slotKey(BASE, day), baseTotalOf(config));
          if (!daySlot) slot = ''; // skal ikke skje, men da behandles den som full
        }
        if (!slot && !noExtra.has(l.type) && baseFull(config, used, day)) {
          slot = freeSlot(slotKey(EXTRA, day), cap > 0 ? cap : 10_000);
        }
        if (!slot) throw new FullError(l.type, day, i + j);
        batch.set(doc(db, 'cakeSlots', slot), { cake: ref.id, gf: l.glutenFree });
        if (daySlot) batch.set(doc(db, 'cakeSlots', daySlot), { cake: ref.id, gf: l.glutenFree });
        batch.set(ref, {
          regId, name: person.name, phone: person.phone, type: l.type, variant: l.variant.trim(),
          glutenFree: l.glutenFree, lactoseFree: l.lactoseFree, allergens: l.allergens.trim(),
          deliveryDay: day, slot, daySlot, delivered: false, source: 'app', createdAt: serverTimestamp(),
        });
      }
      try {
        await batch.commit();
        break;
      } catch (e) {
        if (attempt >= 2) throw e; // noen tok samme plass samtidig: les på nytt og prøv igjen
      }
    }
  }
  return regId;
}

/** Admin: sletter et bakverk og frigjør plassene. */
export async function deleteCake(db: Firestore, cake: { id: string; slot?: string; daySlot?: string }): Promise<void> {
  if (cake.slot) await deleteDoc(doc(db, 'cakeSlots', cake.slot));
  if (cake.daySlot) await deleteDoc(doc(db, 'cakeSlots', cake.daySlot));
  await deleteDoc(doc(db, 'cakes', cake.id));
}
