// Kjøres mot Firestore-emulatoren: npm run test:rules (og i GitHub Actions).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch, serverTimestamp, type Firestore } from 'firebase/firestore';
import { SEED_CONFIG } from '../src/config/seed';
import { signUpForDay } from '../src/lib/signup';
import { addManual, cancelSignup, moveSignup, setPublicName } from '../src/lib/adminOps';
import { resetTestData } from '../src/lib/reset';
import { registerCakes, emptyLine, cakeAvailability, deleteCake } from '../src/lib/cakes';
import { registerPrizes, sponsorExists } from '../src/lib/prizes';

let env: RulesTestEnvironment;
const ADMIN = { email: 'pji.idistudios@gmail.com', email_verified: true };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-basar',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config', 'main'), SEED_CONFIG);
    for (const s of SEED_CONFIG.shifts) {
      await setDoc(doc(db, 'shiftCounts', s.id), { count: 0, max: s.base + s.extra, lastSignup: '' });
    }
  });
});

const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
const admin = () => env.authenticatedContext('admin', ADMIN).firestore() as unknown as Firestore;
const person = (n: number) => ({ name: `Test ${n}`, phone: '+47' + String(40000000 + n), email: '' });

describe('personvern', () => {
  it('anonym kan melde seg på, men ikke lese påmeldinger', async () => {
    const res = await signUpForDay(anon(), SEED_CONFIG, person(1), 'd1', 'hele');
    expect(res.shift).not.toBeNull();
    await assertFails(getDocs(collection(anon(), 'signups')));
  });

  it('anonym kan ikke liste personindeksen, men slå opp ett nummer', async () => {
    await assertFails(getDocs(collection(anon(), 'people')));
    await assertSucceeds(getDoc(doc(anon(), 'people', '+4740000001')));
  });

  it('admin kan lese påmeldinger', async () => {
    await signUpForDay(anon(), SEED_CONFIG, person(1), 'd1', 'hele');
    const snap = await assertSucceeds(getDocs(collection(admin(), 'signups')));
    expect(snap.size).toBe(1);
  });

  it('en innlogget konto som ikke er admin får ikke lese', async () => {
    const other = env.authenticatedContext('x', { email: 'noen@gmail.com', email_verified: true }).firestore();
    await assertFails(getDocs(collection(other, 'signups')));
  });

  it('alt utenfor kjente samlinger er stengt', async () => {
    await assertFails(setDoc(doc(anon(), 'volunteers', 'x'), { a: 1 }));
  });
});

describe('kapasitet håndheves i reglene', () => {
  it('kan ikke øke telleren uten en ny påmelding', async () => {
    await assertFails(setDoc(doc(anon(), 'shiftCounts', 'd1-kafe-1400'), { count: 1, max: 8, lastSignup: 'fake' }));
  });

  it('kan ikke opprette aktiv påmelding uten å øke telleren', async () => {
    await assertFails(setDoc(doc(anon(), 'signups', 'abc'), {
      name: 'Juks', phone: '+4740000099', email: '', day: 'd1', timePref: 'hele', source: 'app',
      attended: false, createdAt: serverTimestamp(), shiftId: 'd1-kafe-1400', status: 'aktiv',
    }));
  });

  it('kan ikke gå over max selv med gyldig mønster', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'shiftCounts', 'd1-kafe-1400'), { count: 8, max: 8, lastSignup: 'old' });
    });
    const db = anon();
    const b = writeBatch(db);
    b.set(doc(db, 'signups', 'ny1'), {
      name: 'For mange', phone: '+4740000098', email: '', day: 'd1', timePref: 'hele', source: 'app',
      attended: false, createdAt: serverTimestamp(), shiftId: 'd1-kafe-1400', status: 'aktiv',
    });
    b.update(doc(db, 'shiftCounts', 'd1-kafe-1400'), { count: 9, lastSignup: 'ny1' });
    await assertFails(b.commit());
  });

  it('Opprigg stopper på 100', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await signUpForDay(anon(), SEED_CONFIG, person(i), 'opprigg', 'hele');
      expect(r.shift?.id).toBe('opprigg-1800');
    }
    const r = await signUpForDay(anon(), SEED_CONFIG, person(200), 'opprigg', 'hele');
    expect(r.shift).toBeNull(); // venteliste
  });

  it('samtidige påmeldinger går aldri over grensen', async () => {
    const n = 90; // dag 1 har 77 plasser totalt
    const results = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => signUpForDay(anon(), SEED_CONFIG, person(i), 'd1', 'hele')),
    );
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const signups = await getDocs(collection(db, 'signups'));
      const perShift: Record<string, number> = {};
      signups.forEach((d) => { const s = d.data().shiftId; if (s) perShift[s] = (perShift[s] ?? 0) + 1; });
      for (const s of SEED_CONFIG.shifts.filter((x) => x.day === 'd1')) {
        expect(perShift[s.id] ?? 0).toBeLessThanOrEqual(s.base + s.extra);
        const c = await getDoc(doc(db, 'shiftCounts', s.id));
        expect(c.data()!.count).toBe(perShift[s.id] ?? 0); // teller stemmer med faktiske rader
      }
    });
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(0);
  }, 120_000);
});

