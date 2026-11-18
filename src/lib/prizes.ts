import {
  collection, doc, getDocs, limit, orderBy, query, serverTimestamp, startAt, endAt, writeBatch, type Firestore,
} from 'firebase/firestore';

export type PrizeStatus = 'registrert' | 'bekreftet' | 'mottatt' | 'avvist';
export const PRIZE_STATUSES: PrizeStatus[] = ['registrert', 'bekreftet', 'mottatt', 'avvist'];

/** Basarbøkene. Hver gevinst (ett stk) legges i én bok. */
export const BOOKS = [...Array.from({ length: 12 }, (_, i) => `Basarbok ${i + 1}`), 'Årer'];
export const MAX_PER_LINE = 100;

export interface PrizeLine { gift: string; qty: string; value: string }
export const emptyPrize = (): PrizeLine => ({ gift: '', qty: '1', value: '' });

export interface Prize {
  id: string; regId: string; sponsor: string; sponsorKey: string; contact: string; phone: string;
  gift: string; qty: number; value: number; status: PrizeStatus; source: string; book: string;
}

/** Søkenøkkel: små bokstaver, bare bokstaver og tall. «Rema 1000 Kautokeino AS» → rema1000kautokeinoas */
export function sponsorKey(name: string): string {
  return name.toLowerCase().normalize('NFC').replace(/[^a-z0-9æøåäöáčđŋšŧž]/g, '');
}

/** Heltall ≥ min, eller null. Godtar «1 500», «1500,-» og «kr 1500». */
export function parseWhole(input: string, min: number): number | null {
  const d = input.replace(/[\s.]/g, '').replace(/,-$/, '').replace(/^kr/i, '').replace(/kr$/i, '');
  if (!/^\d+$/.test(d)) return null;
  const n = Number(d);
  return n >= min && n <= 10_000_000 ? n : null;
}

/**
 * Registrerer gevinster fra samme sponsor, pluss sponsorindeksen for søket.
 * Hvert STYKK blir en egen gevinst med egen ID, slik at de kan fordeles på ulike basarbøker.
 */
export async function registerPrizes(
  db: Firestore, sponsor: { name: string; contact: string; phone: string }, lines: { gift: string; qty: number; value: number }[],
): Promise<void> {
  const key = sponsorKey(sponsor.name);
  const batch = writeBatch(db);
  const regId = doc(collection(db, 'prizes')).id;
  let first = '';
  for (const l of lines) {
    for (let n = 0; n < l.qty; n++) {
      const ref = doc(collection(db, 'prizes'));
      if (!first) first = ref.id;
      batch.set(ref, {
        regId, sponsor: sponsor.name.trim(), sponsorKey: key, contact: sponsor.contact.trim(), phone: sponsor.phone,
        gift: l.gift.trim(), qty: 1, value: l.value, book: '', status: 'registrert', source: 'app', createdAt: serverTimestamp(),
      });
    }
  }
  batch.set(doc(db, 'sponsorIndex', key), { prize: first });
  await batch.commit();
}

/** Ja/nei: finnes en sponsor hvis navn starter med søket? Returnerer aldri detaljer. */
export async function sponsorExists(db: Firestore, search: string): Promise<boolean> {
  const key = sponsorKey(search);
  if (key.length < 3) throw new Error('For kort søk');
  const q = query(collection(db, 'sponsorIndex'), orderBy('__name__'), startAt(key), endAt(key + ''), limit(1));
  return !(await getDocs(q)).empty;
}
