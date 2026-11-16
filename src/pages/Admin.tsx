import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { SEED_CONFIG } from '../config/seed';
import type { AppConfig } from '../lib/types';

type Row = { id: string; label: string; count: number; max: number };

export default function Admin() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState('');
  const [denied, setDenied] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function load() {
    setDenied(false);
    try {
      const cfgSnap = await getDoc(doc(db, 'config', 'main'));
      const cfg = (cfgSnap.exists() ? cfgSnap.data() : null) as AppConfig | null;
      await getDocs(collection(db, 'signups')); // feiler hvis ikke admin
      const counts = await getDocs(collection(db, 'shiftCounts'));
      const byId = new Map(counts.docs.map((d) => [d.id, d.data() as { count: number; max: number }]));
      setRows(
        (cfg?.shifts ?? []).map((s) => ({
          id: s.id,
          label: `${cfg!.days.find((d) => d.id === s.day)?.name} · ${s.station} ${s.start}–${s.end}`,
          count: byId.get(s.id)?.count ?? 0,
          max: byId.get(s.id)?.max ?? 0,
        })),
      );
    } catch {
      setDenied(true);
    }
  }

  useEffect(() => { if (user) load(); }, [user]);

  // Oppretter oppsett og tellere som MANGLER. Overskriver aldri eksisterende tellinger.
  async function seed() {
    setMsg('');
    const cfgRef = doc(db, 'config', 'main');
    if (!(await getDoc(cfgRef)).exists()) await setDoc(cfgRef, SEED_CONFIG);
    let created = 0;
    for (const s of SEED_CONFIG.shifts) {
      const ref = doc(db, 'shiftCounts', s.id);
      if (!(await getDoc(ref)).exists()) {
        await setDoc(ref, { count: 0, max: s.base + s.extra, lastSignup: '' });
        created++;
      }
    }
    setMsg(`Ferdig. ${created} nye tellere opprettet. Eksisterende påmeldinger er urørt.`);
    load();
  }

  if (user === undefined) return <p className="muted">Laster …</p>;
  if (!user)
    return (
      <section>
        <h1>Admin</h1>
        <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>Logg inn med Google</button>
      </section>
    );

  return (
    <section>
      <h1>Admin</h1>
      <p className="muted small">
        Innlogget som {user.email} · <button className="link" onClick={() => signOut(auth)}>Logg ut</button>
      </p>
      {denied && <p className="error">Denne kontoen har ikke admin-tilgang.</p>}
      {!denied && (
        <>
          <button onClick={seed}>Opprett manglende oppsett og tellere</button>
          {msg && <p className="notice">{msg}</p>}
          {rows && (
            <table className="table">
              <thead><tr><th>Skift</th><th>Påmeldt</th><th>Maks</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.count >= r.max ? 'full' : ''}>
                    <td>{r.label}</td><td>{r.count}</td><td>{r.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