describe('validering og personindeks', () => {
  it('avviser ugyldig telefonnummer', async () => {
    await expect(signUpForDay(anon(), SEED_CONFIG, { name: 'X Y', phone: '123', email: '' }, 'd1', 'hele')).rejects.toThrow();
  });

  it('samme telefon får ikke overlappende vakter', async () => {
    const p = person(5);
    const a = await signUpForDay(anon(), SEED_CONFIG, p, 'd1', 'hele');
    const b = await signUpForDay(anon(), SEED_CONFIG, p, 'd1', 'hele');
    expect(a.shift && b.shift).toBeTruthy();
    const [x, y] = [a.shift!, b.shift!];
    expect(x.start < y.end && y.start < x.end).toBe(false);
  });

  it('kan ikke fjerne skift fra en annens personindeks', async () => {
    await signUpForDay(anon(), SEED_CONFIG, person(6), 'd1', 'hele');
    await assertFails(setDoc(doc(anon(), 'people', person(6).phone), { shifts: {} }));
  });

  it('bare admin kan endre oppsettet', async () => {
    await assertFails(setDoc(doc(anon(), 'config', 'main'), { year: 1 }));
    await assertSucceeds(setDoc(doc(admin(), 'config', 'main'), SEED_CONFIG));
  });
});

