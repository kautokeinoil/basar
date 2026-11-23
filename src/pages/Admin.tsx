import { useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../auth';
import { SEED_CONFIG } from '../config/seed';
import { normalizePhone, type Country } from '../lib/phone';
import PhoneInput from '../lib/PhoneInput';
import { addManual, cancelSignup, moveSignup, setAttended, setPublicName, waitlistFor, type SignupRow } from '../lib/adminOps';
import { newToken, stationKey, stationsOf } from '../lib/station';
import { type Prize } from '../lib/prizes';
import { cakeLimitsOf, cakeTypesOf, deleteCake } from '../lib/cakes';
import { resetTestData } from '../lib/reset';
import type { AppConfig, Shift } from '../lib/types';
import { Loading } from '../lib/Loading';

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
    const cfgSnap = await getDoc(cfgRef);
    if (!cfgSnap.exists()) await setDoc(cfgRef, SEED_CONFIG);
    else {
      // Ny kakeliste (høyere cakeVersion) erstatter den gamle. Gjøres før lansering, før ekte kaker finnes.
      const cur = cfgSnap.data() as AppConfig;
      const patch: Record<string, unknown> = {};
      if ((cur.cakeVersion ?? 1) < (SEED_CONFIG.cakeVersion ?? 1)) {
        Object.assign(patch, {
          cakeVersion: SEED_CONFIG.cakeVersion, cakeTypes: SEED_CONFIG.cakeTypes, cakeLimits: SEED_CONFIG.cakeLimits,
          cakeBaseTotal: SEED_CONFIG.cakeBaseTotal, cakeNoExtra: SEED_CONFIG.cakeNoExtra, cakeNeedsText: SEED_CONFIG.cakeNeedsText,
        });
      }
      if (Object.keys(patch).length) await updateDoc(cfgRef, patch);
    }
    let created = 0;
    for (const s of SEED_CONFIG.shifts) {
      const ref = doc(db, 'shiftCounts', s.id);
      if (!(await getDoc(ref)).exists()) { await setDoc(ref, { count: 0, max: s.base + s.extra, lastSignup: '' }); created++; }
    }
    // Gamle påmeldinger uten stasjonsfelt får det (trengs for stasjonslenkene)
    const all = await getDocs(collection(db, 'signups'));
    for (const d of all.docs) {
      const data = d.data();
      if (data.stationKey === undefined) {
        const sh = SEED_CONFIG.shifts.find((x) => x.id === data.shiftId);
        await updateDoc(d.ref, { stationKey: sh && data.status === 'aktiv' ? stationKey(sh.station) : '' });
      }
    }
    return created;
  }

  if (user === undefined) return <Loading />;
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
            onAdd={(p, shiftId, now, pub) => run('Lagt til.', () => addManual(db, config, p, shiftId, now, pub))} />
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
            onAttended={(id, v) => run(v ? 'Registrert som møtt.' : 'Oppmøte fjernet.', () => setAttended(db, id, v))}
            onPublic={(id, v) => run(v ? 'Vises nå på den offentlige vaktlisten.' : 'Fjernet fra den offentlige vaktlisten.', () => setPublicName(db, id, v))} />
          <Prizes />
          <Cakes config={config} />
          <Links config={config} />
          <Overview config={config} counts={counts} signups={signups} />
          <details className="small">
            <summary>Vedlikehold</summary>
            <p className="muted">Oppretter bare det som mangler (tellere, stasjonsfelt). Nullstiller aldri påmeldinger.</p>
            <button onClick={() => run('Ferdig.', seed)}>Opprett manglende tellere og felt</button>
            <ResetPanel launched={!!(config as AppConfig & { launched?: boolean }).launched} onDone={(m) => run(m, async () => {})} />
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
  onAdd: (p: { name: string; phone: string }, shiftId: string, now: boolean, pub: boolean) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>('NO');
  const [shiftId, setShiftId] = useState('');
  const [now, setNow] = useState(false);
  const [pub, setPub] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    const p = normalizePhone(phone, country);
    if (name.trim().length < 2) return setErr('Skriv inn navn.');
    if (!p) return setErr('Sjekk telefonnummeret. Uten telefon gis ikke lodd.');
    if (!shiftId) return setErr('Velg skift.');
    setErr('');
    await onAdd({ name: name.trim(), phone: p }, shiftId, now, pub);
    setName(''); setPhone(''); setShiftId(''); setNow(false); setPub(false);
  }
  return (
    <details className="panel" open>
      <summary>Legg til person</summary>
      <div className="form">
        <label>Navn<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <PhoneInput value={phone} country={country} onChange={setPhone} onCountry={setCountry} />
        <label>Skift<ShiftSelect config={config} counts={counts} value={shiftId} onChange={setShiftId} /></label>
        <CapacityWarning counts={counts} shiftId={shiftId} config={config} />
        <label className="choice"><input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} /><span>Møtt nå (gir lodd med en gang)</span></label>
        <label className="choice"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /><span>Personen samtykker til å stå med navn på den offentlige vaktlisten</span></label>
        {err && <p className="error">{err}</p>}
        <button onClick={submit}>Legg til</button>
      </div>
    </details>
  );
}

