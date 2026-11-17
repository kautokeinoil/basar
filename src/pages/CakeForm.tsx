import { useState, type FormEvent } from 'react';
import { db } from '../firebase';
import { useConfig, formatDate } from '../lib/useConfig';
import { normalizePhone, type Country } from '../lib/phone';
import PhoneInput from '../lib/PhoneInput';
import { cakeTypesOf, emptyLine, registerCakes, type CakeLine } from '../lib/cakes';

export default function CakeForm() {
  const cfg = useConfig();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>('NO');
  const [lines, setLines] = useState<CakeLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<CakeLine[] | null>(null);

  if (cfg.status === 'loading') return <p className="muted">Laster …</p>;
  if (cfg.status !== 'ok') return <p className="notice">Registreringen er ikke åpnet ennå.</p>;
  const config = cfg.config;
  const types = cakeTypesOf(config);
  const basarDays = config.days.filter((d) => d.id !== 'opprigg');
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  const dayName = (id: string) => config.days.find((d) => d.id === id)?.name ?? id;

  const update = (i: number, patch: Partial<CakeLine>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const p = normalizePhone(phone, country);
    if (name.trim().length < 2) return setError('Skriv inn fullt navn.');
    if (!p) return setError('Sjekk telefonnummeret. Velg riktig land, eller skriv nummeret med landskode (+46 …).');
    const bad = lines.findIndex((l) => !l.type || !l.deliveryDay);
    if (bad >= 0) return setError(`Velg type og leveringsdag for bakverk ${bad + 1}.`);
    setBusy(true);
    try {
      await registerCakes(db, { name: name.trim(), phone: p }, lines);
      setDone(lines);
    } catch (err) {
      console.error(err);
      setError('Noe gikk galt. Prøv igjen, eller kontakt oss.');
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <section>
        <h1>Takk for bidraget!</h1>
        <ul className="cards">
          {done.map((l, i) => (
            <li key={i} className="card">
              <strong>{typeName(l.type)}{l.variant ? `: ${l.variant}` : ''}</strong>
              <span>Leveres {dayName(l.deliveryDay)}</span>
            </li>
          ))}
        </ul>
        <p className="muted">Hvert bakverk som blir registrert som levert, gir ett lodd i trekningen av frivilliggevinster.</p>
        <p className="muted small">Spørsmål? {config.contact.email} eller tlf. {config.contact.phone}</p>
        <p><a href="#/">Tilbake til forsiden</a></p>
      </section>
    );

  return (
    <form onSubmit={submit} className="form" noValidate>
      <h1>Lever kaker</h1>
      <p className="muted">Meld fra hva du kan bake. Du kan legge til flere bakverk. Hvert levert bakverk gir ett lodd i trekningen.</p>
      <label>Navn<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <PhoneInput value={phone} country={country} onChange={setPhone} onCountry={setCountry} />

      {lines.map((l, i) => (
        <fieldset key={i} className="panel">
          <legend>Bakverk {i + 1}</legend>
          <div className="chips">
            {types.map((t) => (
              <label key={t.id} className={`chip ${l.type === t.id ? 'on' : ''}`}>
                <input type="radio" name={`type-${i}`} checked={l.type === t.id} onChange={() => update(i, { type: t.id })} />
                {t.name} <small>{t.unit}</small>
              </label>
            ))}
          </div>
          <label>Hva slags? <span className="muted">(valgfritt)</span>
            <input value={l.variant} onChange={(e) => update(i, { variant: e.target.value })} placeholder="F.eks. sjokoladekake, kanelboller" maxLength={80} />
          </label>
          <div className="row">
            <label className="choice"><input type="checkbox" checked={l.glutenFree} onChange={(e) => update(i, { glutenFree: e.target.checked })} /><span>Glutenfri</span></label>
            <label className="choice"><input type="checkbox" checked={l.lactoseFree} onChange={(e) => update(i, { lactoseFree: e.target.checked })} /><span>Laktosefri</span></label>
          </div>
          <label>Andre allergener <span className="muted">(valgfritt)</span>
            <input value={l.allergens} onChange={(e) => update(i, { allergens: e.target.value })} placeholder="F.eks. nøtter, egg" maxLength={200} />
          </label>
          <label>Leveres
            <select value={l.deliveryDay} onChange={(e) => update(i, { deliveryDay: e.target.value as CakeLine['deliveryDay'] })}>
              <option value="">Velg dag …</option>
              {basarDays.map((d) => <option key={d.id} value={d.id}>{d.name}, {formatDate(d.date)}</option>)}
            </select>
          </label>
          {lines.length > 1 && (
            <button type="button" className="link" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>Fjern dette bakverket</button>
          )}
        </fieldset>
      ))}

      <button type="button" className="secondary" onClick={() => setLines((cur) => [...cur, { ...emptyLine(), deliveryDay: cur[cur.length - 1]?.deliveryDay ?? '' }])}>
        + Legg til bakverk
      </button>
      <p className="muted small">Navn og telefon brukes bare til å organisere basaren og trekningen, og slettes etterpå.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Sender …' : `Send (${lines.length} bakverk)`}</button>
    </form>
  );
}