describe('admin: manuell registrering og endring', () => {
  const count = async (id: string) => (await getDoc(doc(admin(), 'shiftCounts', id))).data()!.count;
  const signupsOf = async () => (await getDocs(collection(admin(), 'signups'))).docs.map((d) => ({ id: d.id, ...d.data() }) as any);

  it('admin kan legge til over kapasiteten, telleren følger med', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'shiftCounts', 'd1-kafe-1400'), { count: 8, max: 8, lastSignup: 'x' });
    });
    await addManual(admin(), SEED_CONFIG, { name: 'Uanmeldt', phone: '+4740000500' }, 'd1-kafe-1400', true);
    expect(await count('d1-kafe-1400')).toBe(9);
    const s = (await signupsOf())[0];
    expect(s.source).toBe('manuell');
    expect(s.attended).toBe(true);
  });

  it('anonym kan ikke bruke admin-operasjonene', async () => {
    await expect(addManual(anon(), SEED_CONFIG, { name: 'X', phone: '+4740000501' }, 'd1-kafe-1400', true)).rejects.toThrow();
  });

  it('flytt trekker fra gammelt skift og legger til på nytt', async () => {
    const id = await addManual(admin(), SEED_CONFIG, { name: 'Flytt', phone: '+4740000502' }, 'd1-kafe-1600', false);
    await moveSignup(admin(), SEED_CONFIG, id, 'd2-kafe-1800');
    expect(await count('d1-kafe-1600')).toBe(0);
    expect(await count('d2-kafe-1800')).toBe(1);
    const p = (await getDoc(doc(admin(), 'people', '+4740000502'))).data()!;
    expect(Object.keys(p.shifts)).toEqual(['d2-kafe-1800']);
  });

  it('meld av frigjør plassen og beholder raden', async () => {
    const id = await addManual(admin(), SEED_CONFIG, { name: 'Av', phone: '+4740000503' }, 'd1-arer-1530', false);
    expect(await cancelSignup(admin(), id)).toBe('d1-arer-1530');
    expect(await count('d1-arer-1530')).toBe(0);
    const s = (await signupsOf()).find((x: any) => x.id === id);
    expect(s.status).toBe('avmeldt');
    expect(await cancelSignup(admin(), id)).toBeNull(); // to ganger trekker ikke fra to ganger
    expect(await count('d1-arer-1530')).toBe(0);
  });

  it('flytt fra venteliste øker bare det nye skiftet', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'signups', 'vent1'), {
        name: 'Venter', phone: '+4740000504', email: '', day: 'd1', timePref: 'hele', source: 'app',
        attended: false, createdAt: new Date(), shiftId: null, status: 'venteliste',
      });
    });
    await moveSignup(admin(), SEED_CONFIG, 'vent1', 'd1-lynlodd-1700');
    expect(await count('d1-lynlodd-1700')).toBe(1);
    const s = (await signupsOf()).find((x: any) => x.id === 'vent1');
    expect(s.status).toBe('aktiv');
  });
});

describe('stasjonslenker', () => {
  const lead = () => env.authenticatedContext('anon-lead', { firebase: { sign_in_provider: 'anonymous' } } as any).firestore() as unknown as Firestore;
  const kafeQ = (db: Firestore) => query(collection(db, 'signups'), where('stationKey', '==', 'kafe'), where('status', '==', 'aktiv'));

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'access', 'tok-kafe-abcdefghijkl'), { kind: 'stasjon', stationKey: 'kafe', station: 'Kafé' });
    });
    await addManual(admin(), SEED_CONFIG, { name: 'Kafé-person', phone: '+4740000600' }, 'd1-kafe-1400', false);
    await addManual(admin(), SEED_CONFIG, { name: 'Årer-person', phone: '+4740000601' }, 'd1-arer-1530', false);
  });

  it('uten gyldig lenke får man ikke lese', async () => {
    await assertFails(getDocs(kafeQ(lead())));
    await assertFails(setDoc(doc(lead(), 'sessions', 'anon-lead'), { token: 'gjettet-kode' }));
  });

  it('gyldig lenke leser egen stasjon, ikke andres', async () => {
    const db = lead();
    await assertSucceeds(setDoc(doc(db, 'sessions', 'anon-lead'), { token: 'tok-kafe-abcdefghijkl' }));
    const snap = await assertSucceeds(getDocs(kafeQ(db)));
    expect(snap.docs.map((d) => d.data().name)).toEqual(['Kafé-person']);
    await assertFails(getDocs(query(collection(db, 'signups'), where('stationKey', '==', 'arer'))));
    await assertFails(getDocs(collection(db, 'signups')));
  });

  it('kan krysse av oppmøte, men ikke endre noe annet', async () => {
    const db = lead();
    await setDoc(doc(db, 'sessions', 'anon-lead'), { token: 'tok-kafe-abcdefghijkl' });
    const id = (await getDocs(kafeQ(db))).docs[0].id;
    await assertSucceeds(updateDoc(doc(db, 'signups', id), { attended: true }));
    await assertFails(updateDoc(doc(db, 'signups', id), { name: 'Endret' }));
    await assertFails(updateDoc(doc(db, 'signups', id), { attended: false, status: 'avmeldt' }));
  });

  it('sperret lenke slutter å virke med en gang', async () => {
    const db = lead();
    await setDoc(doc(db, 'sessions', 'anon-lead'), { token: 'tok-kafe-abcdefghijkl' });
    await assertSucceeds(getDocs(kafeQ(db)));
    await deleteDoc(doc(admin(), 'access', 'tok-kafe-abcdefghijkl'));
    await assertFails(getDocs(kafeQ(db)));
  });

  it('bare admin kan lage lenker eller liste dem', async () => {
    await assertFails(setDoc(doc(lead(), 'access', 'egen'), { kind: 'stasjon', stationKey: 'kafe', station: 'Kafé' }));
    await assertFails(getDocs(collection(lead(), 'access')));
  });
});

