// Gevinstoversikt for PC: filtrer, kryss av mange rader og endre status, bok eller tekst samlet.
import { useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, type User } from 'firebase/auth';
import { collection, doc, getDocs, orderBy, query, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../auth';
import { BOOKS, parseWhole, PRIZE_STATUSES, sponsorKey, type Prize, type PrizeStatus } from '../lib/prizes';
import { STATUS_BG } from '../lib/statusColors';

const NONE = '__ingen';

export default function PrizeDesk() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [prizes, setPrizes] = useState<Prize[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [fStatus, setFStatus] = useState<string>('');
  const [fBook, setFBook] = useState<string>('');
  const [q, setQ] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkBook, setBulkBook] = useState('');
  const [fix, setFix] = useState({ sponsor: '', gift: '', value: '' });
  const [msg, setMsg] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  async function load() {
    try {
      const snap = await getDocs(query(collection(db, 'prizes'), orderBy('createdAt')));
      setPrizes(snap.docs.map((d) => ({ ...(d.data() as Omit<Prize, 'id'>), book: (d.data().book as string) ?? '', id: d.id })));
      setDenied(false);
    } catch { setDenied(true); }
  }
  useEffect(() => { if (user) load(); }, [user]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (prizes ?? [])
      .filter((p) => !fStatus || p.status === fStatus)
      .filter((p) => !fBook || (fBook === NONE ? !p.book && p.status !== 'avvist' : p.book === fBook))
      .filter((p) => !t || p.sponsor.toLowerCase().includes(t) || p.gift.toLowerCase().includes(t))
      .sort((a, b) => a.sponsor.localeCompare(b.sponsor, 'nb') || a.gift.localeCompare(b.gift, 'nb'));
  }, [prizes, fStatus, fBook, q]);

  const summary = useMemo(() => {
    const active = (prizes ?? []).filter((p) => p.status !== 'avvist');
    return {
      books: BOOKS.map((b) => {
        const list = active.filter((p) => p.book === b);
        return { book: b, count: list.length, value: list.reduce((n, p) => n + p.value, 0), unknown: list.filter((p) => !p.value).length };
      }),
      unassigned: active.filter((p) => !p.book).length,
    };
  }, [prizes]);

  async function writeAll(ids: string[], patch: (p: Prize) => Record<string, unknown>, label: string) {
    const byId = new Map((prizes ?? []).map((p) => [p.id, p]));
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach((id) => batch.update(doc(db, 'prizes', id), patch(byId.get(id)!)));
      await batch.commit();
    }
    setMsg(`${label}: ${ids.length} gevinst${ids.length === 1 ? '' : 'er'}.`);
    await load();
  }

  async function applyFix() {
    const ids = [...sel];
    const patch: Record<string, unknown> = {};
    if (fix.sponsor.trim()) {
      if (sponsorKey(fix.sponsor).length < 3) return setMsg('Sponsornavnet er for kort.');
      patch.sponsor = fix.sponsor.trim();
      patch.sponsorKey = sponsorKey(fix.sponsor);
    }
    if (fix.gift.trim()) patch.gift = fix.gift.trim();
    if (fix.value.trim()) {
      const v = parseWhole(fix.value, 0);
      if (v === null) return setMsg('Verdi må være hele kroner (0 = ikke bekreftet).');
      patch.value = v;
    }
    if (!Object.keys(patch).length) return setMsg('Fyll inn minst ett felt.');
    await writeAll(ids, () => patch, 'Rettet');
    if (patch.sponsorKey) await setDoc(doc(db, 'sponsorIndex', patch.sponsorKey as string), { prize: ids[0] });
    setFix({ sponsor: '', gift: '', value: '' });
  }

  if (user === undefined) return <p className="muted">Laster …</p>;
  if (!user) return <section><h1>Gevinster</h1><button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>Logg inn med Google</button></section>;
  if (denied) return <p className="error">Denne kontoen har ikke admin-tilgang.</p>;
  if (!prizes) return <p className="muted">Laster …</p>;

  const allShown = shown.length > 0 && shown.every((p) => sel.has(p.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <section className="desk">
      <p><a href="#/admin">← Tilbake til admin</a></p>
      <h1>Gevinster og basarbøker</h1>

      <table className="table books">
        <thead><tr><th>Bok</th><th>Gevinster</th><th>Verdi (kjent)</th><th>Uten verdi</th></tr></thead>
        <tbody>
          {summary.books.map((b) => (
            <tr key={b.book}><td><button className="link" onClick={() => setFBook(b.book)}>{b.book}</button></td><td>{b.count}</td><td>{b.value.toLocaleString('nb-NO')} kr</td><td>{b.unknown || ''}</td></tr>
          ))}
          <tr><td><button className="link" onClick={() => setFBook(NONE)}>Ikke fordelt</button></td><td>{summary.unassigned}</td><td></td><td></td></tr>
        </tbody>
      </table>

      <div className="filters">
        <label>Status
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Alle</option>
            {PRIZE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>Bok
          <select value={fBook} onChange={(e) => setFBook(e.target.value)}>
            <option value="">Alle</option>
            <option value={NONE}>Ikke fordelt</option>
            {BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>Søk<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sponsor eller gevinst" /></label>
      </div>

      <div className="bulk">
        <strong>{sel.size} valgt</strong>
        <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} aria-label="Ny status">
          <option value="">Sett status …</option>
          {PRIZE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button disabled={!sel.size || !bulkStatus} onClick={() => writeAll([...sel], () => ({ status: bulkStatus as PrizeStatus }), 'Status satt')}>Bruk</button>
        <select value={bulkBook} onChange={(e) => setBulkBook(e.target.value)} aria-label="Ny bok">
          <option value="">Legg i bok …</option>
          <option value={NONE}>Fjern fra bok</option>
          {BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button disabled={!sel.size || !bulkBook} onClick={() => writeAll([...sel], () => ({ book: bulkBook === NONE ? '' : bulkBook }), 'Bok satt')}>Bruk</button>
        <button className="secondary" disabled={!sel.size} onClick={() => setSel(new Set())}>Fjern valg</button>
      </div>
      <details className="bulk">
        <summary>Rett valgte (tomme felt endres ikke)</summary>
        <input value={fix.sponsor} onChange={(e) => setFix({ ...fix, sponsor: e.target.value })} placeholder="Sponsornavn" />
        <input value={fix.gift} onChange={(e) => setFix({ ...fix, gift: e.target.value })} placeholder="Gevinst" />
        <input value={fix.value} onChange={(e) => setFix({ ...fix, value: e.target.value })} placeholder="Verdi/stk" inputMode="numeric" />
        <button disabled={!sel.size} onClick={applyFix}>Rett {sel.size}</button>
      </details>
      {msg && <p className="notice small" role="status">{msg}</p>}

      <table className="table desk-table">
        <thead>
          <tr>
            <th><input type="checkbox" checked={allShown} aria-label="Velg alle viste"
              onChange={() => setSel((s) => { const n = new Set(s); shown.forEach((p) => (allShown ? n.delete(p.id) : n.add(p.id))); return n; })} /></th>
            <th>Sponsor</th><th>Gevinst</th><th>Verdi/stk</th><th>Status</th><th>Bok</th><th>Kontakt</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.id} className={sel.has(p.id) ? 'selected' : ''}>
              <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Velg ${p.sponsor} ${p.gift}`} /></td>
              <td>{p.sponsor}</td>
              <td>{p.gift}</td>
              <td>{p.value ? `${p.value.toLocaleString('nb-NO')} kr` : 'ikke oppgitt'}</td>
              <td style={{ background: STATUS_BG[p.status] ?? 'transparent', color: '#14212b' }}>
                <select value={p.status} onChange={(e) => writeAll([p.id], () => ({ status: e.target.value }), 'Status satt')} aria-label="Status">
                  {PRIZE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>
                <select value={p.book || ''} onChange={(e) => writeAll([p.id], () => ({ book: e.target.value }), 'Bok satt')} aria-label="Bok">
                  <option value="">—</option>
                  {BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </td>
              <td className="muted small">{p.contact} · {p.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Viser {shown.length} av {prizes.length}.</p>
    </section>
  );
}
