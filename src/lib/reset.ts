// Nullstilling før lansering: sletter all testdata, beholder oppsett og stasjonslenker.
// Blokkert når oppsettet er markert som lansert.
import { collection, doc, getDoc, getDocs, writeBatch, type Firestore } from 'firebase/firestore';

export const RESET_COLLECTIONS = ['signups', 'people', 'publicRoster', 'cakes', 'cakeSlots', 'prizes', 'sponsorIndex', 'sessions'];

export async function resetTestData(db: Firestore): Promise<Record<string, number>> {
  const cfg = await getDoc(doc(db, 'config', 'main'));
  if (cfg.data()?.launched) throw new Error('Basaren er markert som lansert. Nullstilling er sperret.');

  const result: Record<string, number> = {};
  for (const name of RESET_COLLECTIONS) {
    const snap = await getDocs(collection(db, name));
    result[name] = snap.size;
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  // Tellerne nullstilles, men beholder maks (kapasiteten)
  const counts = await getDocs(collection(db, 'shiftCounts'));
  for (let i = 0; i < counts.docs.length; i += 400) {
    const b = writeBatch(db);
    counts.docs.slice(i, i + 400).forEach((d) => b.update(d.ref, { count: 0, lastSignup: '' }));
    await b.commit();
  }
  result.shiftCounts = counts.size;
  return result;
}