describe('kaker', () => {
  const desk = () => env.authenticatedContext('anon-desk', { firebase: { sign_in_provider: 'anonymous' } } as any).firestore() as unknown as Firestore;
  const line = (type: any, day: any) => ({ ...emptyLine(), type, deliveryDay: day, variant: 'Sjokolade', allergens: 'egg' });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'access', 'tok-kake-abcdefghijkl'), { kind: 'kake', stationKey: 'kake', station: 'Kakemottak' });
      await setDoc(doc(ctx.firestore(), 'access', 'tok-kafe-abcdefghijkl'), { kind: 'stasjon', stationKey: 'kafe', station: 'Kafé' });
    });
  });

  it('anonym kan registrere flere bakverk, men ikke lese dem', async () => {
    await registerCakes(anon(), SEED_CONFIG, { name: 'Kari', phone: '+4740000700' }, [line('blotekake', 'd1'), line('vaffel', 'd2')]);
    await assertFails(getDocs(collection(anon(), 'cakes')));
    const all = await getDocs(collection(admin(), 'cakes'));
    expect(all.size).toBe(2);
    expect(new Set(all.docs.map((d) => d.data().regId)).size).toBe(1);
  });

  it('avviser ukjent type, ugyldig dag og ferdig avkrysset levert', async () => {
    await expect(registerCakes(anon(), SEED_CONFIG, { name: 'Kari', phone: '+4740000700' }, [line('pizza', 'd1')])).rejects.toThrow();
    await expect(registerCakes(anon(), SEED_CONFIG, { name: 'Kari', phone: '+4740000700' }, [line('brownie', 'opprigg')])).rejects.toThrow();
    await assertFails(setDoc(doc(anon(), 'cakes', 'x'), {
      regId: 'r', name: 'Juks', phone: '+4740000701', type: 'formkake', variant: '', glutenFree: false, lactoseFree: false,
      allergens: '', deliveryDay: 'd1', slot: '', delivered: true, source: 'app', createdAt: serverTimestamp() }));
  });

  it('kakemottak leser og krysser av levert, men endrer ikke annet', async () => {
    await registerCakes(anon(), SEED_CONFIG, { name: 'Kari', phone: '+4740000700' }, [line('muffins', 'd1')]);
    const db = desk();
    await setDoc(doc(db, 'sessions', 'anon-desk'), { token: 'tok-kake-abcdefghijkl' });
    const snap = await assertSucceeds(getDocs(collection(db, 'cakes')));
    const id = snap.docs[0].id;
    await assertSucceeds(updateDoc(doc(db, 'cakes', id), { delivered: true }));
    await assertFails(updateDoc(doc(db, 'cakes', id), { name: 'Endret' }));
  });

  it('stasjonslenke får ikke lese kaker', async () => {
    const db = desk();
    await setDoc(doc(db, 'sessions', 'anon-desk'), { token: 'tok-kafe-abcdefghijkl' });
    await assertFails(getDocs(collection(db, 'cakes')));
  });
});

