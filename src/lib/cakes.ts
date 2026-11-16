import { collection, doc, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';
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

/** Én registrering = ett dokument per bakverk, skrevet samlet. Hvert levert bakverk gir ett lodd. */
export async function registerCakes(db: Firestore, person: { name: string; phone: string }, lines: CakeLine[]): Promise<string> {
  const batch = writeBatch(db);
  const regId = doc(collection(db, 'cakes')).id;
  for (const l of lines) {
    batch.set(doc(collection(db, 'cakes')), {
      regId,
      name: person.name,
      phone: person.phone,
      type: l.type,
      variant: l.variant.trim(),
      glutenFree: l.glutenFree,
      lactoseFree: l.lactoseFree,
      allergens: l.allergens.trim(),
      deliveryDay: l.deliveryDay,
      delivered: false,
      source: 'app',
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return regId;
}
