import { useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { SEED_CONFIG } from '../config/seed';
import { normalizePhone } from '../lib/phone';
import { addManual, cancelSignup, moveSignup, setAttended, waitlistFor, type SignupRow } from '../lib/adminOps';
import type { AppConfig, Shift } from '../lib/types';

type Counts = Record<string, { count: number; max: number }>;

export default function Admin() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState('');
  const [freed, setFreed] = useState<Shift | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function load() {
    setDenied(false);
    try {
      const cfgSnap = await getDoc(doc(db, 'config', 'main'));
      setConfig(cfgSnap.exists() ? (cfgSnap.data() as AppConfig) : null);
      const s = await getDocs(query(collection(db, 'signups'), orderBy('createdAt')));
      setSignups(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SignupRow, 'id'>) })));
      const c = await getDocs(collection(db, 'shiftCounts'));
      setCounts(Object.fromEntries(c.docs.map((d) => [d.id, d.data() as { count: number; max: number }])));
    } catch {
      setDenied(true);
    }
  }
  useEffect(() => { if (user) load(); }, [user]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setMsg('');
    try { await fn(); setMsg(label); } catch (e) { setMsg(`Feil: ${(e as Error).message}`); }
    await load();
  }

  async function seed() {
    const cfgRef = doc(db, 'config', 'main');
    if (!(await getDoc(cfgRef)).exists()) await setDoc(cfgRef, SEED_CONFIG);
    let created = 0;
    for (const s of SEED_CONFIG.shifts) {
      const ref = doc(db, 'shiftCounts', s.id);
      if (!(await getDoc(ref)).exists()) { await setDoc(ref, { count: 0, max: s.base + s.extra, lastSignup: '' }); created++; }
    }
    return created;
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
    <section className="admin">
      <h1>Admin</h1>
      <p className="muted small">
        Innlogget som {user.email} · <button className="link" onClick={() => signOut(auth)}>Logg ut</button>
      </p>
      {denied && <p className="error">Denne kontoen har ikke admin-tilgang.</p>}
      {msg && <p className="notice" role="status">{msg}</p>}

      {!denied && !config && (
        <button onClick={() => run('Oppsett opprettet.', seed)}>Opprett oppsett og tellere</button>
      )}

      {!denied && config && (
        <>
          {freed && (
            <FreedSeat shift={freed} config={config} signups={signups}
              onMove={(id) => run('Flyttet fra venteliste.', async () => { await moveSignup(db, config, id, freed.id); setFreed(null); })}
              onClose={() => setFreed(null)} />
          )}
          <AddPerson config={config} counts={counts}
            onAdd={(p, shiftId, now) => run('Lagt til.', () => addManual(db, config, p, shiftId, now))} />
          <FindPerson config={config} counts={counts} signups={signups}
            onMove={(id, shiftId) => run('Vakten er flyttet.', async () => {
              const before = signups.find((s) => s.id === id);
              await moveSignup(db, config, id, shiftId);
              const old = before?.status === 'aktiv' ? config.shifts.find((s) => s.id === before.shiftId) : null;
              if (old && old.id !== shiftId) setFreed(old);
            })}
            onCancel={(id) => run('Meldt av.', async () => {
              const f = await cancelSignup(db, id);
              setFreed(f ? config.shifts.find((s) => s.id === f) ?? null : null);
            })}
            onAttended={(id, v) => run(v ? 'Registrert som møtt.' : 'Oppmøte fjernet.', () => setAttended(db, id, v))} />
          <Overview config={config} counts={counts} signups={signups} />
          <details className="small">
            <summary>Vedlikehold</summary>
            <p className="muted">Oppretter bare tellere som mangler. Nullstiller aldri eksisterende påmeldinger.</p>
            <button onClick={() => run('Ferdig.', seed)}>Opprett manglende tellere</button>
          </details>
        </>
      )}
    </section>
  );
}

function shiftLabel(config: AppConfig, s: Shift) {
  const day = config.days.find((d) => d.id === s.day)?.name ?? s.day;
  return s.day === 'opprigg' ? `${day} · fra ${s.start}` : `${day} · ${s.station} ${s.start}–${s.end}`;
}

function ShiftSelect({ config, counts, value, onChange }: { config: AppConfig; counts: Counts; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Velg skift …</option>
      {config.days.map((d) => (
        <optgroup key={d.id} label={d.name}>
          {config.shifts.filter((s) => s.day === d.id).map((s) => {
            const c = counts[s.id] ?? { count: 0, max: 0 };
            return (
              <option key={s.id} value={s.id}>
                {s.station} {s.start}–{s.end} ({c.count}/{c.max}{c.count >= c.max ? ' FULLT' : ''})
              </option>
            );
          })}
        </optgroup>
      ))}
    </select>
  );
}

function CapacityWarning({ counts, shiftId, config }: { counts: Counts; shiftId: string; config: AppConfig }) {
  const c = counts[shiftId];
  const s = config.shifts.find((x) => x.id === shiftId);
  if (!c || !s || c.count < c.max) return null;
  return <p className="notice small">{shiftLabel(config, s)} har allerede {c.count} av {c.max}. Du kan legge til likevel.</p>;
}