describe('gevinster og sponsorsøk', () => {
  const rema = { name: 'Rema 1000 Kautokeino', contact: 'Per', phone: '+4741234567' };

  it('anonym kan registrere flere gevinster, men ikke lese dem', async () => {
    await registerPrizes(anon(), rema, [{ gift: 'Gavekort', qty: 2, value: 500 }, { gift: 'Bensindunk 20 L', qty: 1, value: 0 }]);
    await assertFails(getDocs(collection(anon(), 'prizes')));
    const all = await getDocs(collection(admin(), 'prizes'));
    expect(all.size).toBe(3); // 2 gavekort blir to egne gevinster
    expect(all.docs.every((d) => d.data().qty === 1 && d.data().book === '')).toBe(true);
  });

  it('søket svarer bare ja/nei, på starten av navnet', async () => {
    await registerPrizes(anon(), rema, [{ gift: 'Gavekort', qty: 1, value: 500 }]);
    expect(await sponsorExists(anon(), 'rema')).toBe(true);
    expect(await sponsorExists(anon(), 'REMA 1000')).toBe(true);
    expect(await sponsorExists(anon(), 'Coop')).toBe(false);
  });

  it('kan ikke liste hele sponsorlisten', async () => {
    await registerPrizes(anon(), rema, [{ gift: 'Gavekort', qty: 1, value: 500 }]);
    await assertFails(getDocs(collection(anon(), 'sponsorIndex')));
  });

  it('kan ikke lage falsk sponsor uten gevinst', async () => {
    await assertFails(setDoc(doc(anon(), 'sponsorIndex', 'falskeas'), { prize: 'finnesikke' }));
  });

  it('avviser ugyldig antall, negativ verdi og ferdig bekreftet status', async () => {
    await expect(registerPrizes(anon(), rema, [{ gift: 'Gavekort', qty: 0, value: 500 }])).rejects.toThrow();
    await expect(registerPrizes(anon(), rema, [{ gift: 'Gavekort', qty: 1, value: -5 }])).rejects.toThrow();
    await assertFails(setDoc(doc(anon(), 'prizes', 'x'), {
      regId: 'r', sponsor: 'Juks', sponsorKey: 'juks', contact: 'Ja', phone: '+4741234567', gift: 'Bil', qty: 1, value: 1,
      status: 'bekreftet', source: 'app', createdAt: serverTimestamp() }));
  });

  it('offentlig kan ikke velge bok selv', async () => {
    await assertFails(setDoc(doc(anon(), 'prizes', 'y'), {
      regId: 'r', sponsor: 'Coop', sponsorKey: 'coop', contact: 'Ola', phone: '+4741234567', gift: 'Kurv', qty: 1, value: 300,
      book: 'Basarbok 1', status: 'registrert', source: 'app', createdAt: serverTimestamp() }));
  });

  it('admin kan legge gevinst i bok', async () => {
    await registerPrizes(anon(), rema, [{ gift: 'Gavekort', qty: 1, value: 500 }]);
    const id = (await getDocs(collection(admin(), 'prizes'))).docs[0].id;
    await assertSucceeds(updateDoc(doc(admin(), 'prizes', id), { book: 'Basarbok 4' }));
  });

  it('bare admin kan endre status', async () => {
    await registerPrizes(anon(), rema, [{ gift: 'Gavekort', qty: 1, value: 500 }]);
    const id = (await getDocs(collection(admin(), 'prizes'))).docs[0].id;
    await assertFails(updateDoc(doc(anon(), 'prizes', id), { status: 'bekreftet' }));
    await assertSucceeds(updateDoc(doc(admin(), 'prizes', id), { status: 'bekreftet' }));
  });
});

