import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useConfig, formatDate } from '../lib/useConfig';
import { cakeTypesOf } from '../lib/cakes';

interface Cake {
  id: string; name: string; phone: string; type: string; variant: string;
  glutenFree: boolean; lactoseFree: boolean; allergens: string; deliveryDay: string; delivered: boolean;
}

export default function CakeDesk({ token }: { token: string }) {
  const cfg = useConfig();
  const [state, setState] = useState<'loading' | 'invalid' | 'ok' | 'error'>('loading');
  const [cakes, setCakes] = useState<Cake[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    if (!u) { signInAnonymously(auth).catch(() => setState('error')); return; }
    try {
      const a = await getDoc(doc(db, 'access', token));
      if (!a.exists() || a.data().kind !== 'kake') { setState('invalid'); return; }
      await setDoc(doc(db, 'sessions', u.uid), { token });
      const s = await getDocs(collection(db, 'cakes'));
      setCakes(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Cake, 'id'>) })));
      setState('ok');
    } catch (e) { console.error(e); setState('error'); }
  }), [token]);

  const config = cfg.status === 'ok' ? cfg.config : null;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return cakes
      .filter((c) => !t || c.name.toLowerCase().includes(t) || c.phone.includes(t))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  }, [cakes, q]);

  async function toggle(c: Cake) {
    setBusy(c.id); setSaveError('');
    try {
      await updateDoc(doc(db, 'cakes', c.id), { delivered: !c.delivered });
      setCakes((cur) => cur.map((x) => (x.id === c.id ? { ...x, delivered: !x.delivered } : x)));
    } catch { setSaveError('Kunne ikke lagre. Sjekk nettet og prøv igjen.'); }
    finally { setBusy(null); }
  }

  if (state === 'loading' || !config) return <p className="muted">Laster …</p>;
  if (state === 'invalid') return <p className="notice">Lenken er ugyldig eller sperret. Kontakt basaransvarlig for ny lenke.</p>;
  if (state === 'error') return <p className="error">Noe gikk galt. Last inn siden på nytt.</p>;

  const types = cakeTypesOf(config);
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  const days = config.days.filter((d) => d.id !== 'opprigg');

  return (
    <section className="station">
      <h1>Kakemottak</h1>
      <p className="muted">Kryss av når bakverket er levert. Det gir giveren ett lodd.</p>
      <div className="stats">
        {days.map((d) => {
          const list = cakes.filter((c) => c.deliveryDay === d.id);
          return (
            <div key={d.id} className="panel small">
              <strong>{d.name}</strong>: {list.filter((c) => c.delivered).length} av {list.length} levert
              <div className="muted">{types.map((t) => `${t.name} ${list.filter((c) => c.type === t.id).length}`).join(' · ')}</div>
            </div>
          );
        })}
      </div>
      <label>Søk på navn eller telefon<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {saveError && <p className="error" role="alert">{saveError}</p>}
      {days.map((d) => {
        const list = filtered.filter((c) => c.deliveryDay === d.id);
        if (list.length === 0) return null;
        return (
          <div key={d.id}>
            <h2>{d.name} <span className="muted small">{formatDate(d.date)}</span></h2>
            <ul className="people">
              {list.map((c) => (
                <li key={c.id}>
                  <label className="choice">
                    <input type="checkbox" checked={c.delivered} disabled={busy === c.id} onChange={() => toggle(c)} />
                    <span>
                      <strong>{typeName(c.type)}{c.variant ? `: ${c.variant}` : ''}</strong>
                      <span>{c.name} · <a href={`tel:${c.phone}`}>{c.phone}</a></span>
                      {(c.glutenFree || c.lactoseFree || c.allergens) && (
                        <small>
                          {[c.glutenFree && 'Glutenfri', c.lactoseFree && 'Laktosefri', c.allergens && `Inneholder: ${c.allergens}`].filter(Boolean).join(' · ')}
                        </small>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
