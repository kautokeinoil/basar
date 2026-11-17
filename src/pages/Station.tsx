import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../auth';
import { displayPhone } from '../lib/phone';
import { useConfig, formatDate } from '../lib/useConfig';

interface Row { id: string; name: string; phone: string; day: string; shiftId: string; attended: boolean }

export default function Station({ token }: { token: string }) {
  const cfg = useConfig();
  const [state, setState] = useState<'loading' | 'invalid' | 'ok' | 'error'>('loading');
  const [station, setStation] = useState<{ name: string; key: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const off = onAuthStateChanged(auth, async (u) => {
      if (!u) { signInAnonymously(auth).catch(() => setState('error')); return; }
      try {
        const a = await getDoc(doc(db, 'access', token));
        if (!a.exists() || a.data().kind !== 'stasjon') { setState('invalid'); return; }
        await setDoc(doc(db, 'sessions', u.uid), { token });
        setStation({ name: a.data().station, key: a.data().stationKey });
        const s = await getDocs(query(collection(db, 'signups'),
          where('stationKey', '==', a.data().stationKey), where('status', '==', 'aktiv')));
        setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Row, 'id'>) })));
        setState('ok');
      } catch (e) {
        console.error(e);
        setState('error');
      }
    });
    return off;
  }, [token]);

  const config = cfg.status === 'ok' ? cfg.config : null;
  const groups = useMemo(() => {
    if (!config) return [];
    return config.days.map((d) => ({
      day: d,
      shifts: config.shifts
        .filter((s) => s.day === d.id && rows.some((r) => r.shiftId === s.id))
        .map((s) => ({ shift: s, people: rows.filter((r) => r.shiftId === s.id).sort((a, b) => a.name.localeCompare(b.name, 'nb')) })),
    })).filter((g) => g.shifts.length > 0);
  }, [config, rows]);

  async function toggle(r: Row) {
    setBusy(r.id);
    try {
      await updateDoc(doc(db, 'signups', r.id), { attended: !r.attended });
      setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, attended: !x.attended } : x)));
    } catch {
      alert('Kunne ikke lagre. Sjekk nettet og prøv igjen.');
    } finally {
      setBusy(null);
    }
  }

  if (state === 'loading' || !config) return <p className="muted">Laster …</p>;
  if (state === 'invalid') return <p className="notice">Lenken er ugyldig eller sperret. Kontakt basaransvarlig for ny lenke.</p>;
  if (state === 'error') return <p className="error">Noe gikk galt. Last inn siden på nytt.</p>;

  const total = rows.length, met = rows.filter((r) => r.attended).length;
  return (
    <section className="station">
      <h1>{station?.name}</h1>
      <p className="muted">Kryss av den som har møtt. {met} av {total} registrert som møtt. Avkryssing gir lodd i trekningen.</p>
      {groups.length === 0 && <p className="muted">Ingen påmeldte på denne stasjonen ennå.</p>}
      {groups.map((g) => (
        <div key={g.day.id}>
          <h2>{g.day.name} <span className="muted small">{formatDate(g.day.date)}</span></h2>
          {g.shifts.map(({ shift, people }) => (
            <div key={shift.id} className="panel">
              <strong>{shift.day === 'opprigg' ? `Fra ${shift.start}` : `${shift.start}–${shift.end}`}</strong>
              <ul className="people">
                {people.map((p) => (
                  <li key={p.id}>
                    <label className="choice">
                      <input type="checkbox" checked={p.attended} disabled={busy === p.id} onChange={() => toggle(p)} />
                      <span><strong>{p.name}</strong><a href={`tel:${p.phone}`}>{displayPhone(p.phone)}</a></span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