describe('kakekvoter (kafeens ønskeliste)', () => {
  const line = (type: string, day: any, gf = false, variant = '') => ({ ...emptyLine(), type, deliveryDay: day, glutenFree: gf, variant });
  const p = (n: number) => ({ name: `Baker ${n}`, phone: '+4741' + String(100000 + n) });
  const LIST = Object.entries(SEED_CONFIG.cakeLimits!).filter(([t]) => t !== 'vaffel');
  const fillDay = async (day: string) => {
    const all = LIST.flatMap(([t, n]) => Array(n).fill(t));
    expect(all).toHaveLength(24);
    await registerCakes(anon(), SEED_CONFIG, p(0), all.map((t) => line(t, day, false, t === 'annenkake' ? 'Eplekake' : '')));
  };

  it('stopper på kvoten per type og dag, andre dag er uavhengig', async () => {
    for (let i = 0; i < 3; i++) await registerCakes(anon(), SEED_CONFIG, p(i), [line('blotekake', 'd1')]); // kvote 3
    await expect(registerCakes(anon(), SEED_CONFIG, p(9), [line('blotekake', 'd1')])).rejects.toThrow(/Fullt/);
    await registerCakes(anon(), SEED_CONFIG, p(10), [line('blotekake', 'd2')]);
    const a = await cakeAvailability(anon());
    expect(a.used['blotekake_d1']).toBe(3);
    expect(a.used['blotekake_d2']).toBe(1);
    expect(a.used['base_d1']).toBe(3); // hver kake tar også en dagsplass
  });

  it('vaffelrøre: maks 6 × 4 liter per dag, tar ingen dagsplass', async () => {
    await registerCakes(anon(), SEED_CONFIG, p(1), Array.from({ length: 6 }, () => line('vaffel', 'd1')));
    await expect(registerCakes(anon(), SEED_CONFIG, p(2), [line('vaffel', 'd1')])).rejects.toThrow(/Fullt/);
    expect((await cakeAvailability(anon())).used['base_d1'] ?? 0).toBe(0);
  });

  it('«Annen kake» må beskrives', async () => {
    await expect(registerCakes(anon(), SEED_CONFIG, p(1), [line('annenkake', 'd1')])).rejects.toThrow();
    await registerCakes(anon(), SEED_CONFIG, p(1), [line('annenkake', 'd1', false, 'Eplekake')]);
  });

  it('ukjent kaketype avvises', async () => {
    await expect(registerCakes(anon(), { ...SEED_CONFIG, cakeLimits: { ...SEED_CONFIG.cakeLimits, pizza: 5 } }, p(1), [line('pizza', 'd1')])).rejects.toThrow();
  });

  it('kan ikke ta plass over kvoten eller uten bakverk, selv om man jukser', async () => {
    await assertFails(setDoc(doc(anon(), 'cakeSlots', 'muffins_d1_2'), { cake: 'x', gf: false }));
    await assertFails(setDoc(doc(anon(), 'cakeSlots', 'muffins_d1_1'), { cake: 'finnesikke', gf: false }));
    await assertFails(setDoc(doc(anon(), 'cakeSlots', 'base_d1_25'), { cake: 'x', gf: false }));
  });

  it('samtidige påmeldinger går ikke over kvoten', async () => {
    const res = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => registerCakes(anon(), SEED_CONFIG, p(i), [line('brownie', 'd2')])));
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeLessThanOrEqual(3);
    const a = await cakeAvailability(anon());
    expect(a.used['brownie_d2'] ?? 0).toBe(ok);
    expect(a.used['base_d2'] ?? 0).toBe(ok);
  }, 60_000);

  it('glutenfri telles i plassene', async () => {
    await registerCakes(anon(), SEED_CONFIG, p(1), [line('blotekake', 'd1', true), line('brownie', 'd1')]);
    const a = await cakeAvailability(anon());
    expect(a.gf['blotekake_d1']).toBe(1);
    expect(a.gf['brownie_d1'] ?? 0).toBe(0);
  });

  it('admin-sletting frigjør begge plassene', async () => {
    await registerCakes(anon(), SEED_CONFIG, p(1), [line('muffins', 'd1')]); // kvote 1
    const first = (await getDocs(collection(admin(), 'cakes'))).docs[0];
    await deleteCake(admin(), { id: first.id, slot: first.data().slot, daySlot: first.data().daySlot });
    const a = await cakeAvailability(anon());
    expect(a.used['muffins_d1'] ?? 0).toBe(0);
    expect(a.used['base_d1'] ?? 0).toBe(0);
    await registerCakes(anon(), SEED_CONFIG, p(2), [line('muffins', 'd1')]);
  });

  it('en full type er stengt så lenge ikke alle 24 kakene er meldt', async () => {
    await registerCakes(anon(), SEED_CONFIG, p(1), [line('muffins', 'd1')]);
    await expect(registerCakes(anon(), SEED_CONFIG, p(2), [line('muffins', 'd1')])).rejects.toThrow(/Fullt/);
    await assertFails(setDoc(doc(anon(), 'cakeSlots', 'ekstra_d1_1'), { cake: 'x', gf: false }));
  });

  it('når alle 24 er meldt, åpner kakene igjen som ekstra, men ikke vaffelrøre', async () => {
    await fillDay('d1');
    await registerCakes(anon(), SEED_CONFIG, p(30), [line('blotekake', 'd1'), line('muffins', 'd1')]);
    expect((await cakeAvailability(anon())).used['ekstra_d1']).toBe(2);
    await registerCakes(anon(), SEED_CONFIG, p(31), Array.from({ length: 6 }, () => line('vaffel', 'd1')));
    await expect(registerCakes(anon(), SEED_CONFIG, p(32), [line('vaffel', 'd1')])).rejects.toThrow(/Fullt/);
    // dag 2 er fortsatt på vanlig kvote
    await registerCakes(anon(), SEED_CONFIG, p(40), [line('muffins', 'd2')]);
    await expect(registerCakes(anon(), SEED_CONFIG, p(41), [line('muffins', 'd2')])).rejects.toThrow(/Fullt/);
  }, 90_000);

  it('grense for ekstra kan settes i oppsettet', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'config', 'main'), { ...SEED_CONFIG, cakeExtraPerDay: 2 });
    });
    const cfg = { ...SEED_CONFIG, cakeExtraPerDay: 2 };
    await fillDay('d2');
    await registerCakes(anon(), cfg, p(60), [line('blotekake', 'd2'), line('brownie', 'd2')]);
    await expect(registerCakes(anon(), cfg, p(61), [line('blotekake', 'd2')])).rejects.toThrow(/Fullt/);
    await assertFails(setDoc(doc(anon(), 'cakeSlots', 'ekstra_d2_3'), { cake: 'x', gf: false }));
  }, 90_000);
});

