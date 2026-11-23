import { useState, type FormEvent } from 'react';
import { db } from '../firebase';
import { useConfig } from '../lib/useConfig';
import { normalizePhone, type Country } from '../lib/phone';
import PhoneInput from '../lib/PhoneInput';
import { emptyPrize, MAX_PER_LINE, parseWhole, registerPrizes, sponsorExists, sponsorKey, type PrizeLine } from '../lib/prizes';
import { Loading } from '../lib/Loading';

function SponsorSearch() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<'yes' | 'no' | 'short' | 'error' | null>(null);
  const [busy, setBusy] = useState(false);
  async function search(e: FormEvent) {
    e.preventDefault();
    if (sponsorKey(q).length < 3) return setResult('short');
    setBusy(true);
    try { setResult((await sponsorExists(db, q)) ? 'yes' : 'no'); } catch { setResult('error'); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={search} className="panel form">
      <strong>Har bedriften allerede gitt?</strong>
      <p className="muted small">Søk på navnet (minst 3 tegn), så slipper dere å spørre samme bedrift to ganger. Søket viser bare ja eller nei.</p>
      <div className="row">
        <input value={q} onChange={(e) => { setQ(e.target.value); setResult(null); }} placeholder="F.eks. Rema" aria-label="Sponsornavn" />
        <button type="submit" disabled={busy} style={{ width: 'auto' }}>Søk</button>
      </div>
      {result === 'yes' && <p className="notice" role="status">Registrert som sponsor.</p>}
      {result === 'no' && <p role="status">Ikke funnet.</p>}
      {result === 'short' && <p className="error">Skriv minst 3 bokstaver.</p>}
      {result === 'error' && <p className="error">Søket feilet. Prøv igjen.</p>}
    </form>
  );
}

export default function PrizeForm() {
  const cfg = useConfig();
  const [sponsor, setSponsor] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>('NO');
  const [lines, setLines] = useState<PrizeLine[]>([emptyPrize()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const update = (i: number, patch: Partial<PrizeLine>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (sponsorKey(sponsor).length < 3) return setError('Skriv navnet på sponsoren (bedrift eller privatperson).');
    if (contact.trim().length < 2) return setError('Skriv inn kontaktperson.');
    const p = normalizePhone(phone, country);
    if (!p) return setError('Sjekk telefonnummeret. Velg riktig land, eller skriv nummeret med landskode.');
    const parsed = [];
    for (const [i, l] of lines.entries()) {
      const qty = parseWhole(l.qty, 1), value = parseWhole(l.value, 0);
      if (l.gift.trim().length < 2) return setError(`Beskriv gevinst ${i + 1}.`);
      if (qty === null || qty > MAX_PER_LINE) return setError(`Antall for gevinst ${i + 1} må være et helt tall fra 1 til ${MAX_PER_LINE}.`);
      if (value === null) return setError(`Verdi for gevinst ${i + 1} må være et tall i hele kroner. Skriv 0 hvis verdien ikke er kjent.`);
      parsed.push({ gift: l.gift, qty, value });
    }
    if (parsed.reduce((n, l) => n + l.qty, 0) > 400) return setError('Maks 400 gevinster per innsending. Del opp i flere innsendinger.');
    setBusy(true);
    try {
      await registerPrizes(db, { name: sponsor, contact, phone: p }, parsed);
      setDone(true);
    } catch (err) {
      console.error(err);
      setError('Noe gikk galt. Prøv igjen, eller kontakt oss.');
    } finally { setBusy(false); }
  }

  if (cfg.status === 'loading') return <Loading />;
  const contactLine = cfg.status === 'ok' ? `${cfg.config.contact.email} eller tlf. ${cfg.config.contact.phone}` : '';

  if (done)
    return (
      <section>
        <h1>Tusen takk!</h1>
        <p>Gevinsten er registrert. Vi tar kontakt for å bekrefte og avtale levering.</p>
        {contactLine && <p className="muted small">Spørsmål? {contactLine}</p>}
        <p><a href="#/">Tilbake til forsiden</a></p>
      </section>
    );

  return (
    <section className="form">
      <h1>Gevinster og sponsing</h1>
      <SponsorSearch />
      <form onSubmit={submit} className="form" noValidate>
        <h2>Registrer gevinst</h2>
        <label>Sponsor <span className="muted">(bedrift eller privatperson)</span>
          <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} maxLength={100} />
        </label>
        <label>Kontaktperson<input value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="name" maxLength={80} /></label>
        <PhoneInput value={phone} country={country} onChange={setPhone} onCountry={setCountry} />

        {lines.map((l, i) => (
          <fieldset key={i} className="panel">
            <legend>Gevinst {i + 1}</legend>
            <label>Hva er gevinsten?
              <input value={l.gift} onChange={(e) => update(i, { gift: e.target.value })} placeholder="F.eks. Gavekort Rema 1000, Bensindunk 20 L" maxLength={120} />
            </label>
            <div className="row">
              <label>Antall<input value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} inputMode="numeric" /></label>
              <label>Verdi per stk (kr)<input value={l.value} onChange={(e) => update(i, { value: e.target.value })} inputMode="numeric" /></label>
            </div>
            <small className="muted">Sett 0 hvis verdien ikke er bekreftet. Hvert stykk registreres som egen gevinst, så de kan fordeles på ulike basarbøker.</small>
            {lines.length > 1 && (
              <button type="button" className="link" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>Fjern denne gevinsten</button>
            )}
          </fieldset>
        ))}
        <button type="button" className="secondary" onClick={() => setLines((cur) => [...cur, emptyPrize()])}>+ Legg til gevinst</button>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Sender …' : 'Registrer'}</button>
      </form>
    </section>
  );
}
