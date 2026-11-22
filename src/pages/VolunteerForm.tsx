import { useState, type FormEvent } from 'react';
import { db } from '../firebase';
import { useConfig, formatDate } from '../lib/useConfig';
import { normalizePhone, type Country } from '../lib/phone';
import PhoneInput from '../lib/PhoneInput';
import { signUpForDay } from '../lib/signup';
import type { Assignment, DayId, TimePref } from '../lib/types';

const PREFS: { value: TimePref; label: string; hint: string }[] = [
  { value: 'hele', label: 'Når som helst', hint: 'Gir størst sjanse for vakt' },
  { value: 'for18', label: 'Før kl. 18', hint: 'Vakten starter før 18, men kan vare litt lenger' },
  { value: 'etter18', label: 'Etter kl. 18', hint: 'Vakten starter kl. 18 eller senere' },
];

export default function VolunteerForm({ onDone }: { onDone: (r: Assignment[]) => void }) {
  const cfg = useConfig();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>('NO');
  const [days, setDays] = useState<DayId[]>([]);
  const [pref, setPref] = useState<TimePref | ''>('');
  const [publicName, setPublicName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (cfg.status === 'loading') return <p className="muted">Laster …</p>;
  if (cfg.status !== 'ok') return <p className="notice">Påmeldingen er ikke åpnet ennå. Prøv igjen senere.</p>;
  const config = cfg.config;

  const needsPref = days.some((d) => d !== 'opprigg');
  const toggle = (d: DayId) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const p = normalizePhone(phone, country);
    if (name.trim().length < 2) return setError('Skriv inn fullt navn.');
    if (!p) return setError('Sjekk telefonnummeret. Velg riktig land, eller skriv nummeret med landskode (+46 …).');
    if (days.length === 0) return setError('Velg minst én dag.');
    if (needsPref && !pref) return setError('Velg når på dagen det passer.');

    setBusy(true);
    try {
      const person = { name: name.trim(), phone: p, publicName };
      const results: Assignment[] = [];
      // Én transaksjon per dag, i dagenes rekkefølge
      for (const d of config.days.map((x) => x.id).filter((id) => days.includes(id))) {
        results.push(await signUpForDay(db, config, person, d, (pref || 'hele') as TimePref));
      }
      onDone(results);
    } catch (err) {
      console.error(err);
      setError('Noe gikk galt under påmeldingen. Prøv igjen, eller kontakt oss.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form" noValidate>
      <h1>Meld deg som frivillig</h1>
      <p className="muted">
        Du får én tilfeldig vakt per dag du velger. Alle som møter opp på vakt, er med i trekningen av et gavekort på 5000 kr.
      </p>

      <label>
        Navn
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </label>
      <PhoneInput value={phone} country={country} onChange={setPhone} onCountry={setCountry} />

      <fieldset>
        <legend>Hvilke dager kan du?</legend>
        {config.days.map((d) => (
          <label key={d.id} className="choice">
            <input type="checkbox" checked={days.includes(d.id)} onChange={() => toggle(d.id)} />
            <span>
              <strong>{d.name}</strong>
              <small>
                {formatDate(d.date)}
                {d.id === 'opprigg' ? ', oppmøte kl. 18:00' : ''}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      {needsPref && (
        <fieldset>
          <legend>Når passer det på basardagene?</legend>
          {PREFS.map((o) => (
            <label key={o.value} className="choice">
              <input type="radio" name="pref" checked={pref === o.value} onChange={() => setPref(o.value)} />
              <span>
                <strong>{o.label}</strong>
                <small>{o.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <label className="choice">
        <input type="checkbox" checked={publicName} onChange={(e) => setPublicName(e.target.checked)} />
        <span>
          <strong>Navnet mitt kan vises på den offentlige vaktlisten</strong>
          <small>Listen deles på Facebook, så andre ser hvem som jobber når. Telefonnummeret vises aldri. Valgfritt.</small>
        </span>
      </label>
      <p className="muted small">
        Navn og telefon brukes ellers bare til å organisere basaren og trekningen, og slettes etterpå.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Tildeler vakt …' : 'Send påmelding'}</button>
    </form>
  );
}
