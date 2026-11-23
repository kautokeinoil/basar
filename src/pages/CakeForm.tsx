import { useEffect, useState, type FormEvent } from 'react';
import { db } from '../firebase';
import { useConfig, formatDate } from '../lib/useConfig';
import { normalizePhone, type Country } from '../lib/phone';
import PhoneInput from '../lib/PhoneInput';
import { baseFull, cakeAvailability, cakeLimitsOf, extraLeft, glutenShare, cakeTypesOf, emptyLine, FullError, registerCakes, slotKey, type Availability, type CakeLine } from '../lib/cakes';
import type { CakeTypeId } from '../lib/types';
import { Loading } from '../lib/Loading';

export default function CakeForm() {
  const cfg = useConfig();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>('NO');
  const [lines, setLines] = useState<CakeLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<CakeLine[] | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const reload = () => cakeAvailability(db).then(setAvail).catch(() => setAvail(null));
  useEffect(() => { reload(); }, []);

  if (cfg.status === 'loading') return <Loading />;
  if (cfg.status !== 'ok') return <p className="notice">Registreringen er ikke åpnet ennå.</p>;
  const config = cfg.config;
  const types = cakeTypesOf(config);
  const basarDays = config.days.filter((d) => d.id !== 'opprigg');
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  const dayName = (id: string) => config.days.find((d) => d.id === id)?.name ?? id;
  const limits = cakeLimitsOf(config);

  const noExtra = new Set(types.filter((t) => t.noExtra).map((t) => t.id));

  /** Ledige plasser for type/dag, minus det som allerede er valgt i andre linjer i dette skjemaet. */
  const left = (type: CakeTypeId, day: string, exceptLine: number) => {
    const max = limits[type];
    if (!max || !day) return Infinity;
    const used = avail?.used ?? {};
    const inForm = lines.filter((l, j) => j !== exceptLine && l.type === type && l.deliveryDay === day).length;
    const base = max - (used[slotKey(type, day)] ?? 0) - inForm;
    if (base > 0 || noExtra.has(type)) return base;
    // Typen er full: ekstraplasser åpner når alle kakeplassene for dagen er tatt
    const extrasInForm = lines.filter((l, j) => j !== exceptLine && l.deliveryDay === day && !noExtra.has(l.type)
      && (used[slotKey(l.type, day)] ?? 0) >= (limits[l.type] ?? 0)).length;
    return extraLeft(config, used, day) - extrasInForm;
  };
  const isExtra = (day: string) => !!avail && !!day && baseFull(config, avail.used, day);
  const [totalGf, totalUsed] = avail ? glutenShare(config, avail) : [0, 0];

  const update = (i: number, patch: Partial<CakeLine>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const p = normalizePhone(phone, country);
    if (name.trim().length < 2) return setError('Skriv inn fullt navn.');
    if (!p) return setError('Sjekk telefonnummeret. Velg riktig land, eller skriv nummeret med landskode (+46 …).');
    const bad = lines.findIndex((l) => !l.type || !l.deliveryDay);
    if (bad >= 0) return setError(`Velg leveringsdag og hva du baker, for bakverk ${bad + 1}.`);
    const noText = lines.findIndex((l) => types.find((t) => t.id === l.type)?.needsText && l.variant.trim().length < 2);
    if (noText >= 0) return setError(`Skriv hva slags kake bakverk ${noText + 1} er.`);
    const over = lines.findIndex((l, i) => left(l.type as CakeTypeId, l.deliveryDay, i) <= 0);
    if (over >= 0) return setError(`Vi har nok ${typeName(lines[over].type).toLowerCase()} til ${dayName(lines[over].deliveryDay)}. Velg en annen type eller dag for bakverk ${over + 1}.`);
    setBusy(true);
    try {
      await registerCakes(db, config, { name: name.trim(), phone: p }, lines);
      setDone(lines);
    } catch (err) {
      console.error(err);
      if (err instanceof FullError) {
        if (err.saved > 0) {
          setLines((cur) => cur.slice(err.saved));
          setError(`${err.saved} bakverk ble registrert. Så ble det fullt for ${typeName(err.type).toLowerCase()} til ${dayName(err.day)}. Velg en annen type eller dag for resten, og send igjen.`);
        } else {
          setError(`Det ble akkurat fullt for ${typeName(err.type).toLowerCase()} til ${dayName(err.day)}. Velg en annen type eller dag.`);
        }
      } else {
        setError('Noe gikk galt. Prøv igjen, eller kontakt oss.');
      }
      reload();
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
      <div className="notice small">
        <strong>Vi trenger glutenfritt og laktosefritt!</strong> Omtrent hver tredje kake bør være glutenfri.
        Laktosefritt er enkelt: bytt til laktosefri melk, fløte og smør.
        {avail && totalUsed > 0 && <> Så langt: {totalGf} av {totalUsed} kaker er glutenfrie.</>}
      </div>
      <label>Navn<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <PhoneInput value={phone} country={country} onChange={setPhone} onCountry={setCountry} />

      {lines.map((l, i) => (
        <fieldset key={i} className="panel">
          <legend>Bakverk {i + 1}</legend>
          <label>Leveres
            <select value={l.deliveryDay} onChange={(e) => update(i, { deliveryDay: e.target.value as CakeLine['deliveryDay'] })}>
              <option value="">Velg dag …</option>
              {basarDays.map((d) => <option key={d.id} value={d.id}>{d.name}, {formatDate(d.date)}</option>)}
            </select>
          </label>
          {!l.deliveryDay ? (
            <p className="muted small">Velg dag først, så ser du hva kafeen trenger.</p>
          ) : (
            <div role="radiogroup" aria-label="Hva baker du?">
              {[
                { title: 'Kaker', list: types.filter((t) => !t.noExtra) },
                { title: 'Vaffelrøre', list: types.filter((t) => t.noExtra) },
              ].filter((g) => g.list.length).map((g) => (
                <div key={g.title} className={`cakegroup ${g.title === 'Vaffelrøre' ? 'waffle' : ''}`}>
                  <h3>{g.title}</h3>
                  <div className="cakelist">
                    {g.list.map((t) => {
                      const n = left(t.id, l.deliveryDay, i);
                      const full = n <= 0;
                      const extra = !full && isExtra(l.deliveryDay) && !t.noExtra && (avail?.used[slotKey(t.id, l.deliveryDay)] ?? 0) >= (limits[t.id] ?? 0);
                      const liters = /liter/.test(t.unit) ? parseInt(t.unit, 10) : 0; // vis vaffelrøre i liter
                      return (
                        <label key={t.id} className={`cakeopt ${l.type === t.id ? 'on' : ''} ${full ? 'full' : ''}`}>
                          <input type="radio" name={`type-${i}`} checked={l.type === t.id} disabled={full && l.type !== t.id}
                            onChange={() => update(i, { type: t.id })} />
                          <span className="cakename">{t.name}{t.unit && <small> ({t.unit})</small>}</span>
                          <span className="cakeleft">
                            {full ? 'Nok' : extra ? (Number.isFinite(n) ? `Ekstra: ${n}` : 'Ekstra')
                              : liters && Number.isFinite(n) ? `${n * liters} liter igjen`
                              : Number.isFinite(n) ? `${n} igjen` : ''}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {types.find((t) => t.id === l.type)?.needsText ? (
            <label>Hva slags kake? <span className="muted">(må fylles ut)</span>
              <input value={l.variant} onChange={(e) => update(i, { variant: e.target.value })} placeholder="F.eks. eplekake" maxLength={80} />
            </label>
          ) : (
            <label>Kommentar <span className="muted">(valgfritt)</span>
              <input value={l.variant} onChange={(e) => update(i, { variant: e.target.value })} placeholder="F.eks. med bringebær" maxLength={80} />
            </label>
          )}
          <div className="row">
            <label className="choice"><input type="checkbox" checked={l.glutenFree} onChange={(e) => update(i, { glutenFree: e.target.checked })} /><span>Glutenfri</span></label>
            <label className="choice"><input type="checkbox" checked={l.lactoseFree} onChange={(e) => update(i, { lactoseFree: e.target.checked })} /><span>Laktosefri</span></label>
          </div>
          <label>Andre allergener <span className="muted">(valgfritt)</span>
            <input value={l.allergens} onChange={(e) => update(i, { allergens: e.target.value })} placeholder="F.eks. nøtter, egg" maxLength={200} />
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