describe('offentlig vaktliste', () => {
  const roster = async () => (await getDocs(collection(anon(), 'publicRoster'))).docs.map((d) => ({ id: d.id, ...d.data() }) as any);

  it('med samtykke: navn og skift vises for alle, aldri telefon', async () => {
    const r = await signUpForDay(anon(), SEED_CONFIG, { ...person(1), publicName: true }, 'd1', 'hele');
    const list = await roster();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Test 1', shiftId: r.shift!.id });
    expect(Object.keys(list[0]).sort()).toEqual(['id', 'name', 'shiftId']);
  });

  it('uten samtykke: ingen oppføring, og man kan ikke legge seg inn i etterkant', async () => {
    await signUpForDay(anon(), SEED_CONFIG, person(2), 'd1', 'hele');
    expect(await roster()).toHaveLength(0);
    const id = (await getDocs(collection(admin(), 'signups'))).docs[0].id;
    await assertFails(setDoc(doc(anon(), 'publicRoster', id), { name: 'Test 2', shiftId: 'd1-kafe-1400' }));
  });

  it('kan ikke legge falske navn på listen', async () => {
    await assertFails(setDoc(doc(anon(), 'publicRoster', 'falsk'), { name: 'Kjendis', shiftId: 'd1-kafe-1400' }));
  });

  it('flytting og avmelding følger med, admin kan slå av og på', async () => {
    const id = await addManual(admin(), SEED_CONFIG, { name: 'Synlig', phone: '+4740000800' }, 'd1-kafe-1400', false, true);
    await moveSignup(admin(), SEED_CONFIG, id, 'd2-kafe-1600');
    expect((await roster())[0].shiftId).toBe('d2-kafe-1600');
    await setPublicName(admin(), id, false);
    expect(await roster()).toHaveLength(0);
    await setPublicName(admin(), id, true);
    expect(await roster()).toHaveLength(1);
    await cancelSignup(admin(), id);
    expect(await roster()).toHaveLength(0);
  });
});

