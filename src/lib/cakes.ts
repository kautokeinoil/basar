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
export const cakeLimitsOf = (config: AppConfig) => config.cakeLimits ?? SEED_CONFIG.cakeLimits!;

/**
 * Kvoter: hver plass er et eget dokument cakeSlots/{type}_{dag}_{nr}, f.eks. flotekake_d1_3.
 * Et dokument kan bare opprettes én gang, så to som melder seg samtidig kan ikke ta samme plass,
 * og reglene stopper nr over grensen. Plassene inneholder ingen personopplysninger.
 *
 * Når ALLE kvoteplassene for en dag er tatt (22 kaker), åpnes alle typene igjen som
 * ekstraplasser: ekstra_{dag}_{nr}. Grensen for ekstra settes i oppsettet (0 = ingen grense).
 */
export interface Availability { used: Record<string, number>; gf: Record<string, number>; taken: Set<string> }

export const slotKey = (type: string, day: string) => `${type}_${day}`;
export const EXTRA = 'ekstra';

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

/** Er alle kvoteplassene for dagen tatt? Da er ekstraplassene åpne. */
export function baseFull(config: AppConfig, used: Record<string, number>, day: string): boolean {
  const limits = cakeLimitsOf(config);
  return Object.entries(limits).every(([type, max]) => (used[slotKey(type, day)] ?? 0) >= (max ?? 0));
}

/** Ekstraplasser igjen for dagen (Infinity = ingen grense), eller 0 hvis kvoten ikke er full ennå. */
export function extraLeft(config: AppConfig, used: Record<string, number>, day: string): number {
  if (!baseFull(config, used, day)) return 0;
  const cap = config.cakeExtraPerDay ?? 0;
  return cap > 0 ? cap - (used[slotKey(EXTRA, day)] ?? 0) : Infinity;
}

export class FullError extends Error {
  /** saved = hvor mange bakverk som allerede ble lagret før det ble fullt */
  constructor(public type: string, public day: string, public saved = 0) { super(`Fullt: ${type} ${day}`); }
}

/**
 * Én registrering = ett dokument per bakverk. Bakverk med kvote får en ledig plass i samme skriving.
 * Reglene tåler bare ~20 oppslag per skriving, så bakverkene lagres to og to.
 */
export async function registerCakes(
  db: Firestore, config: AppConfig, person: { name: string; phone: string }, lines: CakeLine[],
): Promise<string> {
  const limits = cakeLimitsOf(config);
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
      for (const l of chunk) {
        const ref = doc(collection(db, 'cakes'));
        const max = limits[l.type as CakeTypeId];
        let slot = '';
        if (max) {
          slot = freeSlot(slotKey(l.type, l.deliveryDay), max);
          if (!slot && baseFull(config, used, l.deliveryDay)) {
            slot = freeSlot(slotKey(EXTRA, l.deliveryDay), cap > 0 ? cap : 10_000);
          }
          if (!slot) throw new FullError(l.type, l.deliveryDay, i);
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
        break;
      } catch (e) {
        if (attempt >= 2) throw e; // noen tok samme plass samtidig: les på nytt og prøv igjen
      }
    }
  }
  return regId;
}

/** Admin: sletter et bakverk og frigjør plassen. */
export async function deleteCake(db: Firestore, cake: { id: string; slot?: string }): Promise<void> {
  if (cake.slot) await deleteDoc(doc(db, 'cakeSlots', cake.slot));
  await deleteDoc(doc(db, 'cakes', cake.id));
}