function AddPerson({ config, counts, onAdd }: {
  config: AppConfig; counts: Counts;
  onAdd: (p: { name: string; phone: string }, shiftId: string, now: boolean) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [now, setNow] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    const p = normalizePhone(phone);
    if (name.trim().length < 2) return setErr('Skriv inn navn.');
    if (!p) return setErr('Telefon må ha 8 siffer. Uten telefon gis ikke lodd.');
    if (!shiftId) return setErr('Velg skift.');
    setErr('');
    await onAdd({ name: name.trim(), phone: p }, shiftId, now);
    setName(''); setPhone(''); setShiftId(''); setNow(false);
  }
  return (
    <details className="panel" open>
      <summary>Legg til person</summary>
      <div className="form">
        <label>Navn<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Telefon<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
        <label>Skift<ShiftSelect config={config} counts={counts} value={shiftId} onChange={setShiftId} /></label>
        <CapacityWarning counts={counts} shiftId={shiftId} config={config} />
        <label className="choice"><input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} /><span>Møtt nå (gir lodd med en gang)</span></label>
        {err && <p className="error">{err}</p>}
        <button onClick={submit}>Legg til</button>
      </div>
    </details>
  );
}

function FindPerson({ config, counts, signups, onMove, onCancel, onAttended }: {
  config: AppConfig; counts: Counts; signups: SignupRow[];
  onMove: (id: string, shiftId: string) => void; onCancel: (id: string) => void; onAttended: (id: string, v: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<Record<string, string>>({});
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return signups.filter((s) => s.name.toLowerCase().includes(t) || s.phone.includes(t.replace(/\D/g, '') || '§'));
  }, [q, signups]);

  return (
    <details className="panel" open>
      <summary>Finn og endre vakt</summary>
      <label>Søk på navn eller telefon<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <ul className="cards">
        {hits.map((s) => {
          const shift = config.shifts.find((x) => x.id === s.shiftId);
          return (
            <li key={s.id} className={`card ${s.status !== 'aktiv' ? 'dim' : ''}`}>
              <strong>{s.name} · {s.phone}</strong>
              <span>
                {s.status === 'aktiv' && shift ? shiftLabel(config, shift) : `${config.days.find((d) => d.id === s.day)?.name}: ${s.status}`}
                {s.source === 'manuell' ? ' · lagt inn manuelt' : ''}
              </span>
              {s.status === 'aktiv' && (
                <label className="choice"><input type="checkbox" checked={s.attended} onChange={(e) => onAttended(s.id, e.target.checked)} /><span>Møtt</span></label>
              )}
              <ShiftSelect config={config} counts={counts} value={target[s.id] ?? ''} onChange={(v) => setTarget({ ...target, [s.id]: v })} />
              {target[s.id] && <CapacityWarning counts={counts} shiftId={target[s.id]} config={config} />}
              <div className="row">
                <button disabled={!target[s.id]} onClick={() => onMove(s.id, target[s.id])}>Flytt hit</button>
                {s.status !== 'avmeldt' && <button className="secondary" onClick={() => onCancel(s.id)}>Meld av</button>}
              </div>
            </li>
          );
        })}
      </ul>
      {q.trim().length >= 2 && hits.length === 0 && <p className="muted">Ingen treff.</p>}
    </details>
  );
}

function FreedSeat({ shift, config, signups, onMove, onClose }: {
  shift: Shift; config: AppConfig; signups: SignupRow[]; onMove: (id: string) => void; onClose: () => void;
}) {
  const list = waitlistFor(shift, signups);
  return (
    <div className="notice">
      <strong>Ledig plass: {shiftLabel(config, shift)}</strong>
      {list.length === 0 ? <p className="small">Ingen på ventelisten passer dette skiftet.</p> : (
        <ul className="plain">
          {list.map((s) => (
            <li key={s.id}>{s.name} · {s.phone} <button className="link" onClick={() => onMove(s.id)}>Flytt hit</button></li>
          ))}
        </ul>
      )}
      <button className="link" onClick={onClose}>Lukk</button>
    </div>
  );
}

function Overview({ config, counts, signups }: { config: AppConfig; counts: Counts; signups: SignupRow[] }) {
  const waiting = signups.filter((s) => s.status === 'venteliste');
  return (
    <details className="panel">
      <summary>Oversikt per skift · {waiting.length} på venteliste</summary>
      <table className="table">
        <thead><tr><th>Skift</th><th>Påmeldt</th><th>Maks</th></tr></thead>
        <tbody>
          {config.shifts.map((s) => {
            const c = counts[s.id] ?? { count: 0, max: 0 };
            return <tr key={s.id} className={c.count >= c.max ? 'full' : ''}><td>{shiftLabel(config, s)}</td><td>{c.count}</td><td>{c.max}</td></tr>;
          })}
        </tbody>
      </table>
    </details>
  );
}