describe('reservekonto og nullstilling', () => {
  const reserve = () => env.authenticatedContext('res', { email: 'basar@kautokeinoil.no', email_verified: true }).firestore() as unknown as Firestore;

  it('reservekontoen er admin', async () => {
    await signUpForDay(anon(), SEED_CONFIG, person(1), 'd1', 'hele');
    await assertSucceeds(getDocs(collection(reserve(), 'signups')));
  });

  it('nullstilling sletter testdata, nullstiller tellere og beholder oppsett og lenker', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'access', 'tok-x'), { kind: 'stasjon', stationKey: 'kafe', station: 'Kafé' });
    });
    await signUpForDay(anon(), SEED_CONFIG, { ...person(1), publicName: true }, 'd1', 'hele');
    await registerCakes(anon(), SEED_CONFIG, { name: 'Kari', phone: '+4740000700' }, [{ ...emptyLine(), type: 'muffins', deliveryDay: 'd1' }]);
    await registerPrizes(anon(), { name: 'Rema 1000', contact: 'Per', phone: '+4741234567' }, [{ gift: 'Gavekort', qty: 2, value: 500 }]);

    const r = await resetTestData(admin());
    expect(r.signups).toBe(1);
    for (const c of ['signups', 'people', 'publicRoster', 'cakes', 'cakeSlots', 'prizes', 'sponsorIndex']) {
      expect((await getDocs(collection(admin(), c))).size).toBe(0);
    }
    const counts = await getDocs(collection(admin(), 'shiftCounts'));
    expect(counts.docs.every((d) => d.data().count === 0 && d.data().max > 0)).toBe(true);
    expect((await getDoc(doc(admin(), 'config', 'main'))).exists()).toBe(true);
    expect((await getDoc(doc(admin(), 'access', 'tok-x'))).exists()).toBe(true);
  });

  it('nullstilling er sperret etter lansering, og anonym kan ikke nullstille', async () => {
    await expect(resetTestData(anon())).rejects.toThrow();
    await updateDoc(doc(admin(), 'config', 'main'), { launched: true });
    await expect(resetTestData(admin())).rejects.toThrow(/lansert/);
  });
});

describe('allerede opptatt', () => {
  it('samme nummer på Opprigg igjen gir «opptatt», ikke venteliste, og lagrer ingenting', async () => {
    const a = await signUpForDay(anon(), SEED_CONFIG, person(1), 'opprigg', 'hele');
    expect(a.status).toBe('tildelt');
    const b = await signUpForDay(anon(), SEED_CONFIG, person(1), 'opprigg', 'hele');
    expect(b.status).toBe('opptatt');
    expect((await getDocs(collection(admin(), 'signups'))).size).toBe(1);
  });

  it('ekte fullt gir fortsatt venteliste', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'shiftCounts', 'opprigg-1800'), { count: 100, max: 100, lastSignup: 'x' });
    });
    const r = await signUpForDay(anon(), SEED_CONFIG, person(2), 'opprigg', 'hele');
    expect(r.status).toBe('venteliste');
  });
});

describe('admin: ingen dobbel vakt', () => {
  it('samme person kan ikke legges inn to ganger på samme vakt', async () => {
    await addManual(admin(), SEED_CONFIG, { name: 'Dobbel', phone: '+4740000900' }, 'opprigg-1800', false);
    await expect(addManual(admin(), SEED_CONFIG, { name: 'Dobbel', phone: '+4740000900' }, 'opprigg-1800', false)).rejects.toThrow(/allerede/);
  });
});
