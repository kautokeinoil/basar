import { useConfig, formatDate } from '../lib/useConfig';
import { buildIcs } from '../lib/ics';
import type { Assignment } from '../lib/types';


export default function Confirmation({ assignments }: { assignments: Assignment[] }) {
  const cfg = useConfig();
  if (cfg.status !== 'ok') return <p className="muted">Laster …</p>;
  const config = cfg.config;
  const dayOf = (id: string) => config.days.find((d) => d.id === id)!;
  const shifts = assignments.flatMap((a) => (a.shift ? [a.shift] : []));
  const waiting = assignments.filter((a) => !a.shift);

  function download() {
    const blob = new Blob([buildIcs(config, shifts)], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `basarvakt-${config.year}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section>
      <h1>{shifts.length > 0 ? 'Takk! Her er vakten din' : 'Takk for påmeldingen'}</h1>

      {shifts.length > 0 && (
        <ul className="cards">
          {shifts.map((s) => (
            <li key={s.id} className="card">
              <strong>{s.station}</strong>
              <span>{dayOf(s.day).name}, {formatDate(dayOf(s.day).date)}</span>
              <span className="time">
                {s.day === 'opprigg' ? `Oppmøte kl. ${s.start}` : `Kl. ${s.start}–${s.end}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {waiting.map((w) => (
        <p key={w.day} className="notice">
          Du står på <strong>venteliste</strong> for {dayOf(w.day).name}. Alle vakter i tidsrommet du valgte, er fulle.
          Vi ringer deg hvis det blir ledig plass.
        </p>
      ))}

      {shifts.length > 0 && <button onClick={download}>Legg i kalenderen</button>}

      <p className="muted small">
        Kan du ikke likevel, eller vil du bytte? Kontakt {config.contact.email} eller tlf. {config.contact.phone}.
      </p>
      <p><a href="#/frivillig">Meld deg på flere vakter</a></p>
    </section>
  );
}