function FindPerson({ config, counts, signups, onMove, onCancel, onAttended, onPublic }: {
  config: AppConfig; counts: Counts; signups: SignupRow[];
  onMove: (id: string, shiftId: string) => void; onCancel: (id: string) => void; onAttended: (id: string, v: boolean) => void;
  onPublic: (id: string, v: boolean) => void;
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
              {s.status === 'aktiv' && (
                <label className="choice"><input type="checkbox" checked={!!s.publicName} onChange={(e) => onPublic(s.id, e.target.checked)} /><span>Vis navn på offentlig vaktliste</span></label>
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

interface AccessDoc { token: string; kind: string; stationKey: string; station: string }

function Links({ config }: { config: AppConfig }) {
  const [links, setLinks] = useState<AccessDoc[] | null>(null);
  const [copied, setCopied] = useState('');
  const base = `${window.location.origin}${window.location.pathname}#/`;
  const targets = [
    ...stationsOf(config).map((s) => ({ kind: 'stasjon', key: s.key, name: s.name })),
    { kind: 'kake', key: 'kake', name: 'Kakemottak' },
  ];

  async function load() {
    const snap = await getDocs(collection(db, 'access'));
    setLinks(snap.docs.map((d) => ({ token: d.id, ...(d.data() as Omit<AccessDoc, 'token'>) })));
  }
  useEffect(() => { load(); }, []);

  // Sperrer eventuell gammel lenke og lager en ny for stasjonen
  async function renew(kind: string, key: string, name: string) {
    for (const l of (links ?? []).filter((x) => x.kind === kind && x.stationKey === key)) {
      await deleteDoc(doc(db, 'access', l.token));
    }
    await setDoc(doc(db, 'access', newToken()), { kind, stationKey: key, station: name, createdAt: serverTimestamp() });
    await load();
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(url); } catch { setCopied(''); }
  }

  return (
    <details className="panel">
      <summary>Lenker for stasjoner og kakemottak</summary>
      <p className="muted small">Send lenken til den som har ansvaret. Stasjonslenken viser navn og telefon for stasjonen og lar dem krysse av oppmøte. Kakemottaket krysser av levert. «Sperr og lag ny» gjør den gamle lenken ubrukelig med en gang.</p>
      {links === null ? <Loading /> : targets.map((st) => {
        const l = links.find((x) => x.kind === st.kind && x.stationKey === st.key);
        const url = l ? `${base}${st.kind}/${l.token}` : '';
        return (
          <div key={st.kind + st.key} className="linkrow">
            <strong>{st.name}</strong>
            {l ? (
              <>
                <code>{url}</code>
                <div className="row">
                  <button onClick={() => copy(url)}>{copied === url ? 'Kopiert' : 'Kopier lenke'}</button>
                  <button className="secondary" onClick={() => renew(st.kind, st.key, st.name)}>Sperr og lag ny</button>
                </div>
              </>
            ) : (
              <button onClick={() => renew(st.kind, st.key, st.name)}>Lag lenke</button>
            )}
          </div>
        );
      })}
    </details>
  );
}

function Prizes() {
  const [prizes, setPrizes] = useState<Prize[] | null>(null);
  useEffect(() => {
    getDocs(collection(db, 'prizes')).then((snap) => setPrizes(snap.docs.map((d) => ({ ...(d.data() as Omit<Prize, 'id'>), book: (d.data().book as string) ?? '', id: d.id }))));
  }, []);
  const count = (s: string) => (prizes ?? []).filter((p) => p.status === s).length;
  const unassigned = (prizes ?? []).filter((p) => p.status !== 'avvist' && !p.book).length;
  return (
    <div className="panel">
      <strong>Gevinster</strong>
      <p className="muted small">
        {prizes === null ? 'Laster …' : `${prizes.length} totalt · ${count('registrert')} registrert · ${count('bekreftet')} bekreftet · ${count('mottatt')} mottatt · ${count('avvist')} avvist · ${unassigned} ikke fordelt på bok`}
      </p>
      <a href="#/admin/gevinster">Åpne gevinstoversikten (best på PC)</a>
    </div>
  );
}

interface CakeRow { id: string; name: string; phone: string; type: string; variant: string; deliveryDay: string; slot?: string; daySlot?: string; delivered: boolean; glutenFree: boolean }

function Cakes({ config }: { config: AppConfig }) {
  const [cakes, setCakes] = useState<CakeRow[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = () => getDocs(collection(db, 'cakes')).then((s) => setCakes(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CakeRow, 'id'>) }))));
  useEffect(() => { load(); }, []);
  const types = cakeTypesOf(config);
  const limits = cakeLimitsOf(config);
  const days = config.days.filter((d) => d.id !== 'opprigg');

  return (
    <details className="panel">
      <summary>Kaker · {cakes?.length ?? '…'} registrert</summary>
      <table className="table">
        <thead><tr><th>Type</th>{days.map((d) => <th key={d.id}>{d.name}</th>)}</tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              {days.map((d) => {
                const n = (cakes ?? []).filter((c) => c.type === t.id && c.deliveryDay === d.id).length;
                const max = limits[t.id];
                return <td key={d.id} className={max && n >= max ? 'full' : ''}>{max ? `${n}/${max}` : n}</td>;
              })}
            </tr>
          ))}
          <tr>
            <td><strong>Kaker totalt (uten vaffelrøre)</strong></td>
            {days.map((d) => {
              const n = (cakes ?? []).filter((c) => c.deliveryDay === d.id && c.daySlot).length;
              const total = config.cakeBaseTotal ?? 0;
              return <td key={d.id} className={n >= total ? 'full' : ''}><strong>{n}/{total}</strong></td>;
            })}
          </tr>
          <tr>
            <td>Ekstra (etter at alle {config.cakeBaseTotal ?? 0} er tatt)</td>
            {days.map((d) => <td key={d.id}>{(cakes ?? []).filter((c) => c.deliveryDay === d.id && c.slot?.startsWith('ekstra_')).length}{config.cakeExtraPerDay ? `/${config.cakeExtraPerDay}` : ''}</td>)}
          </tr>
        </tbody>
      </table>
      <p className="muted small">Sletting frigjør plassen, så noen andre kan melde seg på. Raden i arket blir stående til du sletter den der.</p>
      <ul className="plain">
        {(cakes ?? []).sort((a, b) => a.deliveryDay.localeCompare(b.deliveryDay) || a.name.localeCompare(b.name, 'nb')).map((c) => (
          <li key={c.id}>
            {config.days.find((d) => d.id === c.deliveryDay)?.name}: {types.find((t) => t.id === c.type)?.name ?? c.type}
            {c.variant ? ` (${c.variant})` : ''}{c.glutenFree ? ' · glutenfri' : ''} – {c.name}{' '}
            {confirm === c.id ? (
              <button className="link" onClick={async () => { await deleteCake(db, c); setConfirm(null); load(); }}>Bekreft sletting</button>
            ) : (
              <button className="link" onClick={() => setConfirm(c.id)}>Slett</button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ResetPanel({ launched, onDone }: { launched: boolean; onDone: (msg: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function reset() {
    setBusy(true); setErr('');
    try {
      const r = await resetTestData(db);
      setText('');
      onDone(`Nullstilt: ${r.signups} påmeldinger, ${r.cakes} kaker, ${r.prizes} gevinster slettet. ${r.shiftCounts} tellere satt til 0. ` +
        'Husk å slette radene (fra rad 2) i fanene Vakter, Kaker og Gevinster i arket.');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function setLaunched(v: boolean) {
    await updateDoc(doc(db, 'config', 'main'), { launched: v });
    onDone(v ? 'Markert som lansert. Nullstilling er nå sperret.' : 'Lansert-merket er fjernet.');
  }

  return (
    <div className="danger">
      <h3>Før lansering: slett testdata</h3>
      {launched ? (
        <>
          <p className="small">Basaren er markert som lansert, og nullstilling er sperret, slik at ekte påmeldinger ikke kan slettes ved et uhell.</p>
          <button className="link" onClick={() => setLaunched(false)}>Fjern lansert-merket</button>
        </>
      ) : (
        <>
          <p className="small">
            Sletter alle påmeldinger, kaker, gevinster og sponsorsøk, og setter alle tellere til 0.
            Oppsettet og stasjonslenkene beholdes. <strong>Kan ikke angres.</strong>
          </p>
          <label>Skriv NULLSTILL for å bekrefte<input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" /></label>
          {err && <p className="error">{err}</p>}
          <button className="danger-btn" disabled={text !== 'NULLSTILL' || busy} onClick={reset}>{busy ? 'Sletter …' : 'Slett all testdata'}</button>
          <p className="small">Når lenken er delt: <button className="link" onClick={() => setLaunched(true)}>Marker som lansert</button> (sperrer nullstilling).</p>
        </>
      )}
    </div>
  );
}
