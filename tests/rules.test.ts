// Kjøres mot Firestore-emulatoren: npm run test:rules (og i GitHub Actions).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch, serverTimestamp, type Firestore } from 'firebase/firestore';
import { SEED_CONFIG } from '../src/config/seed';
import { signUpForDay } from '../src/lib/signup';
import { addManual, cancelSignup, moveSignup } from '../src/lib/adminOps';

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
const person = (n: number) => ({ name: `Test ${n}`, phone: String(40000000 + n), email: '' });

describe('personvern', () => {
  it('anonym kan melde seg på, men ikke lese påmeldinger', async () => {
    const res = await signUpForDay(anon(), SEED_CONFIG, person(1), 'd1', 'hele');
    expect(res.shift).not.toBeNull();
    await assertFails(getDocs(collection(anon(), 'signups')));
  });

  it('anonym kan ikke liste personindeksen, men slå opp ett nummer', async () => {
    await assertFails(getDocs(collection(anon(), 'people')));
    await assertSucceeds(getDoc(doc(anon(), 'people', '40000001')));
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
      name: 'Juks', phone: '40000099', email: '', day: 'd1', timePref: 'hele', source: 'app',
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
      name: 'For mange', phone: '40000098', email: '', day: 'd1', timePref: 'hele', source: 'app',
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
    await addManual(admin(), SEED_CONFIG, { name: 'Uanmeldt', phone: '40000500' }, 'd1-kafe-1400', true);
    expect(await count('d1-kafe-1400')).toBe(9);
    const s = (await signupsOf())[0];
    expect(s.source).toBe('manuell');
    expect(s.attended).toBe(true);
  });

  it('anonym kan ikke bruke admin-operasjonene', async () => {
    await expect(addManual(anon(), SEED_CONFIG, { name: 'X', phone: '40000501' }, 'd1-kafe-1400', true)).rejects.toThrow();
  });

  it('flytt trekker fra gammelt skift og legger til på nytt', async () => {
    const id = await addManual(admin(), SEED_CONFIG, { name: 'Flytt', phone: '40000502' }, 'd1-kafe-1600', false);
    await moveSignup(admin(), SEED_CONFIG, id, 'd2-kafe-1800');
    expect(await count('d1-kafe-1600')).toBe(0);
    expect(await count('d2-kafe-1800')).toBe(1);
    const p = (await getDoc(doc(admin(), 'people', '40000502'))).data()!;
    expect(Object.keys(p.shifts)).toEqual(['d2-kafe-1800']);
  });

  it('meld av frigjør plassen og beholder raden', async () => {
    const id = await addManual(admin(), SEED_CONFIG, { name: 'Av', phone: '40000503' }, 'd1-arer-1530', false);
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
        name: 'Venter', phone: '40000504', email: '', day: 'd1', timePref: 'hele', source: 'app',
        attended: false, createdAt: new Date(), shiftId: null, status: 'venteliste',
      });
    });
    await moveSignup(admin(), SEED_CONFIG, 'vent1', 'd1-lynlodd-1700');
    expect(await count('d1-lynlodd-1700')).toBe(1);
    const s = (await signupsOf()).find((x: any) => x.id === 'vent1');
    expect(s.status).toBe('aktiv');
  });
});
